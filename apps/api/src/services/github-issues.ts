import {
  redactString,
  redactValue,
  type DiagnosticSnapshot,
  type FeedbackCategory,
  type FeedbackFixPlanDTO,
  type FeedbackMessageDTO,
  type FeedbackSeverity,
  type GithubDispatchStatus,
  type PageContext,
} from '@interstate/shared';

export interface TicketBriefInput {
  ticketKey: string;
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  title: string;
  description: string;
  reporterName: string;
  reporterRole: string;
  pagePath: string;
  pageContext: PageContext;
  diagnosticSnapshot: DiagnosticSnapshot;
}

/**
 * Renders a self-contained, redacted Markdown brief suitable for GitHub Issues or AI coding agents.
 */
export function formatAgentFixBriefMarkdown(
  ticket: TicketBriefInput,
  plan: FeedbackFixPlanDTO,
  messages: FeedbackMessageDTO[] = []
): string {
  const lines: string[] = [];
  lines.push(`# [${ticket.ticketKey}] ${redactString(ticket.title, 200)}`);
  lines.push('');
  lines.push(
    `- **Category:** \`${ticket.category}\` | **Severity:** \`${ticket.severity}\` | **Plan Version:** \`v${plan.version}\` (\`${plan.modelName}\`)`
  );
  lines.push(
    `- **Reported By:** ${redactString(ticket.reporterName, 100)} (\`${ticket.reporterRole}\`)`
  );
  lines.push(
    `- **Page Path:** \`${redactString(ticket.pagePath, 200)}\`${ticket.pageContext.entityLabel ? ` | **Entity:** ${redactString(ticket.pageContext.entityLabel, 120)}` : ''}`
  );
  lines.push(`- **Risk / Effort:** \`${plan.riskLevel}\` risk / \`${plan.estimatedEffort.toUpperCase()}\` effort`);
  lines.push('');
  lines.push('## User Report');
  lines.push(redactString(ticket.description, 4000));
  lines.push('');

  if (messages.length > 0) {
    const visibleTranscript = messages.filter((m) => m.visibleToReporter).slice(-12);
    if (visibleTranscript.length > 0) {
      lines.push('## Conversation Transcript');
      for (const msg of visibleTranscript) {
        lines.push(`- **${redactString(msg.senderName, 80)} (${msg.senderType}):** ${redactString(msg.body, 800)}`);
      }
      lines.push('');
    }
  }

  lines.push('## Approved Fix Plan');
  lines.push(`**Summary:** ${redactString(plan.summary, 2000)}`);
  lines.push('');
  lines.push(`**Root Cause / Goal:** ${redactString(plan.rootCauseOrGoal, 3000)}`);
  lines.push('');
  lines.push(`**Security & RBAC Impact:** ${redactString(plan.securityRbacImpact, 1500)}`);
  lines.push('');

  lines.push('### Affected Files');
  for (const file of plan.affectedFiles) {
    lines.push(`- \`[${file.changeType}]\` \`${file.path}\` — ${redactString(file.reason, 400)}`);
  }
  lines.push('');

  if (plan.schemaChanges.length > 0) {
    lines.push('### Schema / Migration Changes');
    for (const sc of plan.schemaChanges) {
      lines.push(`- ${redactString(sc, 400)}`);
    }
    lines.push('');
  }

  lines.push('### Implementation Steps');
  for (const step of plan.implementationSteps) {
    lines.push(`${step.order}. **${redactString(step.title, 200)}** — ${redactString(step.details, 1000)}`);
  }
  lines.push('');

  lines.push('### Verification Checklist');
  for (const check of plan.verificationSteps) {
    lines.push(`- [ ] ${redactString(check, 500)}`);
  }
  lines.push('');

  lines.push('## Redacted Page & Diagnostic Snapshot');
  lines.push('```json');
  lines.push(
    JSON.stringify(
      redactValue({
        pageContext: ticket.pageContext,
        serverLogs: ticket.diagnosticSnapshot.serverLogs.slice(0, 10),
        failedNetworkEvents: ticket.diagnosticSnapshot.networkEvents.filter((n) => !n.ok).slice(0, 10),
        clientLogs: ticket.diagnosticSnapshot.clientLogs.slice(0, 15),
        breadcrumbs: ticket.diagnosticSnapshot.breadcrumbs.slice(-15),
      }),
      null,
      2
    )
  );
  lines.push('```');
  lines.push('');
  lines.push('> Generated from Interstate Homes Closed-Loop Feedback System. Target `staging` first.');

  return lines.join('\n');
}

export interface GitHubDispatchResult {
  status: GithubDispatchStatus;
  issueNumber: number | null;
  issueUrl: string | null;
  error?: string;
}

/**
 * Dispatches an approved fix plan to GitHub Issues on MCDesignCO/InterstateHomes.
 * Degrades cleanly to `not_configured` when GITHUB_TOKEN is unset.
 */
export async function createApprovedFixGitHubIssue(
  ticket: TicketBriefInput,
  plan: FeedbackFixPlanDTO,
  messages: FeedbackMessageDTO[] = []
): Promise<GitHubDispatchResult> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return { status: 'not_configured', issueNumber: null, issueUrl: null };
  }

  const repoSlug = (process.env.GITHUB_REPO ?? 'MCDesignCO/InterstateHomes').trim();
  const [owner, repo] = repoSlug.split('/');
  if (!owner || !repo) {
    return {
      status: 'failed',
      issueNumber: null,
      issueUrl: null,
      error: `Invalid GITHUB_REPO value "${repoSlug}"`,
    };
  }

  const labels = [
    'approved-fix',
    ticket.category === 'bug' ? 'bug' : 'enhancement',
    'feedback-loop',
  ];

  const body = formatAgentFixBriefMarkdown(ticket, plan, messages);

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'InterstateHomes-FeedbackLoop/1.0',
      },
      body: JSON.stringify({
        title: `[${ticket.ticketKey}] ${redactString(ticket.title, 180)}`,
        body,
        labels,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      return {
        status: 'failed',
        issueNumber: null,
        issueUrl: null,
        error: `GitHub API returned ${res.status}: ${redactString(errText, 240)}`,
      };
    }

    const json = (await res.json()) as { number?: number; html_url?: string };
    return {
      status: 'created',
      issueNumber: typeof json.number === 'number' ? json.number : null,
      issueUrl: typeof json.html_url === 'string' ? json.html_url : null,
    };
  } catch (err) {
    return {
      status: 'failed',
      issueNumber: null,
      issueUrl: null,
      error: err instanceof Error ? redactString(err.message, 240) : 'GitHub request failed',
    };
  }
}
