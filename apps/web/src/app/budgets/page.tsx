'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch, formatCurrencyExact } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface BudgetResponse {
  budgets: Array<{
    homeId: string;
    homeCode: string;
    planName: string;
    stage: string;
    estimateVersion: number;
    canApprove: boolean;
    blockingCostCodes: Array<{ costCode: string; reason: string }>;
    totalEstimatedCents: number;
    totalSignedPoCents: number;
    totalFixedCents: number;
    totalFinalBudgetCents: number;
    totalVarianceCents: number;
  }>;
  liveJobCostRows: Array<{
    homeCode: string;
    costCode: string;
    costCodeName: string;
    budgetCents: number;
    source: string;
    loadedAt: string;
  }>;
}

export default function BudgetsPage() {
  const { role, subCompanyId } = useRole();
  const [data, setData] = useState<BudgetResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  usePageContext({
    section: 'Budgets',
    entityType: 'budget_list',
    entityLabel: data ? `${data.budgets.length} Homes · ${data.liveJobCostRows.length} Live Rows` : 'Budgets',
    summary: data
      ? {
          budgetCount: data.budgets.length,
          liveRowCount: data.liveJobCostRows.length,
        }
      : undefined,
  });

  const load = () => {
    apiFetch<BudgetResponse>('/api/budgets', { role, subCompanyId })
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, [role, subCompanyId]);

  const handleApprove = async (homeId: string) => {
    setMessage(null);
    try {
      const res = await apiFetch<{ rowsWritten: number }>(`/api/budgets/${homeId}/approve`, {
        method: 'POST',
        role,
        subCompanyId,
      });
      setMessage(`Approved budget and wrote ${res.rowsWritten} live job cost rows.`);
      load();
    } catch (err: unknown) {
      const e = err as Error & { data?: { blockingCostCodes?: Array<{ reason: string }> } };
      setMessage(
        `${e.message} ${e.data?.blockingCostCodes?.[0]?.reason ?? ''}`
      );
    }
  };

  const budgets = data?.budgets ?? [];
  const liveRows = data?.liveJobCostRows ?? [];
  const canApproveRole = role === 'admin' || role === 'estimator_approver';

  return (
    <div className="space-y-5 min-w-0">
      <div>
        <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
          Budget Build &amp; Live Job Cost Handoff
        </h1>
        <p className="text-xs text-[#5F5F5A] mt-0.5">
          Section 5.7, 5.9 &amp; 11 — Final budget = Signed POs + Fixed amounts. Approval writes
          one row per cost code (as text) directly to <code>job_cost_budgets</code>.
        </p>
      </div>

      {message ? (
        <div className="bg-white border border-[#FCAE1A] px-4 py-2.5 rounded-md text-xs break-words">
          {message}
        </div>
      ) : null}

      {/* Mobile Budget Summary Cards */}
      <div className="md:hidden space-y-3">
        {budgets.length === 0 ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-5 text-xs text-[#5F5F5A] text-center">
            No home budgets available.
          </div>
        ) : (
          budgets.map((b) => (
            <div
              key={b.homeId}
              className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm text-[#111111] break-words">
                    {b.homeCode}
                  </div>
                  <div className="text-xs text-[#5F5F5A]">
                    {b.planName} · v{b.estimateVersion}
                  </div>
                </div>
                {b.stage === 'live_budget' ? (
                  <span className="shrink-0 text-[11px] px-2.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] font-semibold">
                    Live in Job Cost
                  </span>
                ) : !canApproveRole ? (
                  <span className="shrink-0 text-[11px] px-2.5 py-0.5 rounded-full bg-[#F4F4F1] text-[#5F5F5A] font-semibold">
                    Pending Approver
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-[#E3E3DE] text-xs">
                <div className="bg-[#F4F4F1]/60 rounded px-2.5 py-2 min-w-0">
                  <div className="text-[10px] font-display uppercase text-[#5F5F5A]">
                    Approved Estimate
                  </div>
                  <div className="font-semibold text-[#111111] tabular-nums mt-0.5">
                    {formatCurrencyExact(b.totalEstimatedCents)}
                  </div>
                </div>
                <div className="bg-[#F4F4F1]/60 rounded px-2.5 py-2 min-w-0">
                  <div className="text-[10px] font-display uppercase text-[#5F5F5A]">
                    Signed POs
                  </div>
                  <div className="font-semibold text-[#111111] tabular-nums mt-0.5">
                    {formatCurrencyExact(b.totalSignedPoCents)}
                  </div>
                </div>
                <div className="bg-[#F4F4F1]/60 rounded px-2.5 py-2 min-w-0">
                  <div className="text-[10px] font-display uppercase text-[#5F5F5A]">
                    Fixed Amounts
                  </div>
                  <div className="font-semibold text-[#111111] tabular-nums mt-0.5">
                    {formatCurrencyExact(b.totalFixedCents)}
                  </div>
                </div>
                <div className="bg-[#FEF3C7]/45 border border-[#FCAE1A]/40 rounded px-2.5 py-2 min-w-0">
                  <div className="text-[10px] font-display uppercase text-[#8A5A00]">
                    Final Budget
                  </div>
                  <div className="font-bold text-[#111111] tabular-nums mt-0.5">
                    {formatCurrencyExact(b.totalFinalBudgetCents)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#E3E3DE] text-xs">
                <span className="font-display uppercase text-[10px] font-semibold text-[#5F5F5A]">
                  Variance
                </span>
                <span className="font-semibold tabular-nums text-[#111111]">
                  {formatCurrencyExact(b.totalVarianceCents)}
                </span>
              </div>

              {b.stage !== 'live_budget' && canApproveRole ? (
                <button
                  type="button"
                  onClick={() => handleApprove(b.homeId)}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] active:bg-[#FCAE1A] active:text-[#111111] transition-colors cursor-pointer"
                >
                  Approve &amp; Write Live
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      {/* Desktop Budget Summary Table */}
      <div className="hidden md:block overflow-x-auto bg-white border border-[#E3E3DE] rounded-lg">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1] text-[10px] font-display uppercase text-[#5F5F5A]">
              <th className="py-3 px-4">Home</th>
              <th className="py-3 px-3 text-right">Approved Estimate</th>
              <th className="py-3 px-3 text-right">Signed POs</th>
              <th className="py-3 px-3 text-right">Fixed Amounts</th>
              <th className="py-3 px-3 text-right">Final Budget</th>
              <th className="py-3 px-3 text-right">Variance</th>
              <th className="py-3 px-4 text-right">Live Handoff</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E3DE]">
            {budgets.map((b) => (
              <tr key={b.homeId} className="hover:bg-[#F4F4F1]/40">
                <td className="py-3 px-4">
                  <div className="font-display font-bold text-[#111111]">{b.homeCode}</div>
                  <div className="text-[#5F5F5A]">
                    {b.planName} · v{b.estimateVersion}
                  </div>
                </td>
                <td className="py-3 px-3 text-right tabular-nums">
                  {formatCurrencyExact(b.totalEstimatedCents)}
                </td>
                <td className="py-3 px-3 text-right tabular-nums">
                  {formatCurrencyExact(b.totalSignedPoCents)}
                </td>
                <td className="py-3 px-3 text-right tabular-nums">
                  {formatCurrencyExact(b.totalFixedCents)}
                </td>
                <td className="py-3 px-3 text-right tabular-nums font-bold">
                  {formatCurrencyExact(b.totalFinalBudgetCents)}
                </td>
                <td className="py-3 px-3 text-right tabular-nums">
                  {formatCurrencyExact(b.totalVarianceCents)}
                </td>
                <td className="py-3 px-4 text-right">
                  {b.stage === 'live_budget' ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] font-semibold whitespace-nowrap">
                      Live in Job Cost
                    </span>
                  ) : canApproveRole ? (
                    <button
                      type="button"
                      onClick={() => handleApprove(b.homeId)}
                      className="px-3 py-1.5 rounded bg-[#111111] text-white font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] whitespace-nowrap cursor-pointer"
                    >
                      Approve &amp; Write Live
                    </button>
                  ) : (
                    <span className="text-[#5F5F5A]">Pending Approver</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Live Job Cost Budget Table Preview (Section 11) */}
      <div className="bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E3E3DE] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-display font-bold text-[#111111] min-w-0">
            Live <code className="break-all">job_cost_budgets</code> Table (Section 11 Schema)
          </h2>
          <span className="text-xs text-[#5F5F5A] shrink-0 tabular-nums">
            {liveRows.length} rows
          </span>
        </div>

        {/* Mobile Job Cost Cards */}
        <div className="md:hidden space-y-3 p-3 bg-[#F4F4F1]/40">
          {liveRows.length === 0 ? (
            <div className="bg-white border border-[#E3E3DE] rounded-md p-4 text-xs text-[#5F5F5A] text-center">
              No live job cost rows written yet.
            </div>
          ) : (
            liveRows.map((row, idx) => (
              <div
                key={`${row.homeCode}-${row.costCode}-${idx}`}
                className="bg-white border border-[#E3E3DE] rounded-md p-3 space-y-2 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-[#F4F4F1] text-[#111111] shrink-0">
                      {row.costCode}
                    </span>
                    <span className="font-semibold text-[#111111] break-words">
                      {row.costCodeName}
                    </span>
                  </div>
                  <span className="font-bold tabular-nums text-[#111111] shrink-0">
                    {formatCurrencyExact(row.budgetCents)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#5F5F5A]">
                  <span className="font-medium text-[#3B3B38]">
                    {row.homeCode} · {row.source}
                  </span>
                  <span className="tabular-nums">
                    {new Date(row.loadedAt).toLocaleString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop Job Cost Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1] text-[10px] font-display uppercase text-[#5F5F5A]">
                <th className="py-2.5 px-4">Home</th>
                <th className="py-2.5 px-3">Code (Text)</th>
                <th className="py-2.5 px-3">Name</th>
                <th className="py-2.5 px-3 text-right">Budget</th>
                <th className="py-2.5 px-3">Source</th>
                <th className="py-2.5 px-4">Loaded</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E3DE]">
              {liveRows.map((row, idx) => (
                <tr key={`${row.homeCode}-${row.costCode}-${idx}`}>
                  <td className="py-2.5 px-4 font-semibold">{row.homeCode}</td>
                  <td className="py-2.5 px-3 font-mono font-bold">{row.costCode}</td>
                  <td className="py-2.5 px-3">{row.costCodeName}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold">
                    {formatCurrencyExact(row.budgetCents)}
                  </td>
                  <td className="py-2.5 px-3">{row.source}</td>
                  <td className="py-2.5 px-4 text-[#5F5F5A] tabular-nums">
                    {new Date(row.loadedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
