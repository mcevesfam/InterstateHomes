'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { COST_CODES, canAccess } from '@interstate/shared';
import { apiFetch, formatCurrencyExact } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface QuoteItem {
  id: string;
  homeId?: string;
  homeCode: string;
  subCompanyId?: string;
  subName: string;
  costCode: string;
  costCodeName: string;
  status: string;
  responseDeadline: string;
  quotedTotalCents: number;
  rounds: Array<{
    roundNumber: number;
    actorType: string;
    proposedTotalCents: number;
    proposedQuantity?: number;
    comment: string;
    createdAt: string;
  }>;
}

interface HomeOption {
  id: string;
  homeCode: string;
  planName: string;
}

interface SubOption {
  id: string;
  legalName: string;
  companyType: string;
}

function defaultDeadlineDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

const QUOTABLE_COST_CODES = COST_CODES.filter(
  (c) => !c.isInternalOnly && c.code !== '00' && c.isEstimateable
);

export default function QuotesPage() {
  const { role, subCompanyId } = useRole();
  const isProjectManager = role === 'project_manager';
  const canIssueQuotes = canAccess(role, 'quotes:issue');
  const canDecideQuotes = canAccess(role, 'quotes:decide');
  const canRespondOwn = canAccess(role, 'quotes:respond_own');

  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [loading, setLoading] = useState(!isProjectManager);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busyQuoteId, setBusyQuoteId] = useState<string | null>(null);

  // Subcontractor counter-offer form state
  const [counterOpenId, setCounterOpenId] = useState<string | null>(null);
  const [counterTotalDollars, setCounterTotalDollars] = useState('');
  const [counterQty, setCounterQty] = useState('');
  const [counterComment, setCounterComment] = useState('');

  // Estimator renegotiate inline note state
  const [renegotiateOpenId, setRenegotiateOpenId] = useState<string | null>(null);
  const [renegotiateNote, setRenegotiateNote] = useState('');

  // Issue Quote modal state
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [homes, setHomes] = useState<HomeOption[]>([]);
  const [subs, setSubs] = useState<SubOption[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueForm, setIssueForm] = useState({
    homeId: '',
    subCompanyId: '',
    costCode: QUOTABLE_COST_CODES[0]?.code ?? '31',
    responseDeadline: defaultDeadlineDate(),
    quotedTotalDollars: '',
    proposedQuantity: '',
    comment: 'Initial quote sent from estimate.',
  });

  usePageContext({
    section: 'Quotes & Review',
    entityType: 'quote_queue',
    entityLabel: isProjectManager ? 'Restricted' : `${quotes.length} Quotes`,
    summary: {
      quoteCount: quotes.length,
      adjustedCount: quotes.filter((q) => q.status === 'sub_adjusted').length,
    },
  });

  const loadQuotes = useCallback(
    async (isCancelled?: () => boolean) => {
      if (isProjectManager) {
        setQuotes([]);
        setLoading(false);
        setLoadError(null);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const res = await apiFetch<{ quotes: QuoteItem[] }>('/api/quotes', { role, subCompanyId });
        if (!isCancelled?.()) {
          setQuotes(res.quotes ?? []);
        }
      } catch (err: unknown) {
        if (!isCancelled?.()) {
          setLoadError(err instanceof Error ? err.message : 'Unable to load quotes.');
        }
      } finally {
        if (!isCancelled?.()) setLoading(false);
      }
    },
    [isProjectManager, role, subCompanyId]
  );

  useEffect(() => {
    let cancelled = false;
    void loadQuotes(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadQuotes]);

  const openIssueQuoteModal = async () => {
    setShowIssueModal(true);
    setIssueError(null);
    setLoadingRefs(true);
    try {
      const [homesRes, subsRes] = await Promise.all([
        apiFetch<{ homes: HomeOption[] }>('/api/homes', { role, subCompanyId }),
        apiFetch<{ subcontractors: SubOption[] }>('/api/subcontractors', { role, subCompanyId }),
      ]);
      const homeList = homesRes.homes ?? [];
      const subList = subsRes.subcontractors ?? [];
      setHomes(homeList);
      setSubs(subList);
      setIssueForm((prev) => ({
        ...prev,
        homeId: prev.homeId && homeList.some((h) => h.id === prev.homeId) ? prev.homeId : (homeList[0]?.id ?? ''),
        subCompanyId:
          prev.subCompanyId && subList.some((s) => s.id === prev.subCompanyId)
            ? prev.subCompanyId
            : (subList[0]?.id ?? ''),
        responseDeadline: prev.responseDeadline || defaultDeadlineDate(),
      }));
    } catch (err: unknown) {
      setIssueError(err instanceof Error ? err.message : 'Failed to load homes and vendors.');
    } finally {
      setLoadingRefs(false);
    }
  };

  const handleIssueQuoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const totalNum = Number(issueForm.quotedTotalDollars);
    if (!issueForm.homeId || !issueForm.subCompanyId) {
      setIssueError('Select both a home and a subcontractor or supplier.');
      return;
    }
    if (!Number.isFinite(totalNum) || totalNum < 0) {
      setIssueError('Enter a valid non-negative quoted total.');
      return;
    }

    const qtyTrimmed = issueForm.proposedQuantity.trim();
    const qtyNum = qtyTrimmed ? Number(qtyTrimmed) : undefined;
    if (qtyTrimmed && (qtyNum === undefined || !Number.isFinite(qtyNum) || qtyNum < 0)) {
      setIssueError('Quantity must be a non-negative number.');
      return;
    }

    setIssuing(true);
    setIssueError(null);
    setFeedback(null);
    try {
      const res = await apiFetch<{ quote: QuoteItem }>('/api/quotes', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          homeId: issueForm.homeId,
          subCompanyId: issueForm.subCompanyId,
          costCode: issueForm.costCode,
          responseDeadline: issueForm.responseDeadline,
          quotedTotalCents: Math.round(totalNum * 100),
          ...(qtyNum !== undefined ? { proposedQuantity: qtyNum } : {}),
          comment: issueForm.comment.trim() || 'Initial quote sent from estimate.',
        }),
      });
      setShowIssueModal(false);
      setIssueForm((prev) => ({ ...prev, quotedTotalDollars: '', proposedQuantity: '' }));
      setFeedback({
        type: 'ok',
        text: `Issued quote for ${res.quote.homeCode} · ${res.quote.costCode} to ${res.quote.subName}.`,
      });
      await loadQuotes();
    } catch (err: unknown) {
      setIssueError(err instanceof Error ? err.message : 'Failed to issue quote.');
    } finally {
      setIssuing(false);
    }
  };

  const handleDecision = async (
    quote: QuoteItem,
    decision: 'accept' | 'reject' | 'renegotiate',
    note?: string
  ) => {
    setBusyQuoteId(quote.id);
    setFeedback(null);
    try {
      await apiFetch(`/api/quotes/${quote.id}/decision`, {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          decision,
          ...(note && note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const verb =
        decision === 'accept'
          ? 'accepted'
          : decision === 'reject'
            ? 'rejected'
            : 'returned for renegotiation';
      setFeedback({
        type: 'ok',
        text: `Quote ${quote.homeCode} · ${quote.costCode} (${quote.subName}) ${verb}.`,
      });
      setRenegotiateOpenId(null);
      setRenegotiateNote('');
      await loadQuotes();
    } catch (err: unknown) {
      setFeedback({
        type: 'err',
        text:
          err instanceof Error
            ? err.message
            : `Failed to update quote ${quote.homeCode} · ${quote.costCode}.`,
      });
    } finally {
      setBusyQuoteId(null);
    }
  };

  const openCounterForm = (quote: QuoteItem) => {
    setCounterOpenId(quote.id);
    setCounterTotalDollars((quote.quotedTotalCents / 100).toFixed(2));
    setCounterQty('');
    setCounterComment('');
  };

  const handleSubCounterSubmit = async (e: React.FormEvent, quote: QuoteItem) => {
    e.preventDefault();
    const totalNum = Number(counterTotalDollars);
    if (!Number.isFinite(totalNum) || totalNum < 0) {
      setFeedback({ type: 'err', text: 'Enter a valid proposed total dollar amount.' });
      return;
    }
    if (counterComment.trim().length < 2) {
      setFeedback({ type: 'err', text: 'Provide a brief reason for your price or quantity adjustment.' });
      return;
    }
    const qtyTrimmed = counterQty.trim();
    const qtyNum = qtyTrimmed ? Number(qtyTrimmed) : undefined;
    if (qtyTrimmed && (qtyNum === undefined || !Number.isFinite(qtyNum) || qtyNum < 0)) {
      setFeedback({ type: 'err', text: 'Proposed quantity must be a non-negative number.' });
      return;
    }

    setBusyQuoteId(quote.id);
    setFeedback(null);
    try {
      await apiFetch(`/api/quotes/${quote.id}/counter`, {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          proposedTotalCents: Math.round(totalNum * 100),
          ...(qtyNum !== undefined ? { proposedQuantity: qtyNum } : {}),
          comment: counterComment.trim(),
        }),
      });
      setCounterOpenId(null);
      setFeedback({
        type: 'ok',
        text: `Counter-offer submitted on ${quote.homeCode} · ${quote.costCode}.`,
      });
      await loadQuotes();
    } catch (err: unknown) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to submit counter-offer.',
      });
    } finally {
      setBusyQuoteId(null);
    }
  };

  const handleSubAccept = async (quote: QuoteItem) => {
    setBusyQuoteId(quote.id);
    setFeedback(null);
    try {
      await apiFetch(`/api/quotes/${quote.id}/accept`, {
        method: 'POST',
        role,
        subCompanyId,
      });
      setCounterOpenId(null);
      setFeedback({
        type: 'ok',
        text: `Accepted quote ${quote.homeCode} · ${quote.costCode} at ${formatCurrencyExact(
          quote.quotedTotalCents
        )}.`,
      });
      await loadQuotes();
    } catch (err: unknown) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to accept quote.',
      });
    } finally {
      setBusyQuoteId(null);
    }
  };

  const statusBadgeClass = useMemo(
    () => (status: string) => {
      if (status === 'accepted') return 'bg-[#DCFCE7] text-[#166534]';
      if (status === 'rejected') return 'bg-[#FEE2E2] text-[#991B1B]';
      if (status === 'sub_adjusted') return 'bg-[#FFEDD5] text-[#9A3412]';
      return 'bg-[#FEF3C7] text-[#8A5A00]';
    },
    []
  );

  if (isProjectManager) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-display font-bold text-[#111111]">
            Quotes &amp; Sub Approval
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.5 &amp; Rule 3 — Subcontractor approvals, counter-offers, and round history.
          </p>
        </div>
        <div className="bg-white border border-[#E3E3DE] rounded-lg px-5 py-8 text-center space-y-4">
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-base font-display font-bold text-[#111111]">
              Access Restricted — Estimating &amp; Subcontractor Workflow
            </h2>
            <p className="text-xs text-[#5F5F5A]">
              Quote issuance and price negotiations are managed by Estimators, Approvers, and
              Subcontractors. Field teams can review signed scopes on Purchase Orders and Budgets or
              log scope questions in Clarifications.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
            <Link
              href="/purchase-orders"
              className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white transition-colors"
            >
              View Purchase Orders
            </Link>
            <Link
              href="/clarifications"
              className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center px-5 py-2.5 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111] transition-colors"
            >
              Open Clarifications
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-[#111111]">
            Quotes &amp; Sub Approval
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.5 &amp; Rule 3 — Subcontractor approvals, counter-offers (&quot;money on the
            quote&quot;), and full round history.
          </p>
        </div>
        {canIssueQuotes ? (
          <button
            type="button"
            onClick={() => void openIssueQuoteModal()}
            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white transition-colors"
          >
            + Issue Quote
          </button>
        ) : null}
      </div>

      {feedback ? (
        <div
          role="status"
          className={`rounded-lg px-4 py-3 text-xs border break-words ${
            feedback.type === 'err'
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
              : 'bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {loadError ? (
        <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-4 py-3 rounded-lg text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 break-words">Unable to load quotes: {loadError}</div>
          <button
            type="button"
            onClick={() => void loadQuotes()}
            className="w-full sm:w-auto shrink-0 min-h-[44px] px-4 py-2 rounded-md border border-[#991B1B] bg-white text-xs font-display font-semibold text-[#991B1B] hover:bg-[#991B1B] hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="bg-white border border-[#E3E3DE] rounded-lg px-4 py-10 text-center text-xs text-[#5F5F5A]">
          Loading quotes…
        </div>
      ) : (
        <div className="space-y-4">
          {quotes.map((q) => {
            const isBusy = busyQuoteId === q.id;
            const canSubRespond = canRespondOwn && q.status === 'sent';
            const canReviewAdjustment = canDecideQuotes && q.status === 'sub_adjusted';
            const isCounterOpen = counterOpenId === q.id;
            const isRenegotiateOpen = renegotiateOpenId === q.id;

            return (
              <article
                key={q.id}
                className="bg-white border border-[#E3E3DE] rounded-lg p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display font-bold text-base text-[#111111] leading-snug break-words">
                        {q.homeCode} · {q.costCode} {q.costCodeName}
                      </h2>
                      <span
                        className={`shrink-0 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${statusBadgeClass(
                          q.status
                        )}`}
                      >
                        {q.status.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <div className="text-xs text-[#5F5F5A] mt-1 break-words">
                      {q.subName} · Response deadline {q.responseDeadline}
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right border-t sm:border-t-0 border-[#E3E3DE] pt-2.5 sm:pt-0 shrink-0">
                    <div className="text-[11px] text-[#5F5F5A] sm:hidden">Current quoted total</div>
                    <div className="text-lg font-display font-bold tabular-nums text-[#111111]">
                      {formatCurrencyExact(q.quotedTotalCents)}
                    </div>
                    <div className="hidden sm:block text-[11px] text-[#5F5F5A]">
                      Current quoted total
                    </div>
                  </div>
                </div>

                <div className="border border-[#E3E3DE] rounded-md divide-y divide-[#E3E3DE] bg-[#F4F4F1]/40">
                  {q.rounds.map((r) => (
                    <div
                      key={r.roundNumber}
                      className="px-3.5 sm:px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-1.5 sm:gap-4 text-xs"
                    >
                      <div className="min-w-0 space-y-0.5 sm:space-y-0">
                        <span className="inline-block font-display font-bold uppercase text-[10px] mr-2 text-[#111111]">
                          Round {r.roundNumber} ({r.actorType})
                        </span>
                        <span className="text-[#3B3B38] break-words">{r.comment}</span>
                      </div>
                      <div className="font-semibold tabular-nums text-[#111111] shrink-0">
                        {formatCurrencyExact(r.proposedTotalCents)}
                        {r.proposedQuantity ? ` (${r.proposedQuantity.toLocaleString()} qty)` : ''}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Inline Subcontractor Counter-Offer Form */}
                {canSubRespond && isCounterOpen ? (
                  <form
                    onSubmit={(e) => void handleSubCounterSubmit(e, q)}
                    className="border border-[#E3E3DE] rounded-md p-3.5 sm:p-4 bg-[#F4F4F1]/50 space-y-3"
                  >
                    <div className="text-xs font-display font-bold text-[#111111]">
                      Submit Counter-Offer ({q.homeCode} · {q.costCode})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#111111] mb-1">
                          Proposed Total ($)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          required
                          value={counterTotalDollars}
                          onChange={(e) => setCounterTotalDollars(e.target.value)}
                          className="w-full min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#111111] mb-1">
                          Proposed Quantity <span className="font-normal text-[#5F5F5A]">(optional)</span>
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          placeholder="Leave blank if unchanged"
                          value={counterQty}
                          onChange={(e) => setCounterQty(e.target.value)}
                          className="w-full min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#111111] mb-1">
                        Adjustment Reason / Scope Note
                      </label>
                      <textarea
                        rows={2}
                        required
                        placeholder="Explain material, labor, or takeoff quantity adjustment…"
                        value={counterComment}
                        onChange={(e) => setCounterComment(e.target.value)}
                        className="w-full border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                      />
                    </div>
                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setCounterOpenId(null)}
                        className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isBusy}
                        className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white disabled:opacity-60 transition-colors"
                      >
                        {isBusy ? 'Submitting…' : 'Send Counter-Offer'}
                      </button>
                    </div>
                  </form>
                ) : null}

                {/* Inline Estimator Renegotiate Note Form */}
                {canReviewAdjustment && isRenegotiateOpen ? (
                  <div className="border border-[#E3E3DE] rounded-md p-3.5 sm:p-4 bg-[#F4F4F1]/50 space-y-3">
                    <label className="block text-xs font-display font-bold text-[#111111]">
                      Renegotiation Note to {q.subName}
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Optional guidance or counter-terms to send back to subcontractor…"
                      value={renegotiateNote}
                      onChange={(e) => setRenegotiateNote(e.target.value)}
                      className="w-full border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                    />
                    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRenegotiateOpenId(null);
                          setRenegotiateNote('');
                        }}
                        className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDecision(q, 'renegotiate', renegotiateNote)}
                        className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white disabled:opacity-60 transition-colors"
                      >
                        {isBusy ? 'Sending…' : 'Return for Renegotiation'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {canSubRespond || canReviewAdjustment ? (
                  <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-end gap-2.5">
                    {canSubRespond && !isCounterOpen ? (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => openCounterForm(q)}
                          className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111] disabled:opacity-60 transition-colors"
                        >
                          Submit Counter-Offer
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleSubAccept(q)}
                          className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white disabled:opacity-60 transition-colors"
                        >
                          {isBusy ? 'Saving…' : 'Accept Quote'}
                        </button>
                      </>
                    ) : null}
                    {canReviewAdjustment ? (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDecision(q, 'reject')}
                          className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111] active:bg-[#F4F4F1] disabled:opacity-60 transition-colors"
                        >
                          Reject Adjustment
                        </button>
                        {!isRenegotiateOpen ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setRenegotiateOpenId(q.id);
                              setRenegotiateNote('');
                            }}
                            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md border border-[#FCAE1A] bg-[#FEF3C7] text-xs font-display font-bold text-[#8A5A00] hover:bg-[#FCAE1A] hover:text-[#111111] disabled:opacity-60 transition-colors"
                          >
                            Renegotiate
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleDecision(q, 'accept')}
                          className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] active:bg-[#FCAE1A] active:text-[#111111] disabled:opacity-60 transition-colors"
                        >
                          {isBusy ? 'Saving…' : 'Accept Adjustment'}
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}

          {quotes.length === 0 && !loadError ? (
            <div className="bg-white border border-[#E3E3DE] rounded-lg px-4 py-8 text-center text-xs text-[#5F5F5A]">
              No quotes in queue.
            </div>
          ) : null}
        </div>
      )}

      {/* Issue Quote Modal */}
      {showIssueModal && canIssueQuotes ? (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="issue-quote-modal-title"
        >
          <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl border border-[#E3E3DE] shadow-xl max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[#E3E3DE] sticky top-0 bg-white">
              <h2
                id="issue-quote-modal-title"
                className="text-sm font-display font-bold text-[#111111]"
              >
                Issue New Quote
              </h2>
              <button
                type="button"
                aria-label="Close issue quote modal"
                onClick={() => setShowIssueModal(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md text-[#5F5F5A] hover:text-[#111111] hover:bg-[#F4F4F1]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleIssueQuoteSubmit} className="p-4 sm:p-5 space-y-4">
              {issueError ? (
                <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-3.5 py-2.5 rounded-md text-xs break-words">
                  {issueError}
                </div>
              ) : null}

              {loadingRefs ? (
                <div className="py-6 text-center text-xs text-[#5F5F5A]">
                  Loading homes and subcontractors…
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-[#111111] mb-1">Home</label>
                    <select
                      required
                      value={issueForm.homeId}
                      onChange={(e) => setIssueForm({ ...issueForm, homeId: e.target.value })}
                      className="w-full min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                    >
                      {homes.length === 0 ? (
                        <option value="">No homes available</option>
                      ) : (
                        homes.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.homeCode} — {h.planName}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#111111] mb-1">
                      Subcontractor / Supplier
                    </label>
                    <select
                      required
                      value={issueForm.subCompanyId}
                      onChange={(e) =>
                        setIssueForm({ ...issueForm, subCompanyId: e.target.value })
                      }
                      className="w-full min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                    >
                      {subs.length === 0 ? (
                        <option value="">No vendors available</option>
                      ) : (
                        subs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.legalName} ({s.companyType})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#111111] mb-1">
                      Cost Code
                    </label>
                    <select
                      required
                      value={issueForm.costCode}
                      onChange={(e) => setIssueForm({ ...issueForm, costCode: e.target.value })}
                      className="w-full min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                    >
                      {QUOTABLE_COST_CODES.map((cc) => (
                        <option key={cc.code} value={cc.code}>
                          {cc.code} — {cc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-[#111111] mb-1">
                        Quoted Total ($)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        placeholder="e.g. 18500.00"
                        value={issueForm.quotedTotalDollars}
                        onChange={(e) =>
                          setIssueForm({ ...issueForm, quotedTotalDollars: e.target.value })
                        }
                        className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#111111] mb-1">
                        Response Deadline
                      </label>
                      <input
                        type="date"
                        required
                        value={issueForm.responseDeadline}
                        onChange={(e) =>
                          setIssueForm({ ...issueForm, responseDeadline: e.target.value })
                        }
                        className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#111111] mb-1">
                      Takeoff Quantity <span className="font-normal text-[#5F5F5A]">(optional)</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="e.g. 2450"
                      value={issueForm.proposedQuantity}
                      onChange={(e) =>
                        setIssueForm({ ...issueForm, proposedQuantity: e.target.value })
                      }
                      className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#111111] mb-1">
                      Scope Comment
                    </label>
                    <textarea
                      rows={2}
                      value={issueForm.comment}
                      onChange={(e) => setIssueForm({ ...issueForm, comment: e.target.value })}
                      className="w-full border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                    />
                  </div>
                </>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2 border-t border-[#E3E3DE]">
                <button
                  type="button"
                  onClick={() => setShowIssueModal(false)}
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={issuing || loadingRefs || homes.length === 0 || subs.length === 0}
                  className="w-full sm:w-auto min-h-[44px] px-5 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-bold hover:bg-[#FCAE1A] hover:text-[#111111] disabled:opacity-60 transition-colors"
                >
                  {issuing ? 'Sending…' : 'Send Quote'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
