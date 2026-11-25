import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  approveFeedbackSchema,
  canAccess,
  createFeedbackSchema,
  feedbackChatRequestSchema,
  feedbackMessageCreateSchema,
  redactString,
  rejectFeedbackSchema,
  revisePlanSchema,
  sanitizeDiagnosticSnapshot,
  screenshotUploadSchema,
  updateFeedbackStatusSchema,
  type FeedbackCategory,
  type FeedbackFixPlanDTO,
  type FeedbackItemAdminDTO,
  type FeedbackItemReporterDTO,
  type FeedbackMessageDTO,
  type FeedbackPlanStatus,
  type FeedbackSeverity,
  type FeedbackStatus,
  type GithubDispatchStatus,
} from '@interstate/shared';
import { demoStore, type DemoFeedbackItem } from '../data/demo-store.js';
import { getDb, isDatabaseConfigured, isDemoMode } from '../db/client.js';
import { feedbackFixPlans, feedbackItems, feedbackMessages } from '../db/schema/index.js';
import { isValidUuid, writeAuditLog } from '../security/audit.js';
import { isUsingDemoStore, requirePermission, type RequestActor } from '../security/auth-plugin.js';
import { sendAndLogEmail } from '../services/email.js';
import { generateFixPlan, triageFeedbackTurn } from '../services/feedback-ai.js';
import { createApprovedFixGitHubIssue, formatAgentFixBriefMarkdown } from '../services/github-issues.js';
import { getCorrelatedServerLogs } from '../services/server-log-buffer.js';
import { getPresignedDownloadUrl, getStorageProvider, uploadBufferToStorage } from '../services/storage.js';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_DEMO_SCREENSHOTS = 30;

// In-memory sliding window rate limiter for AI endpoints
const rateBuckets = new Map<string, number[]>();

export function resetFeedbackRateLimits(): void {
  rateBuckets.clear();
}

function checkRateLimit(actorUserId: string, bucket: 'chat' | 'create', limit: number, windowMs = 15 * 60_000): boolean {
  if (process.env.NODE_ENV === 'test') return true;
  const key = `${bucket}:${actorUserId}`;
  const now = Date.now();
  const timestamps = (rateBuckets.get(key) ?? []).filter((ts) => now - ts < windowMs);
  if (timestamps.length >= limit) {
    rateBuckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  return true;
}

function parseDataUrlImage(dataUrl: string): { mimeType: string; buffer: Buffer; ext: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const mimeType = match[1]!;
  const buffer = Buffer.from(match[2]!, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_SCREENSHOT_BYTES) {
    return null;
  }

  // Verify magic bytes so non-image payloads cannot spoof Content-Type
  const isPng =
    mimeType === 'image/png' &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const isJpeg =
    mimeType === 'image/jpeg' &&
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;
  const isWebp =
    mimeType === 'image/webp' &&
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (!isPng && !isJpeg && !isWebp) return null;

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  return { mimeType, buffer, ext };
}

function getDemoScreenshotInline(storageKey: string | null | undefined): { mimeType: string; base64: string } | null {
  if (!storageKey) return null;
  const entry = demoStore.feedbackScreenshots.get(storageKey);
  if (!entry) return null;
  return {
    mimeType: entry.contentType,
    base64: entry.buffer.toString('base64'),
  };
}

function isTicketOwner(item: { reporterUserId: string | null; subCompanyId: string | null }, actor: RequestActor): boolean {
  if (!item.reporterUserId || item.reporterUserId !== actor.userId) return false;
  if (actor.role === 'subcontractor' && item.subCompanyId !== actor.subCompanyId) return false;
  return true;
}

function mapPgItemToDemoShape(row: typeof feedbackItems.$inferSelect): DemoFeedbackItem {
  return {
    id: row.id,
    ticketKey: row.ticketKey,
    category: row.category as FeedbackCategory,
    severity: row.severity as FeedbackSeverity,
    status: row.status as FeedbackStatus,
    title: row.title,
    description: row.description,
    reporterUserId: row.reporterUserId,
    reporterEmail: row.reporterEmail,
    reporterName: row.reporterName,
    reporterRole: row.reporterRole,
    subCompanyId: row.subCompanyId,
    pagePath: row.pagePath,
    pageTitle: row.pageTitle,
    pageContext: row.pageContextJson,
    diagnosticSnapshot: row.diagnosticSnapshotJson,
    screenshotStorageKey: row.screenshotStorageKey,
    resolutionNote: row.resolutionNote,
    adminNotes: row.adminNotes,
    githubIssueNumber: row.githubIssueNumber,
    githubIssueUrl: row.githubIssueUrl,
    githubDispatchStatus: row.githubDispatchStatus as GithubDispatchStatus,
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPgPlanToDTO(row: typeof feedbackFixPlans.$inferSelect): FeedbackFixPlanDTO {
  return {
    id: row.id,
    feedbackItemId: row.feedbackItemId,
    version: row.version,
    modelName: row.modelName,
    summary: row.summary,
    rootCauseOrGoal: row.rootCauseOrGoal,
    affectedFiles: row.affectedFilesJson,
    schemaChanges: row.schemaChangesJson,
    securityRbacImpact: row.securityRbacImpact,
    implementationSteps: row.implementationStepsJson,
    verificationSteps: row.verificationStepsJson,
    riskLevel: row.riskLevel as FeedbackFixPlanDTO['riskLevel'],
    estimatedEffort: row.estimatedEffort as FeedbackFixPlanDTO['estimatedEffort'],
    revisionFeedback: row.revisionFeedback,
    status: row.status as FeedbackPlanStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapPgMessageToDTO(row: typeof feedbackMessages.$inferSelect): FeedbackMessageDTO {
  return {
    id: row.id,
    feedbackItemId: row.feedbackItemId,
    senderType: row.senderType as FeedbackMessageDTO['senderType'],
    senderUserId: row.senderUserId,
    senderName: row.senderName,
    body: row.body,
    visibleToReporter: row.visibleToReporter,
    createdAt: row.createdAt.toISOString(),
  };
}

function projectFeedbackItemForActor(
  item: DemoFeedbackItem,
  plans: FeedbackFixPlanDTO[],
  messages: FeedbackMessageDTO[],
  actor: RequestActor,
  includeDetails: boolean
): FeedbackItemAdminDTO | FeedbackItemReporterDTO {
  const isAdmin = canAccess(actor.role, 'feedback:manage');
  if (!isAdmin) {
    const visibleMessages = messages.filter((m) => m.visibleToReporter);
    return {
      id: item.id,
      ticketKey: item.ticketKey,
      category: item.category,
      severity: item.severity,
      status: item.status,
      title: item.title,
      description: item.description,
      pagePath: item.pagePath,
      pageTitle: item.pageTitle,
      pageContext: {
        section: item.pageContext.section,
        entityType: item.pageContext.entityType,
        entityLabel: item.pageContext.entityLabel,
      },
      resolutionNote: item.resolutionNote,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      resolvedAt: item.resolvedAt,
      ...(includeDetails ? { messages: visibleMessages } : {}),
    };
  }

  const sortedPlans = [...plans].sort((a, b) => b.version - a.version);
  const latestPlan = sortedPlans[0] ?? null;
  const screenshotUrl = item.screenshotStorageKey ? `/api/feedback/${item.id}/screenshot` : null;

  return {
    id: item.id,
    ticketKey: item.ticketKey,
    category: item.category,
    severity: item.severity,
    status: item.status,
    title: item.title,
    description: item.description,
    reporterUserId: item.reporterUserId,
    reporterEmail: item.reporterEmail,
    reporterName: item.reporterName,
    reporterRole: item.reporterRole,
    subCompanyId: item.subCompanyId,
    pagePath: item.pagePath,
    pageTitle: item.pageTitle,
    pageContext: item.pageContext,
    diagnosticSnapshot: item.diagnosticSnapshot,
    screenshotStorageKey: item.screenshotStorageKey,
    screenshotUrl,
    resolutionNote: item.resolutionNote,
    adminNotes: item.adminNotes,
    githubIssueNumber: item.githubIssueNumber,
    githubIssueUrl: item.githubIssueUrl,
    githubDispatchStatus: item.githubDispatchStatus,
    approvedByUserId: item.approvedByUserId,
    approvedAt: item.approvedAt,
    resolvedAt: item.resolvedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    latestPlan,
    ...(includeDetails
      ? {
          fixPlans: sortedPlans,
          messages,
          agentBriefMarkdown: latestPlan
            ? formatAgentFixBriefMarkdown(item, latestPlan, messages)
            : null,
        }
      : {}),
  };
}

async function notifyAdminPlanReady(item: DemoFeedbackItem, plan: FeedbackFixPlanDTO, triggeredByUserId: string) {
  const to = process.env.FEEDBACK_APPROVER_EMAIL?.trim() || 'chase@interstatehomes.com';
  try {
    await sendAndLogEmail({
      to,
      subject: `[${item.ticketKey}] Fix Plan Ready for Approval: ${item.title}`,
      templateName: 'feedback_plan_ready',
      triggeredByUserId: isValidUuid(triggeredByUserId) ? triggeredByUserId : '00000000-0000-0000-0000-000000000000',
      relatedEntityType: 'feedback_item',
      relatedEntityId: item.id,
      html: `<p><strong>${item.ticketKey}</strong> (${item.category} / ${item.severity}) submitted by ${item.reporterName} on <code>${item.pagePath}</code>.</p><p><strong>AI Plan v${plan.version}:</strong> ${plan.summary}</p><p>Review and approve inside the Interstate Homes Admin Feedback Console (/feedback).</p>`,
    });
  } catch {
    // Non-blocking notification failure must not fail feedback creation
  }
}

async function notifyReporterOutcome(item: DemoFeedbackItem, triggeredByUserId: string) {
  if (!item.reporterEmail || item.reporterEmail.includes('anonymous')) return;
  try {
    await sendAndLogEmail({
      to: item.reporterEmail,
      subject: `[${item.ticketKey}] Update: ${item.status === 'deployed' ? 'Deployed' : 'Reviewed'} — ${item.title}`,
      templateName: 'feedback_outcome',
      triggeredByUserId: isValidUuid(triggeredByUserId) ? triggeredByUserId : '00000000-0000-0000-0000-000000000000',
      relatedEntityType: 'feedback_item',
      relatedEntityId: item.id,
      html: `<p>Your feedback ticket <strong>${item.ticketKey}</strong> is now <strong>${item.status}</strong>.</p>${item.resolutionNote ? `<p>${item.resolutionNote}</p>` : ''}`,
    });
  } catch {
    // Non-blocking notification failure
  }
}

async function loadFeedbackRecord(id: string): Promise<{
  item: DemoFeedbackItem;
  plans: FeedbackFixPlanDTO[];
  messages: FeedbackMessageDTO[];
} | null> {
  if (isUsingDemoStore()) {
    const item = demoStore.feedbackItems.find((f) => f.id === id);
    if (!item) return null;
    const plans = demoStore.feedbackFixPlans.filter((p) => p.feedbackItemId === id);
    const messages = demoStore.feedbackMessages
      .filter((m) => m.feedbackItemId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { item, plans, messages };
  }

  if (!isValidUuid(id)) return null;
  const db = getDb();
  const [row] = await db.select().from(feedbackItems).where(eq(feedbackItems.id, id)).limit(1);
  if (!row) return null;

  const [planRows, msgRows] = await Promise.all([
    db
      .select()
      .from(feedbackFixPlans)
      .where(eq(feedbackFixPlans.feedbackItemId, id))
      .orderBy(desc(feedbackFixPlans.version)),
    db
      .select()
      .from(feedbackMessages)
      .where(eq(feedbackMessages.feedbackItemId, id))
      .orderBy(asc(feedbackMessages.createdAt)),
  ]);

  return {
    item: mapPgItemToDemoShape(row),
    plans: planRows.map(mapPgPlanToDTO),
    messages: msgRows.map(mapPgMessageToDTO),
  };
}

export async function registerFeedbackRoutes(app: FastifyInstance) {
  // 1. Conversational context-aware AI triage
  app.post(
    '/api/feedback/chat',
    {
      preHandler: [requirePermission('feedback:create')],
      schema: { tags: ['Feedback'], summary: 'Context-aware AI triage chat turn' },
    },
    async (request, reply) => {
      if (!checkRateLimit(request.actor.userId, 'chat', 20)) {
        return reply.status(429).send({
          error: 'RateLimitExceeded',
          message: 'Too many feedback chat requests. Please wait a few minutes and try again.',
        });
      }

      const parsed = feedbackChatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      const screenshot = getDemoScreenshotInline(parsed.data.screenshotStorageKey);
      const response = await triageFeedbackTurn({
        messages: parsed.data.messages,
        pageContext: parsed.data.pageContext,
        recentErrorsSummary: parsed.data.recentErrorsSummary,
        screenshot,
      });

      return response;
    }
  );

  // 2. Upload redacted viewport screenshot (PNG/JPEG/WebP <= 5 MB)
  app.post(
    '/api/feedback/screenshot',
    {
      preHandler: [requirePermission('feedback:create')],
      schema: { tags: ['Feedback'], summary: 'Upload feedback screenshot attachment' },
    },
    async (request, reply) => {
      const parsed = screenshotUploadSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      const decoded = parseDataUrlImage(parsed.data.dataUrl);
      if (!decoded) {
        return reply.status(400).send({
          error: 'InvalidScreenshot',
          message: 'Screenshot must be a valid PNG, JPEG, or WebP image under 5 MB.',
        });
      }

      const storageKey = `feedback-screenshots/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${decoded.ext}`;
      const provider = getStorageProvider();

      if (isUsingDemoStore() || provider === 'mock') {
        demoStore.feedbackScreenshots.set(storageKey, {
          contentType: decoded.mimeType,
          buffer: decoded.buffer,
        });
        if (demoStore.feedbackScreenshots.size > MAX_DEMO_SCREENSHOTS) {
          const oldestKey = demoStore.feedbackScreenshots.keys().next().value;
          if (oldestKey) demoStore.feedbackScreenshots.delete(oldestKey);
        }
      } else {
        await uploadBufferToStorage(storageKey, decoded.buffer, decoded.mimeType);
      }

      return reply.status(201).send({
        storageKey,
        contentType: decoded.mimeType,
        sizeBytes: decoded.buffer.length,
      });
    }
  );

  // 3. Lightweight badge counts for sidebar & widget
  app.get(
    '/api/feedback/summary',
    {
      preHandler: [requirePermission('feedback:view_own')],
      schema: { tags: ['Feedback'], summary: 'Pending approval and reporter update counts' },
    },
    async (request) => {
      const isAdmin = canAccess(request.actor.role, 'feedback:manage');

      if (isUsingDemoStore()) {
        const items = demoStore.feedbackItems;
        const pendingApprovalCount = isAdmin
          ? items.filter((i) => i.status === 'plan_ready').length
          : 0;
        const openCount = isAdmin
          ? items.filter((i) => !['deployed', 'rejected'].includes(i.status)).length
          : items.filter((i) => isTicketOwner(i, request.actor) && !['deployed', 'rejected'].includes(i.status)).length;
        const myUpdatesCount = items.filter(
          (i) => isTicketOwner(i, request.actor) && (i.status === 'deployed' || i.status === 'approved' || i.status === 'in_progress')
        ).length;
        return { pendingApprovalCount, openCount, myUpdatesCount };
      }

      const db = getDb();
      const rows = isAdmin
        ? await db.select({ status: feedbackItems.status, reporterUserId: feedbackItems.reporterUserId, subCompanyId: feedbackItems.subCompanyId }).from(feedbackItems)
        : isValidUuid(request.actor.userId)
          ? await db
              .select({ status: feedbackItems.status, reporterUserId: feedbackItems.reporterUserId, subCompanyId: feedbackItems.subCompanyId })
              .from(feedbackItems)
              .where(eq(feedbackItems.reporterUserId, request.actor.userId))
          : [];

      const owned = rows.filter((r) => isTicketOwner(r, request.actor));
      return {
        pendingApprovalCount: isAdmin ? rows.filter((r) => r.status === 'plan_ready').length : 0,
        openCount: isAdmin
          ? rows.filter((r) => !['deployed', 'rejected'].includes(r.status)).length
          : owned.filter((r) => !['deployed', 'rejected'].includes(r.status)).length,
        myUpdatesCount: owned.filter((r) => ['approved', 'in_progress', 'deployed'].includes(r.status)).length,
      };
    }
  );

  // 4. Submit feedback + correlate server logs + generate AI fix plan v1
  app.post(
    '/api/feedback',
    {
      preHandler: [requirePermission('feedback:create')],
      schema: { tags: ['Feedback'], summary: 'Submit feedback with diagnostics and generate AI fix plan' },
    },
    async (request, reply) => {
      if (!checkRateLimit(request.actor.userId, 'create', 5)) {
        return reply.status(429).send({
          error: 'RateLimitExceeded',
          message: 'Too many feedback submissions in a short period. Please wait a few minutes.',
        });
      }

      const parsed = createFeedbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      const input = parsed.data;
      const sanitizedClientSnapshot = sanitizeDiagnosticSnapshot(input.diagnosticSnapshot);
      const serverLogs = getCorrelatedServerLogs(
        sanitizedClientSnapshot.requestIds,
        request.actor.userId
      );
      const fullSnapshot = sanitizeDiagnosticSnapshot({
        ...sanitizedClientSnapshot,
        serverLogs,
      });

      const screenshotInline = getDemoScreenshotInline(input.screenshotStorageKey);
      const nowIso = new Date().toISOString();

      let itemId: string;
      let ticketKey: string;

      if (isUsingDemoStore()) {
        const seq = demoStore.nextFeedbackSeq++;
        itemId = `fb-${Date.now()}-${seq}`;
        ticketKey = `FB-${seq}`;

        const newItem: DemoFeedbackItem = {
          id: itemId,
          ticketKey,
          category: input.category,
          severity: input.severity,
          status: 'plan_generating',
          title: redactString(input.title, 200),
          description: redactString(input.description, 8000),
          reporterUserId: request.actor.userId,
          reporterEmail: request.actor.email,
          reporterName: request.actor.fullName,
          reporterRole: request.actor.role,
          subCompanyId: request.actor.subCompanyId,
          pagePath: redactString(input.pageContext.pathname, 300),
          pageTitle: input.pageContext.pageTitle ? redactString(input.pageContext.pageTitle, 200) : null,
          pageContext: input.pageContext,
          diagnosticSnapshot: fullSnapshot,
          screenshotStorageKey: input.screenshotStorageKey ?? null,
          resolutionNote: null,
          adminNotes: null,
          githubIssueNumber: null,
          githubIssueUrl: null,
          githubDispatchStatus: 'not_dispatched',
          approvedByUserId: null,
          approvedAt: null,
          resolvedAt: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        demoStore.feedbackItems.unshift(newItem);

        const initialMsgs: FeedbackMessageDTO[] = (
          input.transcript.length > 0
            ? input.transcript
            : [{ senderType: 'user' as const, body: input.description }]
        ).map((m, idx) => ({
          id: `fbm-${Date.now()}-${idx}`,
          feedbackItemId: itemId,
          senderType: m.senderType,
          senderUserId: m.senderType === 'user' ? request.actor.userId : null,
          senderName: m.senderType === 'user' ? request.actor.fullName : 'Interstate Feedback Assistant',
          body: redactString(m.body, 4000),
          visibleToReporter: true,
          createdAt: nowIso,
        }));

        const generated = await generateFixPlan({
          ticketKey,
          category: newItem.category,
          severity: newItem.severity,
          title: newItem.title,
          description: newItem.description,
          reporterRole: newItem.reporterRole,
          pagePath: newItem.pagePath,
          pageContext: newItem.pageContext,
          diagnosticSnapshot: newItem.diagnosticSnapshot,
          messages: initialMsgs,
          screenshot: screenshotInline,
        });

        const planDto: FeedbackFixPlanDTO = {
          id: `fbp-${Date.now()}-v1`,
          feedbackItemId: itemId,
          version: 1,
          modelName: generated.modelName,
          ...generated.plan,
          revisionFeedback: null,
          status: 'pending_approval',
          createdAt: new Date().toISOString(),
        };

        demoStore.feedbackFixPlans.unshift(planDto);
        newItem.status = 'plan_ready';
        newItem.updatedAt = planDto.createdAt;

        const systemMsg: FeedbackMessageDTO = {
          id: `fbm-${Date.now()}-sys`,
          feedbackItemId: itemId,
          senderType: 'system',
          senderUserId: null,
          senderName: 'System',
          body: `Ticket ${ticketKey} logged with page context & diagnostic snapshot. An AI fix plan (v1) has been generated and sent for Admin approval.`,
          visibleToReporter: true,
          createdAt: planDto.createdAt,
        };
        demoStore.feedbackMessages.push(...initialMsgs, systemMsg);

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'FEEDBACK_SUBMITTED',
          entityType: 'feedback_item',
          entityId: ticketKey,
          ipAddress: request.ip,
          afterValues: {
            category: newItem.category,
            severity: newItem.severity,
            pagePath: newItem.pagePath,
            planVersion: 1,
          },
        });

        void notifyAdminPlanReady(newItem, planDto, request.actor.userId);

        return reply.status(201).send({
          item: projectFeedbackItemForActor(
            newItem,
            [planDto],
            [...initialMsgs, systemMsg],
            request.actor,
            true
          ),
        });
      }

      // PostgreSQL path
      const db = getDb();
      const existingRows = await db.select({ id: feedbackItems.id }).from(feedbackItems);
      ticketKey = `FB-${101 + existingRows.length}`;

      const [inserted] = await db
        .insert(feedbackItems)
        .values({
          ticketKey,
          category: input.category,
          severity: input.severity,
          status: 'plan_generating',
          title: redactString(input.title, 200),
          description: redactString(input.description, 8000),
          reporterUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
          reporterEmail: request.actor.email,
          reporterName: request.actor.fullName,
          reporterRole: request.actor.role,
          subCompanyId: isValidUuid(request.actor.subCompanyId) ? request.actor.subCompanyId : null,
          pagePath: redactString(input.pageContext.pathname, 300),
          pageTitle: input.pageContext.pageTitle ? redactString(input.pageContext.pageTitle, 200) : null,
          pageContextJson: input.pageContext,
          diagnosticSnapshotJson: fullSnapshot,
          screenshotStorageKey: input.screenshotStorageKey ?? null,
        })
        .returning();

      itemId = inserted!.id;
      const mappedItem = mapPgItemToDemoShape(inserted!);

      const transcriptRows = (
        input.transcript.length > 0
          ? input.transcript
          : [{ senderType: 'user' as const, body: input.description }]
      ).map((m) => ({
        feedbackItemId: itemId,
        senderType: m.senderType,
        senderUserId:
          m.senderType === 'user' && isValidUuid(request.actor.userId)
            ? request.actor.userId
            : null,
        senderName: m.senderType === 'user' ? request.actor.fullName : 'Interstate Feedback Assistant',
        body: redactString(m.body, 4000),
        visibleToReporter: true,
      }));

      const insertedMsgs = await db.insert(feedbackMessages).values(transcriptRows).returning();

      const generated = await generateFixPlan({
        ticketKey,
        category: mappedItem.category,
        severity: mappedItem.severity,
        title: mappedItem.title,
        description: mappedItem.description,
        reporterRole: mappedItem.reporterRole,
        pagePath: mappedItem.pagePath,
        pageContext: mappedItem.pageContext,
        diagnosticSnapshot: mappedItem.diagnosticSnapshot,
        messages: insertedMsgs.map(mapPgMessageToDTO),
        screenshot: screenshotInline,
      });

      const [planRow] = await db
        .insert(feedbackFixPlans)
        .values({
          feedbackItemId: itemId,
          version: 1,
          modelName: generated.modelName,
          summary: generated.plan.summary,
          rootCauseOrGoal: generated.plan.rootCauseOrGoal,
          affectedFilesJson: generated.plan.affectedFiles,
          schemaChangesJson: generated.plan.schemaChanges,
          securityRbacImpact: generated.plan.securityRbacImpact,
          implementationStepsJson: generated.plan.implementationSteps,
          verificationStepsJson: generated.plan.verificationSteps,
          riskLevel: generated.plan.riskLevel,
          estimatedEffort: generated.plan.estimatedEffort,
          status: 'pending_approval',
        })
        .returning();

      const [sysMsg] = await db
        .insert(feedbackMessages)
        .values({
          feedbackItemId: itemId,
          senderType: 'system',
          senderUserId: null,
          senderName: 'System',
          body: `Ticket ${ticketKey} logged with page context & diagnostic snapshot. An AI fix plan (v1) has been generated and sent for Admin approval.`,
          visibleToReporter: true,
        })
        .returning();

      const [updatedRow] = await db
        .update(feedbackItems)
        .set({ status: 'plan_ready', updatedAt: new Date() })
        .where(eq(feedbackItems.id, itemId))
        .returning();

      const finalItem = mapPgItemToDemoShape(updatedRow!);
      const planDto = mapPgPlanToDTO(planRow!);
      const allMsgs = [...insertedMsgs, sysMsg!].map(mapPgMessageToDTO);

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'FEEDBACK_SUBMITTED',
        entityType: 'feedback_item',
        entityId: ticketKey,
        ipAddress: request.ip,
        afterValues: {
          category: finalItem.category,
          severity: finalItem.severity,
          pagePath: finalItem.pagePath,
          planVersion: 1,
        },
      });

      void notifyAdminPlanReady(finalItem, planDto, request.actor.userId);

      return reply.status(201).send({
        item: projectFeedbackItemForActor(finalItem, [planDto], allMsgs, request.actor, true),
      });
    }
  );

  // 5. List feedback tickets (Admin sees all; non-Admin sees strictly own)
  app.get(
    '/api/feedback',
    {
      preHandler: [requirePermission('feedback:view_own')],
      schema: { tags: ['Feedback'], summary: 'List feedback items (role-scoped)' },
    },
    async (request) => {
      const query = (request.query ?? {}) as { status?: string; category?: string };
      const isAdmin = canAccess(request.actor.role, 'feedback:manage');

      if (isUsingDemoStore()) {
        let items = isAdmin
          ? [...demoStore.feedbackItems]
          : demoStore.feedbackItems.filter((i) => isTicketOwner(i, request.actor));

        if (query.status && query.status !== 'all') {
          items = items.filter((i) => i.status === query.status);
        }
        if (query.category && query.category !== 'all') {
          items = items.filter((i) => i.category === query.category);
        }

        const pendingApprovalCount = isAdmin
          ? demoStore.feedbackItems.filter((i) => i.status === 'plan_ready').length
          : 0;

        return {
          items: items.map((item) => {
            const plans = demoStore.feedbackFixPlans.filter((p) => p.feedbackItemId === item.id);
            const msgs = demoStore.feedbackMessages.filter((m) => m.feedbackItemId === item.id);
            return projectFeedbackItemForActor(item, plans, msgs, request.actor, false);
          }),
          pendingApprovalCount,
        };
      }

      const db = getDb();
      const conditions = [];
      if (!isAdmin) {
        if (!isValidUuid(request.actor.userId)) {
          return { items: [], pendingApprovalCount: 0 };
        }
        conditions.push(eq(feedbackItems.reporterUserId, request.actor.userId));
      }
      if (query.status && query.status !== 'all') {
        conditions.push(eq(feedbackItems.status, query.status));
      }
      if (query.category && query.category !== 'all') {
        conditions.push(eq(feedbackItems.category, query.category));
      }

      const rows = await db
        .select()
        .from(feedbackItems)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(feedbackItems.createdAt))
        .limit(100);

      const filteredRows = isAdmin ? rows : rows.filter((r) => isTicketOwner(r, request.actor));
      const ids = filteredRows.map((r) => r.id);

      const planRows =
        isAdmin && ids.length > 0
          ? await db
              .select()
              .from(feedbackFixPlans)
              .where(inArray(feedbackFixPlans.feedbackItemId, ids))
              .orderBy(desc(feedbackFixPlans.version))
          : [];

      const plansByItem = new Map<string, FeedbackFixPlanDTO[]>();
      for (const p of planRows) {
        const list = plansByItem.get(p.feedbackItemId) ?? [];
        list.push(mapPgPlanToDTO(p));
        plansByItem.set(p.feedbackItemId, list);
      }

      let pendingApprovalCount = 0;
      if (isAdmin) {
        const pending = await db
          .select({ id: feedbackItems.id })
          .from(feedbackItems)
          .where(eq(feedbackItems.status, 'plan_ready'));
        pendingApprovalCount = pending.length;
      }

      return {
        items: filteredRows.map((row) =>
          projectFeedbackItemForActor(
            mapPgItemToDemoShape(row),
            plansByItem.get(row.id) ?? [],
            [],
            request.actor,
            false
          )
        ),
        pendingApprovalCount,
      };
    }
  );

  // 6. Get single ticket detail
  app.get(
    '/api/feedback/:id',
    {
      preHandler: [requirePermission('feedback:view_own')],
      schema: { tags: ['Feedback'], summary: 'Get feedback detail (role-projected)' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const record = await loadFeedbackRecord(id);
      if (!record) {
        return reply.status(404).send({ error: 'NotFound', message: 'Feedback ticket not found.' });
      }

      const isAdmin = canAccess(request.actor.role, 'feedback:manage');
      if (!isAdmin && !isTicketOwner(record.item, request.actor)) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You can only view your own feedback submissions.',
        });
      }

      return {
        item: projectFeedbackItemForActor(
          record.item,
          record.plans,
          record.messages,
          request.actor,
          true
        ),
      };
    }
  );

  // 7. Serve screenshot attachment safely
  app.get(
    '/api/feedback/:id/screenshot',
    {
      preHandler: [requirePermission('feedback:view_own')],
      schema: { tags: ['Feedback'], summary: 'Retrieve feedback screenshot attachment' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const record = await loadFeedbackRecord(id);
      if (!record || !record.item.screenshotStorageKey) {
        return reply.status(404).send({ error: 'NotFound', message: 'Screenshot not found.' });
      }

      const isAdmin = canAccess(request.actor.role, 'feedback:manage');
      if (!isAdmin && !isTicketOwner(record.item, request.actor)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied.' });
      }

      const demoBlob = demoStore.feedbackScreenshots.get(record.item.screenshotStorageKey);
      if (demoBlob) {
        reply.header('Content-Type', demoBlob.contentType);
        reply.header('Cache-Control', 'private, max-age=300');
        return reply.send(demoBlob.buffer);
      }

      if (getStorageProvider() !== 'mock') {
        const { url } = await getPresignedDownloadUrl(record.item.screenshotStorageKey, 300);
        return reply.redirect(url);
      }

      return reply.status(404).send({ error: 'NotFound', message: 'Screenshot blob expired from memory.' });
    }
  );

  // 8. Append conversation message
  app.post(
    '/api/feedback/:id/messages',
    {
      preHandler: [requirePermission('feedback:view_own')],
      schema: { tags: ['Feedback'], summary: 'Post a follow-up message on a feedback ticket' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = feedbackMessageCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      const record = await loadFeedbackRecord(id);
      if (!record) {
        return reply.status(404).send({ error: 'NotFound', message: 'Feedback ticket not found.' });
      }

      const isAdmin = canAccess(request.actor.role, 'feedback:manage');
      if (!isAdmin && !isTicketOwner(record.item, request.actor)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Cannot comment on another user ticket.' });
      }

      const visibleToReporter = isAdmin ? parsed.data.visibleToReporter : true;
      const senderType = isAdmin ? 'admin' : 'user';
      const nowIso = new Date().toISOString();

      if (isUsingDemoStore()) {
        const msg: FeedbackMessageDTO = {
          id: `fbm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          feedbackItemId: id,
          senderType,
          senderUserId: request.actor.userId,
          senderName: request.actor.fullName,
          body: redactString(parsed.data.body, 4000),
          visibleToReporter,
          createdAt: nowIso,
        };
        demoStore.feedbackMessages.push(msg);
        record.item.updatedAt = nowIso;
        return reply.status(201).send({ message: msg });
      }

      const db = getDb();
      const [inserted] = await db
        .insert(feedbackMessages)
        .values({
          feedbackItemId: id,
          senderType,
          senderUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
          senderName: request.actor.fullName,
          body: redactString(parsed.data.body, 4000),
          visibleToReporter,
        })
        .returning();

      await db
        .update(feedbackItems)
        .set({ updatedAt: new Date() })
        .where(eq(feedbackItems.id, id));

      return reply.status(201).send({ message: mapPgMessageToDTO(inserted!) });
    }
  );

  // 9. Admin: Request AI plan revision with guidance
  app.post(
    '/api/feedback/:id/revise-plan',
    {
      preHandler: [requirePermission('feedback:manage')],
      schema: { tags: ['Feedback'], summary: 'Admin-only: regenerate AI fix plan with revision guidance' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = revisePlanSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      const record = await loadFeedbackRecord(id);
      if (!record) {
        return reply.status(404).send({ error: 'NotFound', message: 'Feedback ticket not found.' });
      }

      const previousPlan = [...record.plans].sort((a, b) => b.version - a.version)[0] ?? null;
      const nextVersion = (previousPlan?.version ?? 0) + 1;
      const screenshotInline = getDemoScreenshotInline(record.item.screenshotStorageKey);

      const generated = await generateFixPlan({
        ticketKey: record.item.ticketKey,
        category: record.item.category,
        severity: record.item.severity,
        title: record.item.title,
        description: record.item.description,
        reporterRole: record.item.reporterRole,
        pagePath: record.item.pagePath,
        pageContext: record.item.pageContext,
        diagnosticSnapshot: record.item.diagnosticSnapshot,
        messages: record.messages,
        screenshot: screenshotInline,
        revisionFeedback: parsed.data.feedback,
        previousPlan,
      });

      const nowIso = new Date().toISOString();

      if (isUsingDemoStore()) {
        for (const plan of demoStore.feedbackFixPlans) {
          if (plan.feedbackItemId === id && plan.status === 'pending_approval') {
            plan.status = 'superseded';
          }
        }
        const newPlan: FeedbackFixPlanDTO = {
          id: `fbp-${Date.now()}-v${nextVersion}`,
          feedbackItemId: id,
          version: nextVersion,
          modelName: generated.modelName,
          ...generated.plan,
          revisionFeedback: redactString(parsed.data.feedback, 3000),
          status: 'pending_approval',
          createdAt: nowIso,
        };
        demoStore.feedbackFixPlans.unshift(newPlan);
        record.item.status = 'plan_ready';
        record.item.updatedAt = nowIso;

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'FEEDBACK_PLAN_REVISED',
          entityType: 'feedback_item',
          entityId: record.item.ticketKey,
          ipAddress: request.ip,
          afterValues: { version: nextVersion, revisionFeedback: parsed.data.feedback },
        });

        const updatedRecord = await loadFeedbackRecord(id);
        return {
          item: projectFeedbackItemForActor(
            updatedRecord!.item,
            updatedRecord!.plans,
            updatedRecord!.messages,
            request.actor,
            true
          ),
        };
      }

      const db = getDb();
      await db
        .update(feedbackFixPlans)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(feedbackFixPlans.feedbackItemId, id),
            eq(feedbackFixPlans.status, 'pending_approval')
          )
        );

      await db.insert(feedbackFixPlans).values({
        feedbackItemId: id,
        version: nextVersion,
        modelName: generated.modelName,
        summary: generated.plan.summary,
        rootCauseOrGoal: generated.plan.rootCauseOrGoal,
        affectedFilesJson: generated.plan.affectedFiles,
        schemaChangesJson: generated.plan.schemaChanges,
        securityRbacImpact: generated.plan.securityRbacImpact,
        implementationStepsJson: generated.plan.implementationSteps,
        verificationStepsJson: generated.plan.verificationSteps,
        riskLevel: generated.plan.riskLevel,
        estimatedEffort: generated.plan.estimatedEffort,
        revisionFeedback: redactString(parsed.data.feedback, 3000),
        status: 'pending_approval',
      });

      await db
        .update(feedbackItems)
        .set({ status: 'plan_ready', updatedAt: new Date() })
        .where(eq(feedbackItems.id, id));

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'FEEDBACK_PLAN_REVISED',
        entityType: 'feedback_item',
        entityId: record.item.ticketKey,
        ipAddress: request.ip,
        afterValues: { version: nextVersion, revisionFeedback: parsed.data.feedback },
      });

      const updatedRecord = await loadFeedbackRecord(id);
      return {
        item: projectFeedbackItemForActor(
          updatedRecord!.item,
          updatedRecord!.plans,
          updatedRecord!.messages,
          request.actor,
          true
        ),
      };
    }
  );

  // 10. Admin: Approve fix plan & dispatch GitHub Issue
  app.post(
    '/api/feedback/:id/approve',
    {
      preHandler: [requirePermission('feedback:manage')],
      schema: { tags: ['Feedback'], summary: 'Admin-only: approve fix plan and dispatch GitHub Issue' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = approveFeedbackSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      const record = await loadFeedbackRecord(id);
      if (!record) {
        return reply.status(404).send({ error: 'NotFound', message: 'Feedback ticket not found.' });
      }

      const latestPlan = [...record.plans].sort((a, b) => b.version - a.version)[0];
      if (!latestPlan) {
        return reply.status(400).send({ error: 'NoPlanAvailable', message: 'No fix plan exists to approve.' });
      }

      const ghResult = parsed.data.createGithubIssue
        ? await createApprovedFixGitHubIssue(record.item, latestPlan, record.messages)
        : { status: 'not_dispatched' as GithubDispatchStatus, issueNumber: null, issueUrl: null };

      const nowIso = new Date().toISOString();
      const adminNotes = parsed.data.adminNotes ? redactString(parsed.data.adminNotes, 2000) : record.item.adminNotes;

      if (isUsingDemoStore()) {
        for (const p of demoStore.feedbackFixPlans) {
          if (p.feedbackItemId === id) {
            p.status = p.id === latestPlan.id ? 'approved' : p.status === 'pending_approval' ? 'superseded' : p.status;
          }
        }
        record.item.status = 'approved';
        record.item.adminNotes = adminNotes ?? null;
        record.item.approvedByUserId = request.actor.userId;
        record.item.approvedAt = nowIso;
        record.item.updatedAt = nowIso;
        record.item.githubDispatchStatus = ghResult.status;
        record.item.githubIssueNumber = ghResult.issueNumber;
        record.item.githubIssueUrl = ghResult.issueUrl;

        demoStore.feedbackMessages.push({
          id: `fbm-${Date.now()}-apr`,
          feedbackItemId: id,
          senderType: 'system',
          senderUserId: null,
          senderName: 'System',
          body: `Fix plan v${latestPlan.version} approved by ${request.actor.fullName} and queued for implementation.`,
          visibleToReporter: true,
          createdAt: nowIso,
        });

        await writeAuditLog({
          actorUserId: request.actor.userId,
          actorEmail: request.actor.email,
          action: 'FEEDBACK_PLAN_APPROVED',
          entityType: 'feedback_item',
          entityId: record.item.ticketKey,
          ipAddress: request.ip,
          afterValues: {
            planVersion: latestPlan.version,
            githubDispatchStatus: ghResult.status,
            githubIssueNumber: ghResult.issueNumber,
          },
        });

        const updatedRecord = await loadFeedbackRecord(id);
        return {
          item: projectFeedbackItemForActor(
            updatedRecord!.item,
            updatedRecord!.plans,
            updatedRecord!.messages,
            request.actor,
            true
          ),
          githubError: ghResult.error ?? null,
        };
      }

      const db = getDb();
      await db
        .update(feedbackFixPlans)
        .set({ status: 'approved' })
        .where(eq(feedbackFixPlans.id, latestPlan.id));

      await db
        .update(feedbackItems)
        .set({
          status: 'approved',
          adminNotes: adminNotes ?? null,
          approvedByUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
          approvedAt: new Date(),
          updatedAt: new Date(),
          githubDispatchStatus: ghResult.status,
          githubIssueNumber: ghResult.issueNumber,
          githubIssueUrl: ghResult.issueUrl,
        })
        .where(eq(feedbackItems.id, id));

      await db.insert(feedbackMessages).values({
        feedbackItemId: id,
        senderType: 'system',
        senderUserId: null,
        senderName: 'System',
        body: `Fix plan v${latestPlan.version} approved by ${request.actor.fullName} and queued for implementation.`,
        visibleToReporter: true,
      });

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'FEEDBACK_PLAN_APPROVED',
        entityType: 'feedback_item',
        entityId: record.item.ticketKey,
        ipAddress: request.ip,
        afterValues: {
          planVersion: latestPlan.version,
          githubDispatchStatus: ghResult.status,
          githubIssueNumber: ghResult.issueNumber,
        },
      });

      const updatedRecord = await loadFeedbackRecord(id);
      return {
        item: projectFeedbackItemForActor(
          updatedRecord!.item,
          updatedRecord!.plans,
          updatedRecord!.messages,
          request.actor,
          true
        ),
        githubError: ghResult.error ?? null,
      };
    }
  );

  // 11. Admin: Retry GitHub Issue creation on an approved ticket
  app.post(
    '/api/feedback/:id/retry-github',
    {
      preHandler: [requirePermission('feedback:manage')],
      schema: { tags: ['Feedback'], summary: 'Admin-only: retry GitHub Issue creation' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const record = await loadFeedbackRecord(id);
      if (!record) {
        return reply.status(404).send({ error: 'NotFound', message: 'Feedback ticket not found.' });
      }
      if (!['approved', 'in_progress', 'deployed'].includes(record.item.status)) {
        return reply.status(400).send({
          error: 'InvalidState',
          message: 'Approve the fix plan before dispatching to GitHub.',
        });
      }

      const latestPlan = [...record.plans].sort((a, b) => b.version - a.version)[0];
      if (!latestPlan) {
        return reply.status(400).send({ error: 'NoPlanAvailable', message: 'No fix plan found.' });
      }

      const ghResult = await createApprovedFixGitHubIssue(record.item, latestPlan, record.messages);

      if (isUsingDemoStore()) {
        record.item.githubDispatchStatus = ghResult.status;
        record.item.githubIssueNumber = ghResult.issueNumber;
        record.item.githubIssueUrl = ghResult.issueUrl;
        record.item.updatedAt = new Date().toISOString();
      } else {
        const db = getDb();
        await db
          .update(feedbackItems)
          .set({
            githubDispatchStatus: ghResult.status,
            githubIssueNumber: ghResult.issueNumber,
            githubIssueUrl: ghResult.issueUrl,
            updatedAt: new Date(),
          })
          .where(eq(feedbackItems.id, id));
      }

      const updatedRecord = await loadFeedbackRecord(id);
      return {
        item: projectFeedbackItemForActor(
          updatedRecord!.item,
          updatedRecord!.plans,
          updatedRecord!.messages,
          request.actor,
          true
        ),
        githubError: ghResult.error ?? null,
      };
    }
  );

  // 12. Admin: Reject or defer ticket
  app.post(
    '/api/feedback/:id/reject',
    {
      preHandler: [requirePermission('feedback:manage')],
      schema: { tags: ['Feedback'], summary: 'Admin-only: reject or defer feedback item' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = rejectFeedbackSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      const record = await loadFeedbackRecord(id);
      if (!record) {
        return reply.status(404).send({ error: 'NotFound', message: 'Feedback ticket not found.' });
      }

      const nowIso = new Date().toISOString();
      const note = redactString(parsed.data.resolutionNote, 2000);
      const adminNotes = parsed.data.adminNotes ? redactString(parsed.data.adminNotes, 2000) : record.item.adminNotes;

      if (isUsingDemoStore()) {
        for (const p of demoStore.feedbackFixPlans) {
          if (p.feedbackItemId === id && p.status === 'pending_approval') {
            p.status = 'rejected';
          }
        }
        record.item.status = 'rejected';
        record.item.resolutionNote = note;
        record.item.adminNotes = adminNotes ?? null;
        record.item.resolvedAt = nowIso;
        record.item.updatedAt = nowIso;
        demoStore.feedbackMessages.push({
          id: `fbm-${Date.now()}-rej`,
          feedbackItemId: id,
          senderType: 'admin',
          senderUserId: request.actor.userId,
          senderName: request.actor.fullName,
          body: note,
          visibleToReporter: true,
          createdAt: nowIso,
        });
      } else {
        const db = getDb();
        await db
          .update(feedbackFixPlans)
          .set({ status: 'rejected' })
          .where(and(eq(feedbackFixPlans.feedbackItemId, id), eq(feedbackFixPlans.status, 'pending_approval')));

        await db
          .update(feedbackItems)
          .set({
            status: 'rejected',
            resolutionNote: note,
            adminNotes: adminNotes ?? null,
            resolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(feedbackItems.id, id));

        await db.insert(feedbackMessages).values({
          feedbackItemId: id,
          senderType: 'admin',
          senderUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
          senderName: request.actor.fullName,
          body: note,
          visibleToReporter: true,
        });
      }

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'FEEDBACK_REJECTED',
        entityType: 'feedback_item',
        entityId: record.item.ticketKey,
        ipAddress: request.ip,
        afterValues: { resolutionNote: note },
      });

      const updatedRecord = await loadFeedbackRecord(id);
      void notifyReporterOutcome(updatedRecord!.item, request.actor.userId);

      return {
        item: projectFeedbackItemForActor(
          updatedRecord!.item,
          updatedRecord!.plans,
          updatedRecord!.messages,
          request.actor,
          true
        ),
      };
    }
  );

  // 13. Admin: Close the loop (in_progress -> deployed)
  app.patch(
    '/api/feedback/:id/status',
    {
      preHandler: [requirePermission('feedback:manage')],
      schema: { tags: ['Feedback'], summary: 'Admin-only: update delivery status and close feedback loop' },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateFeedbackStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'ValidationError', details: parsed.error.flatten() });
      }

      const record = await loadFeedbackRecord(id);
      if (!record) {
        return reply.status(404).send({ error: 'NotFound', message: 'Feedback ticket not found.' });
      }

      const nextStatus = parsed.data.status;
      const nowIso = new Date().toISOString();
      const note = parsed.data.resolutionNote
        ? redactString(parsed.data.resolutionNote, 2000)
        : record.item.resolutionNote;

      if (isUsingDemoStore()) {
        record.item.status = nextStatus;
        record.item.resolutionNote = note ?? null;
        record.item.updatedAt = nowIso;
        if (nextStatus === 'deployed') {
          record.item.resolvedAt = nowIso;
        }
        if (parsed.data.resolutionNote) {
          demoStore.feedbackMessages.push({
            id: `fbm-${Date.now()}-st`,
            feedbackItemId: id,
            senderType: 'admin',
            senderUserId: request.actor.userId,
            senderName: request.actor.fullName,
            body: redactString(parsed.data.resolutionNote, 2000),
            visibleToReporter: true,
            createdAt: nowIso,
          });
        }
      } else {
        const db = getDb();
        await db
          .update(feedbackItems)
          .set({
            status: nextStatus,
            resolutionNote: note ?? null,
            resolvedAt: nextStatus === 'deployed' ? new Date() : record.item.resolvedAt ? new Date(record.item.resolvedAt) : null,
            updatedAt: new Date(),
          })
          .where(eq(feedbackItems.id, id));

        if (parsed.data.resolutionNote) {
          await db.insert(feedbackMessages).values({
            feedbackItemId: id,
            senderType: 'admin',
            senderUserId: isValidUuid(request.actor.userId) ? request.actor.userId : null,
            senderName: request.actor.fullName,
            body: redactString(parsed.data.resolutionNote, 2000),
            visibleToReporter: true,
          });
        }
      }

      await writeAuditLog({
        actorUserId: request.actor.userId,
        actorEmail: request.actor.email,
        action: 'FEEDBACK_STATUS_UPDATED',
        entityType: 'feedback_item',
        entityId: record.item.ticketKey,
        ipAddress: request.ip,
        beforeValues: { status: record.item.status },
        afterValues: { status: nextStatus, resolutionNote: note },
      });

      const updatedRecord = await loadFeedbackRecord(id);
      if (nextStatus === 'deployed') {
        void notifyReporterOutcome(updatedRecord!.item, request.actor.userId);
      }

      return {
        item: projectFeedbackItemForActor(
          updatedRecord!.item,
          updatedRecord!.plans,
          updatedRecord!.messages,
          request.actor,
          true
        ),
      };
    }
  );
}
