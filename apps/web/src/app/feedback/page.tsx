'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  GitBranch,
  RefreshCw,
  Send,
  Sparkles,
  Terminal,
  XCircle,
} from 'lucide-react';
import type {
  FeedbackCategory,
  FeedbackItemAdminDTO,
  FeedbackItemReporterDTO,
  FeedbackStatus,
} from '@interstate/shared';
import { apiFetch } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

const STATUS_BADGES: Record<FeedbackStatus, { label: string; cls: string }> = {
  triage: { label: 'Triage', cls: 'bg-[#F4F4F1] text-[#3B3B38]' },
  plan_generating: { label: 'Generating Plan', cls: 'bg-[#DBEAFE] text-[#1E40AF]' },
  plan_ready: { label: 'Awaiting Approval', cls: 'bg-[#FEF3C7] text-[#8A5A00]' },
  approved: { label: 'Approved', cls: 'bg-[#DBEAFE] text-[#1E40AF]' },
  in_progress: { label: 'In Progress', cls: 'bg-[#FFEDD5] text-[#9A3412]' },
  deployed: { label: 'Deployed', cls: 'bg-[#DCFCE7] text-[#166534]' },
  rejected: { label: 'Rejected / Deferred', cls: 'bg-[#FEE2E2] text-[#991B1B]' },
};

const RISK_BADGES: Record<string, string> = {
  low: 'bg-[#DCFCE7] text-[#166534]',
  medium: 'bg-[#FEF3C7] text-[#8A5A00]',
  high: 'bg-[#FEE2E2] text-[#991B1B]',
};

export default function FeedbackPage() {
  const { role, subCompanyId } = useRole();
  const isAdmin = role === 'admin';

  const [items, setItems] = useState<Array<FeedbackItemAdminDTO | FeedbackItemReporterDTO>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FeedbackItemAdminDTO | FeedbackItemReporterDTO | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [detailTab, setDetailTab] = useState<'plan' | 'diagnostics' | 'conversation'>('plan');
  const [selectedPlanVersion, setSelectedPlanVersion] = useState<number | null>(null);

  const [loadingList, setLoadingList] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedBrief, setCopiedBrief] = useState(false);

  const [showRevisionBox, setShowRevisionBox] = useState(false);
  const [revisionText, setRevisionText] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [deployNote, setDeployNote] = useState('');
  const [showDeployBox, setShowDeployBox] = useState(false);

  const [replyBody, setReplyBody] = useState('');
  const [visibleToReporter, setVisibleToReporter] = useState(true);
  const [screenshotBlobUrl, setScreenshotBlobUrl] = useState<string | null>(null);

  usePageContext({
    section: 'Feedback & Fix Plans',
    entityType: 'feedback_queue',
    entityId: detail?.id,
    entityLabel: detail ? `${detail.ticketKey} (${detail.status})` : `${items.length} Tickets`,
    summary: {
      totalTickets: items.length,
      awaitingApproval: items.filter((i) => i.status === 'plan_ready').length,
      isAdmin,
    },
  });

  const loadList = async (keepSelection = true) => {
    setLoadingList(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (categoryFilter !== 'all') qs.set('category', categoryFilter);
      const res = await apiFetch<{ items: Array<FeedbackItemAdminDTO | FeedbackItemReporterDTO> }>(
        `/api/feedback${qs.toString() ? `?${qs.toString()}` : ''}`,
        { role, subCompanyId }
      );
      setItems(res.items);

      const urlId =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('id')
          : null;

      if (urlId && res.items.some((i) => i.id === urlId)) {
        setSelectedId(urlId);
      } else if (!keepSelection || !selectedId || !res.items.some((i) => i.id === selectedId)) {
        const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
        setSelectedId(isDesktop ? (res.items[0]?.id ?? null) : null);
      }
    } catch (err) {
      setToast({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to load feedback items',
      });
    } finally {
      setLoadingList(false);
    }
  };

  const loadDetail = async (id: string) => {
    try {
      const res = await apiFetch<{ item: FeedbackItemAdminDTO | FeedbackItemReporterDTO }>(
        `/api/feedback/${id}`,
        { role, subCompanyId }
      );
      setDetail(res.item);
      if ('fixPlans' in res.item && res.item.fixPlans && res.item.fixPlans.length > 0) {
        setSelectedPlanVersion(res.item.fixPlans[0]!.version);
      } else {
        setSelectedPlanVersion(null);
      }
    } catch (err) {
      setDetail(null);
      setToast({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to load ticket detail',
      });
    }
  };

  useEffect(() => {
    setDetailTab(isAdmin ? 'plan' : 'conversation');
    void loadList(false);
  }, [role, subCompanyId, statusFilter, categoryFilter]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, role, subCompanyId]);

  useEffect(() => {
    const onRefresh = () => {
      void loadList(true);
      if (selectedId) void loadDetail(selectedId);
    };
    window.addEventListener('interstate:feedback-updated', onRefresh);
    return () => window.removeEventListener('interstate:feedback-updated', onRefresh);
  }, [selectedId, role, subCompanyId]);

  // Fetch screenshot securely with role/cookie headers for preview
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const adminDetail = detail as FeedbackItemAdminDTO | null;

    if (!isAdmin || !adminDetail?.screenshotUrl) {
      setScreenshotBlobUrl(null);
      return;
    }

    fetch(adminDetail.screenshotUrl, {
      credentials: 'include',
      headers: {
        'x-demo-role': role,
        'x-demo-sub-id': subCompanyId,
      },
    })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setScreenshotBlobUrl(objectUrl);
      })
      .catch(() => {
        if (active) setScreenshotBlobUrl(null);
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [detail, isAdmin, role, subCompanyId]);

  const adminDetail = isAdmin && detail && 'diagnosticSnapshot' in detail ? (detail as FeedbackItemAdminDTO) : null;
  const activePlan = useMemo(() => {
    if (!adminDetail?.fixPlans?.length) return null;
    return (
      adminDetail.fixPlans.find((p) => p.version === selectedPlanVersion) ??
      adminDetail.fixPlans[0] ??
      null
    );
  }, [adminDetail, selectedPlanVersion]);

  const kpis = useMemo(() => {
    return {
      awaiting: items.filter((i) => i.status === 'plan_ready').length,
      approved: items.filter((i) => i.status === 'approved').length,
      inProgress: items.filter((i) => i.status === 'in_progress').length,
      deployed: items.filter((i) => i.status === 'deployed').length,
    };
  }, [items]);

  const handleCopyBrief = async () => {
    if (!adminDetail?.agentBriefMarkdown) return;
    try {
      await navigator.clipboard.writeText(adminDetail.agentBriefMarkdown);
      setCopiedBrief(true);
      setTimeout(() => setCopiedBrief(false), 2000);
    } catch {
      setToast({ type: 'err', text: 'Clipboard permission denied' });
    }
  };

  const handleApprove = async () => {
    if (!adminDetail) return;
    setActionBusy(true);
    setToast(null);
    try {
      const res = await apiFetch<{ item: FeedbackItemAdminDTO; githubError?: string | null }>(
        `/api/feedback/${adminDetail.id}/approve`,
        {
          method: 'POST',
          role,
          subCompanyId,
          body: JSON.stringify({ createGithubIssue: true }),
        }
      );
      setDetail(res.item);
      setToast({
        type: 'ok',
        text:
          res.item.githubDispatchStatus === 'created'
            ? `Approved and created GitHub Issue #${res.item.githubIssueNumber}.`
            : `Plan approved! ${res.githubError ? `GitHub note: ${res.githubError}` : 'Use "Copy Agent Fix Brief" or configure GITHUB_TOKEN for auto-issues.'}`,
      });
      window.dispatchEvent(new Event('interstate:feedback-updated'));
      void loadList(true);
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'Approval failed' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleRetryGithub = async () => {
    if (!adminDetail) return;
    setActionBusy(true);
    setToast(null);
    try {
      const res = await apiFetch<{ item: FeedbackItemAdminDTO; githubError?: string | null }>(
        `/api/feedback/${adminDetail.id}/retry-github`,
        { method: 'POST', role, subCompanyId, body: JSON.stringify({}) }
      );
      setDetail(res.item);
      setToast({
        type: res.item.githubDispatchStatus === 'created' ? 'ok' : 'err',
        text:
          res.item.githubDispatchStatus === 'created'
            ? `Created GitHub Issue #${res.item.githubIssueNumber}.`
            : res.githubError || `GitHub status: ${res.item.githubDispatchStatus}`,
      });
    } catch (err) {
      setToast({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to retry GitHub issue creation.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleRevisePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminDetail || revisionText.trim().length < 3) return;
    setActionBusy(true);
    setToast(null);
    try {
      const res = await apiFetch<{ item: FeedbackItemAdminDTO }>(
        `/api/feedback/${adminDetail.id}/revise-plan`,
        {
          method: 'POST',
          role,
          subCompanyId,
          body: JSON.stringify({ feedback: revisionText.trim() }),
        }
      );
      setDetail(res.item);
      if (res.item.fixPlans?.[0]) setSelectedPlanVersion(res.item.fixPlans[0].version);
      setRevisionText('');
      setShowRevisionBox(false);
      setToast({ type: 'ok', text: `Generated revised fix plan v${res.item.fixPlans?.[0]?.version ?? 2}.` });
      void loadList(true);
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'Revision failed' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminDetail || rejectNote.trim().length < 3) return;
    setActionBusy(true);
    try {
      const res = await apiFetch<{ item: FeedbackItemAdminDTO }>(
        `/api/feedback/${adminDetail.id}/reject`,
        {
          method: 'POST',
          role,
          subCompanyId,
          body: JSON.stringify({ resolutionNote: rejectNote.trim() }),
        }
      );
      setDetail(res.item);
      setRejectNote('');
      setShowRejectBox(false);
      setToast({ type: 'ok', text: 'Ticket updated with reporter-facing response.' });
      window.dispatchEvent(new Event('interstate:feedback-updated'));
      void loadList(true);
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'Reject failed' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleStatusUpdate = async (nextStatus: 'in_progress' | 'deployed', note?: string) => {
    if (!adminDetail) return;
    setActionBusy(true);
    try {
      const res = await apiFetch<{ item: FeedbackItemAdminDTO }>(
        `/api/feedback/${adminDetail.id}/status`,
        {
          method: 'PATCH',
          role,
          subCompanyId,
          body: JSON.stringify({
            status: nextStatus,
            resolutionNote: note?.trim() || undefined,
          }),
        }
      );
      setDetail(res.item);
      setDeployNote('');
      setShowDeployBox(false);
      setToast({
        type: 'ok',
        text:
          nextStatus === 'deployed'
            ? 'Marked Deployed and closed the loop with the reporter.'
            : 'Marked In Progress.',
      });
      window.dispatchEvent(new Event('interstate:feedback-updated'));
      void loadList(true);
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'Status update failed' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !replyBody.trim()) return;
    setActionBusy(true);
    try {
      await apiFetch(`/api/feedback/${detail.id}/messages`, {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          body: replyBody.trim(),
          visibleToReporter: isAdmin ? visibleToReporter : true,
        }),
      });
      setReplyBody('');
      await loadDetail(detail.id);
    } catch (err) {
      setToast({ type: 'err', text: err instanceof Error ? err.message : 'Failed to post message' });
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
            {isAdmin ? 'Feedback Queue & AI Fix-Plan Approvals' : 'My Feedback & Feature Requests'}
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            {isAdmin
              ? 'Review page context, diagnostic logs, and AI-generated fix plans before dispatching to GitHub.'
              : 'Track your bug reports and feature requests from submission through deployment.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadList(true)}
          className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded border border-[#E3E3DE] bg-white hover:bg-[#F4F4F1] text-xs font-semibold cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {toast ? (
        <div
          className={`rounded-lg px-4 py-2 text-xs font-medium border flex items-center justify-between gap-2 ${
            toast.type === 'ok'
              ? 'bg-[#DCFCE7] border-[#86EFAC] text-[#166534]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <span className="min-w-0 break-words">{toast.text}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="min-h-[44px] sm:min-h-0 px-2 inline-flex items-center text-xs underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Admin KPI Strip */}
      {isAdmin ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-3.5 min-w-0">
            <div className="text-[11px] font-display uppercase text-[#5F5F5A]">Awaiting Approval</div>
            <div className="text-2xl font-display font-bold text-[#8A5A00] mt-1 tabular-nums">{kpis.awaiting}</div>
          </div>
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-3.5 min-w-0">
            <div className="text-[11px] font-display uppercase text-[#5F5F5A]">Approved</div>
            <div className="text-2xl font-display font-bold text-[#1E40AF] mt-1 tabular-nums">{kpis.approved}</div>
          </div>
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-3.5 min-w-0">
            <div className="text-[11px] font-display uppercase text-[#5F5F5A]">In Progress</div>
            <div className="text-2xl font-display font-bold text-[#9A3412] mt-1 tabular-nums">{kpis.inProgress}</div>
          </div>
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-3.5 min-w-0">
            <div className="text-[11px] font-display uppercase text-[#5F5F5A]">Deployed / Closed</div>
            <div className="text-2xl font-display font-bold text-[#166534] mt-1 tabular-nums">{kpis.deployed}</div>
          </div>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <select
          aria-label="Filter feedback by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-xs font-semibold text-[#111111]"
        >
          <option value="all">All Statuses</option>
          <option value="plan_ready">Awaiting Approval</option>
          <option value="approved">Approved</option>
          <option value="in_progress">In Progress</option>
          <option value="deployed">Deployed</option>
          <option value="rejected">Rejected / Deferred</option>
        </select>
        <select
          aria-label="Filter feedback by category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as FeedbackCategory | 'all')}
          className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-xs font-semibold text-[#111111]"
        >
          <option value="all">All Categories</option>
          <option value="bug">Bugs</option>
          <option value="feature">Feature Requests</option>
          <option value="question">Questions</option>
        </select>
      </div>

      {/* Split Master / Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left List */}
        <div
          className={`lg:col-span-4 space-y-2 min-w-0 ${selectedId ? 'hidden lg:block' : 'block'}`}
        >
          {loadingList ? (
            <div className="bg-white border border-[#E3E3DE] rounded-lg p-6 text-xs text-[#5F5F5A] text-center">
              Loading tickets…
            </div>
          ) : items.length === 0 ? (
            <div className="bg-white border border-[#E3E3DE] rounded-lg p-6 text-xs text-[#5F5F5A] text-center">
              No tickets match these filters. Use the bottom-right Feedback widget to submit one.
            </div>
          ) : (
            items.map((item) => {
              const badge = STATUS_BADGES[item.status] ?? STATUS_BADGES.triage;
              const active = selectedId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left bg-white border rounded-lg p-3.5 space-y-1.5 transition-colors cursor-pointer ${
                    active ? 'border-[#111111] ring-1 ring-[#FCAE1A]' : 'border-[#E3E3DE] hover:border-[#9D9D97]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span className="font-mono text-[11px] font-bold text-[#5F5F5A] truncate">
                      {item.ticketKey} · {item.category.toUpperCase()}
                    </span>
                    <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="text-xs font-display font-bold text-[#111111] line-clamp-2 break-words">
                    {item.title}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-[#5F5F5A] min-w-0">
                    <span className="truncate">{item.pagePath}</span>
                    <span className="shrink-0 tabular-nums">{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Right Detail */}
        <div className={`lg:col-span-8 min-w-0 ${selectedId ? 'block' : 'hidden lg:block'}`}>
          {!detail ? (
            <div className="bg-white border border-[#E3E3DE] rounded-lg p-8 text-xs text-[#5F5F5A] text-center">
              Select a ticket to inspect details.
            </div>
          ) : (
            <div className="bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
              {/* Ticket Header */}
              <div className="p-4 sm:p-5 border-b border-[#E3E3DE] space-y-3">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="lg:hidden min-h-[44px] -ml-2 px-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#5F5F5A] hover:text-[#111111] cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to list</span>
                </button>

                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#111111] text-[#FCAE1A]">
                        {detail.ticketKey}
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                          (STATUS_BADGES[detail.status] ?? STATUS_BADGES.triage).cls
                        }`}
                      >
                        {(STATUS_BADGES[detail.status] ?? STATUS_BADGES.triage).label}
                      </span>
                      <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded bg-[#F4F4F1] text-[#3B3B38]">
                        {detail.category} · {detail.severity}
                      </span>
                    </div>
                    <h2 className="text-base sm:text-lg font-display font-bold text-[#111111] break-words">
                      {detail.title}
                    </h2>
                    <div className="text-xs text-[#5F5F5A] break-words">
                      Page: <span className="font-mono text-[#111111] break-all">{detail.pagePath}</span>
                      {detail.pageContext?.entityLabel ? ` (${detail.pageContext.entityLabel})` : ''}
                      {adminDetail ? ` · Reported by ${adminDetail.reporterName} (${adminDetail.reporterRole})` : ''}
                    </div>
                  </div>

                  {adminDetail ? (
                    <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 w-full sm:w-auto">
                      {adminDetail.agentBriefMarkdown ? (
                        <button
                          type="button"
                          onClick={handleCopyBrief}
                          className="min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 rounded border border-[#E3E3DE] bg-[#F4F4F1] hover:bg-[#E3E3DE] text-xs font-semibold cursor-pointer"
                        >
                          {copiedBrief ? <Check className="w-3.5 h-3.5 text-[#166534]" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
                          <span>{copiedBrief ? 'Copied Brief' : 'Copy Agent Fix Brief'}</span>
                        </button>
                      ) : null}
                      {adminDetail.githubIssueUrl ? (
                        <a
                          href={adminDetail.githubIssueUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 rounded bg-[#111111] text-white text-xs font-semibold hover:bg-[#262624]"
                        >
                          <GitBranch className="w-3.5 h-3.5 text-[#FCAE1A]" />
                          <span>Issue #{adminDetail.githubIssueNumber}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : ['approved', 'in_progress', 'deployed'].includes(adminDetail.status) ? (
                        <button
                          type="button"
                          onClick={handleRetryGithub}
                          disabled={actionBusy}
                          className="min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 rounded border border-[#FDE68A] bg-[#FEF3C7] text-[#8A5A00] text-xs font-semibold cursor-pointer"
                        >
                          <GitBranch className="w-3.5 h-3.5" />
                          <span>
                            {adminDetail.githubDispatchStatus === 'not_configured'
                              ? 'GitHub Token Unset (Retry)'
                              : 'Retry GitHub Issue'}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <p className="text-xs text-[#3B3B38] bg-[#FAFAF8] border border-[#E3E3DE] rounded p-3 whitespace-pre-wrap break-words">
                  {detail.description}
                </p>

                {detail.resolutionNote ? (
                  <div className="bg-[#DCFCE7] border border-[#86EFAC] rounded p-3 text-xs text-[#14532D] break-words">
                    <span className="font-bold">Resolution Note: </span>
                    {detail.resolutionNote}
                  </div>
                ) : null}
              </div>

              {/* Detail Tabs */}
              <div className="flex border-b border-[#E3E3DE] bg-[#F4F4F1] text-xs font-display font-semibold overflow-x-auto">
                {isAdmin ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setDetailTab('plan')}
                      className={`min-h-[44px] px-4 py-2.5 whitespace-nowrap cursor-pointer ${
                        detailTab === 'plan'
                          ? 'bg-white text-[#111111] border-b-2 border-[#FCAE1A]'
                          : 'text-[#5F5F5A]'
                      }`}
                    >
                      AI Fix Plan &amp; Approval
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('diagnostics')}
                      className={`min-h-[44px] px-4 py-2.5 whitespace-nowrap cursor-pointer ${
                        detailTab === 'diagnostics'
                          ? 'bg-white text-[#111111] border-b-2 border-[#FCAE1A]'
                          : 'text-[#5F5F5A]'
                      }`}
                    >
                      Diagnostics &amp; Logs
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDetailTab('conversation')}
                  className={`min-h-[44px] px-4 py-2.5 whitespace-nowrap cursor-pointer ${
                    detailTab === 'conversation' || !isAdmin
                      ? 'bg-white text-[#111111] border-b-2 border-[#FCAE1A]'
                      : 'text-[#5F5F5A]'
                  }`}
                >
                  Conversation ({detail.messages?.length ?? 0})
                </button>
              </div>

              {/* Tab Content */}
              <div className="p-4 sm:p-5 space-y-4">
                {isAdmin && detailTab === 'plan' && adminDetail ? (
                  activePlan ? (
                    <div className="space-y-4">
                      {/* Plan Meta & Version Switcher */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="inline-flex items-center gap-1 text-xs font-display font-bold text-[#111111]">
                            <Sparkles className="w-4 h-4 text-[#FCAE1A]" />
                            <span>Fix Plan v{activePlan.version}</span>
                          </span>
                          <span className="text-[11px] font-mono text-[#5F5F5A] break-all">
                            ({activePlan.modelName})
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${
                              RISK_BADGES[activePlan.riskLevel] ?? RISK_BADGES.low
                            }`}
                          >
                            {activePlan.riskLevel} risk · {activePlan.estimatedEffort.toUpperCase()}
                          </span>
                        </div>
                        {adminDetail.fixPlans && adminDetail.fixPlans.length > 1 ? (
                          <select
                            aria-label="Select fix plan version"
                            value={activePlan.version}
                            onChange={(e) => setSelectedPlanVersion(Number(e.target.value))}
                            className="w-full sm:w-auto min-h-[44px] sm:min-h-[34px] border border-[#E3E3DE] rounded px-2.5 py-1.5 text-xs bg-white"
                          >
                            {adminDetail.fixPlans.map((p) => (
                              <option key={p.id} value={p.version}>
                                v{p.version} ({p.status})
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </div>

                      {activePlan.revisionFeedback ? (
                        <div className="bg-[#FEF3C7]/60 border border-[#FDE68A] rounded p-2.5 text-xs text-[#8A5A00]">
                          <strong>Revision Guidance:</strong> {activePlan.revisionFeedback}
                        </div>
                      ) : null}

                      <div className="space-y-2 text-xs">
                        <div>
                          <div className="font-display font-bold text-[#111111]">Summary</div>
                          <p className="text-[#3B3B38] mt-0.5">{activePlan.summary}</p>
                        </div>
                        <div>
                          <div className="font-display font-bold text-[#111111]">Root Cause / Goal</div>
                          <p className="text-[#3B3B38] mt-0.5">{activePlan.rootCauseOrGoal}</p>
                        </div>
                        <div>
                          <div className="font-display font-bold text-[#111111]">Security &amp; RBAC Impact</div>
                          <p className="text-[#3B3B38] mt-0.5">{activePlan.securityRbacImpact}</p>
                        </div>
                      </div>

                      {/* Affected Files */}
                      <div>
                        <div className="text-xs font-display font-bold text-[#111111] mb-1.5">
                          Affected Files
                        </div>
                        <div className="border border-[#E3E3DE] rounded-md divide-y divide-[#E3E3DE] text-xs">
                          {activePlan.affectedFiles.map((f, idx) => (
                            <div key={idx} className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                              <span className="font-mono font-semibold text-[#111111] break-all">
                                [{f.changeType}] {f.path}
                              </span>
                              <span className="text-[#5F5F5A] text-[11px]">{f.reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Steps */}
                      <div>
                        <div className="text-xs font-display font-bold text-[#111111] mb-1.5">
                          Implementation Steps
                        </div>
                        <ol className="space-y-2">
                          {activePlan.implementationSteps.map((step) => (
                            <li key={step.order} className="border border-[#E3E3DE] rounded p-2.5 text-xs">
                              <div className="font-semibold text-[#111111]">
                                {step.order}. {step.title}
                              </div>
                              <div className="text-[#5F5F5A] mt-0.5">{step.details}</div>
                            </li>
                          ))}
                        </ol>
                      </div>

                      {/* Verification */}
                      <div>
                        <div className="text-xs font-display font-bold text-[#111111] mb-1">
                          Verification Checklist
                        </div>
                        <ul className="list-disc pl-5 text-xs text-[#3B3B38] space-y-1">
                          {activePlan.verificationSteps.map((v, i) => (
                            <li key={i}>{v}</li>
                          ))}
                        </ul>
                      </div>

                      {/* Admin Approval Controls */}
                      <div className="pt-3 border-t border-[#E3E3DE] space-y-3">
                        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                          {['plan_ready', 'triage'].includes(adminDetail.status) ? (
                            <>
                              <button
                                type="button"
                                onClick={handleApprove}
                                disabled={actionBusy}
                                className="min-h-[44px] sm:min-h-[38px] w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded bg-[#FCAE1A] hover:bg-[#E59C12] text-[#111111] text-xs font-display font-bold disabled:opacity-50 cursor-pointer"
                              >
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                                <span>Approve &amp; Create GitHub Issue</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowRevisionBox((v) => !v);
                                  setShowRejectBox(false);
                                }}
                                className="min-h-[44px] sm:min-h-[38px] w-full sm:w-auto px-3 py-2 rounded border border-[#E3E3DE] bg-white hover:bg-[#F4F4F1] text-xs font-semibold cursor-pointer"
                              >
                                Request AI Revision
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowRejectBox((v) => !v);
                                  setShowRevisionBox(false);
                                }}
                                className="min-h-[44px] sm:min-h-[38px] w-full sm:w-auto inline-flex items-center justify-center gap-1 px-3 py-2 rounded border border-[#FECACA] bg-[#FEF2F2] text-[#991B1B] text-xs font-semibold cursor-pointer"
                              >
                                <XCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>Reject / Defer</span>
                              </button>
                            </>
                          ) : null}

                          {adminDetail.status === 'approved' ? (
                            <button
                              type="button"
                              onClick={() => void handleStatusUpdate('in_progress')}
                              disabled={actionBusy}
                              className="min-h-[44px] sm:min-h-[38px] w-full sm:w-auto px-3 py-2 rounded bg-[#111111] text-white text-xs font-semibold cursor-pointer"
                            >
                              Mark In Progress
                            </button>
                          ) : null}

                          {['approved', 'in_progress'].includes(adminDetail.status) ? (
                            <button
                              type="button"
                              onClick={() => setShowDeployBox((v) => !v)}
                              className="min-h-[44px] sm:min-h-[38px] w-full sm:w-auto px-3 py-2 rounded bg-[#166534] text-white text-xs font-semibold cursor-pointer"
                            >
                              Mark Deployed &amp; Notify Reporter
                            </button>
                          ) : null}
                        </div>

                        {showRevisionBox ? (
                          <form onSubmit={handleRevisePlan} className="bg-[#F4F4F1] rounded p-3 space-y-2">
                            <label className="block text-xs font-semibold text-[#111111]">
                              Revision guidance for Gemini 2.5 Flash
                            </label>
                            <textarea
                              value={revisionText}
                              onChange={(e) => setRevisionText(e.target.value)}
                              rows={2}
                              placeholder="e.g. Keep schema unchanged and add deep link query param instead..."
                              required
                              className="w-full border border-[#E3E3DE] bg-white rounded px-2.5 py-2 text-xs"
                            />
                            <button
                              type="submit"
                              disabled={actionBusy}
                              className="min-h-[44px] sm:min-h-[36px] w-full sm:w-auto px-3.5 py-2 sm:py-1.5 rounded bg-[#111111] text-white text-xs font-semibold cursor-pointer"
                            >
                              Regenerate Plan
                            </button>
                          </form>
                        ) : null}

                        {showRejectBox ? (
                          <form onSubmit={handleReject} className="bg-[#FEF2F2] border border-[#FECACA] rounded p-3 space-y-2">
                            <label className="block text-xs font-semibold text-[#991B1B]">
                              Reporter-visible explanation
                            </label>
                            <textarea
                              value={rejectNote}
                              onChange={(e) => setRejectNote(e.target.value)}
                              rows={2}
                              placeholder="Explain why this request is deferred or closed..."
                              required
                              className="w-full border border-[#FECACA] bg-white rounded px-2.5 py-2 text-xs"
                            />
                            <button
                              type="submit"
                              disabled={actionBusy}
                              className="min-h-[44px] sm:min-h-[36px] w-full sm:w-auto px-3.5 py-2 sm:py-1.5 rounded bg-[#991B1B] text-white text-xs font-semibold cursor-pointer"
                            >
                              Confirm Reject / Defer
                            </button>
                          </form>
                        ) : null}

                        {showDeployBox ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleStatusUpdate('deployed', deployNote);
                            }}
                            className="bg-[#DCFCE7] border border-[#86EFAC] rounded p-3 space-y-2"
                          >
                            <label className="block text-xs font-semibold text-[#166534]">
                              Closing release note (visible to reporter)
                            </label>
                            <textarea
                              value={deployNote}
                              onChange={(e) => setDeployNote(e.target.value)}
                              rows={2}
                              placeholder="e.g. Deployed in staging build — added direct Compliance link on 422 PO banner."
                              required
                              className="w-full border border-[#86EFAC] bg-white rounded px-2.5 py-2 text-xs"
                            />
                            <button
                              type="submit"
                              disabled={actionBusy}
                              className="min-h-[44px] sm:min-h-[36px] w-full sm:w-auto px-3.5 py-2 sm:py-1.5 rounded bg-[#166534] text-white text-xs font-semibold cursor-pointer"
                            >
                              Complete &amp; Close Loop
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-[#5F5F5A]">No fix plan generated yet.</div>
                  )
                ) : null}

                {isAdmin && detailTab === 'diagnostics' && adminDetail ? (
                  <div className="space-y-4 text-xs min-w-0">
                    <div className="border border-[#E3E3DE] rounded p-3 space-y-1 min-w-0">
                      <div className="font-display font-bold text-[#111111]">Page &amp; Entity Context</div>
                      <pre className="max-w-full text-[11px] font-mono bg-[#F4F4F1] p-2.5 rounded overflow-x-auto">
                        {JSON.stringify(adminDetail.pageContext, null, 2)}
                      </pre>
                    </div>

                    {screenshotBlobUrl ? (
                      <div className="border border-[#E3E3DE] rounded p-3 space-y-2 min-w-0">
                        <div className="font-display font-bold text-[#111111]">Attached Screenshot (Redacted)</div>
                        <img
                          src={screenshotBlobUrl}
                          alt="Feedback screenshot"
                          className="max-w-full h-auto max-h-72 rounded border border-[#E3E3DE]"
                        />
                      </div>
                    ) : null}

                    <div className="border border-[#E3E3DE] rounded p-3 space-y-2 min-w-0">
                      <div className="font-display font-bold text-[#111111] flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 shrink-0" />
                        <span>Correlated Server Logs ({adminDetail.diagnosticSnapshot.serverLogs.length})</span>
                      </div>
                      {adminDetail.diagnosticSnapshot.serverLogs.length === 0 ? (
                        <div className="text-[#5F5F5A]">No server errors correlated for this ticket.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {adminDetail.diagnosticSnapshot.serverLogs.map((s, idx) => (
                            <div key={idx} className="bg-[#111111] text-[#E3E3DE] rounded p-2.5 font-mono text-[11px] space-y-0.5 break-all">
                              <div className="text-[#FCA5A5]">
                                [{s.statusCode}] {s.method} {s.route} ({s.durationMs}ms) · req:{s.requestId}
                              </div>
                              {s.errorMessage ? <div>{s.errorMessage}</div> : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="border border-[#E3E3DE] rounded p-3 space-y-1.5 min-w-0">
                        <div className="font-display font-bold text-[#111111]">
                          Client Console &amp; Errors ({adminDetail.diagnosticSnapshot.clientLogs.length})
                        </div>
                        {adminDetail.diagnosticSnapshot.clientLogs.length === 0 ? (
                          <div className="text-[#5F5F5A]">No client console warnings/errors captured.</div>
                        ) : (
                          <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-[10px]">
                            {adminDetail.diagnosticSnapshot.clientLogs.map((l, idx) => (
                              <div key={idx} className="bg-[#F4F4F1] p-1.5 rounded break-all">
                                <span className="font-bold">[{l.level}]</span> {l.message}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="border border-[#E3E3DE] rounded p-3 space-y-1.5 min-w-0">
                        <div className="font-display font-bold text-[#111111]">
                          Network Events ({adminDetail.diagnosticSnapshot.networkEvents.length})
                        </div>
                        {adminDetail.diagnosticSnapshot.networkEvents.length === 0 ? (
                          <div className="text-[#5F5F5A]">No API calls captured.</div>
                        ) : (
                          <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-[10px]">
                            {adminDetail.diagnosticSnapshot.networkEvents.map((n, idx) => (
                              <div
                                key={idx}
                                className={`p-1.5 rounded break-all ${n.ok ? 'bg-[#F4F4F1]' : 'bg-[#FEF2F2] text-[#991B1B]'}`}
                              >
                                {n.method} {n.path} → {n.status} ({n.durationMs}ms)
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="border border-[#E3E3DE] rounded p-3 space-y-1.5 min-w-0">
                      <div className="font-display font-bold text-[#111111]">
                        Breadcrumbs ({adminDetail.diagnosticSnapshot.breadcrumbs.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {adminDetail.diagnosticSnapshot.breadcrumbs.map((b, idx) => (
                          <span key={idx} className="text-[10px] px-2 py-0.5 rounded bg-[#F4F4F1] border border-[#E3E3DE] break-all">
                            {b.type}: {b.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {(detailTab === 'conversation' || !isAdmin) ? (
                  <div className="space-y-3">
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {(detail.messages ?? []).map((m) => (
                        <div
                          key={m.id}
                          className={`rounded-lg p-3 text-xs border ${
                            !m.visibleToReporter
                              ? 'bg-[#FFFBEB] border-[#FDE68A]'
                              : m.senderType === 'admin'
                                ? 'bg-[#F4F4F1] border-[#E3E3DE]'
                                : 'bg-white border-[#E3E3DE]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-[#5F5F5A] mb-1">
                            <span className="font-bold text-[#111111]">
                              {m.senderName} ({m.senderType})
                              {!m.visibleToReporter ? ' · Internal Admin Note' : ''}
                            </span>
                            <span className="tabular-nums">{new Date(m.createdAt).toLocaleString()}</span>
                          </div>
                          <div className="text-[#111111] whitespace-pre-wrap break-words">{m.body}</div>
                        </div>
                      ))}
                    </div>

                    <form onSubmit={handleSendReply} className="space-y-2 pt-2 border-t border-[#E3E3DE]">
                      <textarea
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        rows={2}
                        placeholder={isAdmin ? 'Post an update or internal note...' : 'Add a follow-up comment...'}
                        className="w-full border border-[#E3E3DE] rounded px-3 py-2 text-xs"
                      />
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        {isAdmin ? (
                          <label className="min-h-[44px] sm:min-h-0 inline-flex items-center gap-2 text-xs text-[#5F5F5A] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={visibleToReporter}
                              onChange={(e) => setVisibleToReporter(e.target.checked)}
                              className="w-4 h-4"
                            />
                            <span>Visible to reporter</span>
                          </label>
                        ) : (
                          <span className="hidden sm:inline" />
                        )}
                        <button
                          type="submit"
                          disabled={actionBusy || !replyBody.trim()}
                          className="min-h-[44px] sm:min-h-[38px] w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 rounded bg-[#111111] text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Send Message</span>
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
