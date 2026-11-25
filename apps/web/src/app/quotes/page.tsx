'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch, formatCurrencyExact } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface QuoteItem {
  id: string;
  homeCode: string;
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

export default function QuotesPage() {
  const { role, subCompanyId } = useRole();
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  usePageContext({
    section: 'Quotes & Review',
    entityType: 'quote_queue',
    entityLabel: `${quotes.length} Quotes`,
    summary: {
      quoteCount: quotes.length,
      adjustedCount: quotes.filter((q) => q.status === 'sub_adjusted').length,
    },
  });

  const loadQuotes = () => {
    apiFetch<{ quotes: QuoteItem[] }>('/api/quotes', { role, subCompanyId })
      .then((res) => setQuotes(res.quotes))
      .catch(() => {});
  };

  useEffect(() => {
    loadQuotes();
  }, [role, subCompanyId]);

  const handleDecision = async (id: string, decision: 'accept' | 'reject') => {
    await apiFetch(`/api/quotes/${id}/decision`, {
      method: 'POST',
      role,
      subCompanyId,
      body: JSON.stringify({ decision }),
    });
    setFeedback(`Quote ${id} marked ${decision}.`);
    loadQuotes();
  };

  const handleSubCounter = async (quote: QuoteItem) => {
    await apiFetch(`/api/quotes/${quote.id}/counter`, {
      method: 'POST',
      role,
      subCompanyId,
      body: JSON.stringify({
        proposedTotalCents: quote.quotedTotalCents + 75_000,
        comment: 'Adjusted material surcharge (+$750) in subcontractor portal.',
      }),
    });
    setFeedback(`Counter-offer submitted on ${quote.homeCode} (${quote.costCode}).`);
    loadQuotes();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-display font-bold text-[#111111]">Quotes &amp; Sub Approval</h1>
        <p className="text-xs text-[#5F5F5A] mt-0.5">
          Section 5.5 &amp; Rule 3 — Subcontractor approvals, counter-offers (&quot;money on the quote&quot;), and full round history.
        </p>
      </div>

      {feedback ? (
        <div className="bg-white border border-[#FCAE1A] px-4 py-2.5 rounded-md text-xs text-[#111111]">
          {feedback}
        </div>
      ) : null}

      <div className="space-y-4">
        {quotes.map((q) => {
          const canSubCounter = role === 'subcontractor' && q.status === 'sent';
          const canReviewAdjustment =
            (role === 'admin' || role === 'estimator_approver') && q.status === 'sub_adjusted';

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
                    <span className="shrink-0 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#8A5A00]">
                      {q.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-[#5F5F5A] mt-1 break-words">
                    {q.subName} · Response deadline {q.responseDeadline}
                  </div>
                </div>
                <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right border-t sm:border-t-0 border-[#E3E3DE] pt-2.5 sm:pt-0 shrink-0">
                  <div className="text-[11px] text-[#5F5F5A] sm:hidden">Initial quoted total</div>
                  <div className="text-lg font-display font-bold tabular-nums text-[#111111]">
                    {formatCurrencyExact(q.quotedTotalCents)}
                  </div>
                  <div className="hidden sm:block text-[11px] text-[#5F5F5A]">
                    Initial quoted total
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

              {canSubCounter || canReviewAdjustment ? (
                <div className="flex flex-col sm:flex-row sm:flex-wrap sm:justify-end gap-2.5">
                  {canSubCounter ? (
                    <button
                      type="button"
                      onClick={() => handleSubCounter(q)}
                      className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white transition-colors"
                    >
                      Submit Price Adjustment (+$750 Demo)
                    </button>
                  ) : null}
                  {canReviewAdjustment ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDecision(q.id, 'reject')}
                        className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111] active:bg-[#F4F4F1] transition-colors"
                      >
                        Reject Adjustment
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecision(q.id, 'accept')}
                        className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] active:bg-[#FCAE1A] active:text-[#111111] transition-colors"
                      >
                        Accept Adjustment
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}

        {quotes.length === 0 ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg px-4 py-8 text-center text-xs text-[#5F5F5A]">
            No quotes in queue.
          </div>
        ) : null}
      </div>
    </div>
  );
}
