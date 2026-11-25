'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { COST_CODES, canAccess } from '@interstate/shared';
import { ReauthModal } from '@/components/ReauthModal';
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

interface ActionNotice {
  type: 'ok' | 'err';
  text: string;
  details?: string[];
}

export default function BudgetsPage() {
  const { role, subCompanyId } = useRole();
  const canView = canAccess(role, 'budgets:view');
  const canApproveRole = canAccess(role, 'budgets:approve');
  const canAddFixed = canAccess(role, 'estimates:build');
  const canSeeInternal = canAccess(role, 'financials:view_internal');

  const [data, setData] = useState<BudgetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);

  const [approvingHomeId, setApprovingHomeId] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const pendingApproveHomeIdRef = useRef<string | null>(null);

  const [showFixedForm, setShowFixedForm] = useState(false);
  const [fixedHomeId, setFixedHomeId] = useState('');
  const [fixedCostCode, setFixedCostCode] = useState('01');
  const [fixedAmountDollars, setFixedAmountDollars] = useState('');
  const [fixedNote, setFixedNote] = useState('');
  const [savingFixed, setSavingFixed] = useState(false);

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

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch<BudgetResponse>('/api/budgets', { role, subCompanyId });
      setData(res);
      setFixedHomeId((prev) => prev || res.budgets[0]?.homeId || '');
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load budgets.');
    } finally {
      setLoading(false);
    }
  }, [canView, role, subCompanyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApprove = async (homeId: string) => {
    setNotice(null);
    setApprovingHomeId(homeId);
    try {
      const res = await apiFetch<{ rowsWritten: number }>(`/api/budgets/${homeId}/approve`, {
        method: 'POST',
        role,
        subCompanyId,
      });
      setNotice({
        type: 'ok',
        text: `Approved budget and wrote ${res.rowsWritten} live job cost rows.`,
      });
      await load();
    } catch (err: unknown) {
      const e = err as Error & {
        status?: number;
        data?: { error?: string; blockingCostCodes?: Array<{ costCode?: string; reason: string }> };
      };
      if (e.status === 401 && e.data?.error === 'ReauthRequired') {
        pendingApproveHomeIdRef.current = homeId;
        setReauthOpen(true);
        return;
      }
      const blockers = (e.data?.blockingCostCodes ?? []).map((b) => b.reason).filter(Boolean);
      setNotice({
        type: 'err',
        text: e.message || 'Budget approval failed.',
        details: blockers.length > 0 ? blockers : undefined,
      });
    } finally {
      setApprovingHomeId(null);
    }
  };

  const handleSaveFixedLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fixedHomeId) return;
    const dollars = Number(fixedAmountDollars);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setNotice({ type: 'err', text: 'Enter a valid non-negative dollar amount.' });
      return;
    }
    setSavingFixed(true);
    setNotice(null);
    try {
      const amountCents = Math.round(dollars * 100);
      await apiFetch(`/api/budgets/${fixedHomeId}/fixed-lines`, {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          costCode: fixedCostCode,
          amountCents,
          note: fixedNote.trim(),
        }),
      });
      setNotice({
        type: 'ok',
        text: `Saved fixed/allowance line for cost code ${fixedCostCode} (${formatCurrencyExact(amountCents)}).`,
      });
      setFixedAmountDollars('');
      setFixedNote('');
      setShowFixedForm(false);
      await load();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to save fixed/allowance line.',
      });
    } finally {
      setSavingFixed(false);
    }
  };

  if (!canView) {
    return (
      <div className="space-y-4 min-w-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
            Budget Build &amp; Live Job Cost Handoff
          </h1>
        </div>
        <div className="bg-white border border-[#E3E3DE] rounded-lg p-6 text-xs space-y-1.5">
          <div className="font-display font-bold text-sm text-[#111111]">Access Restricted</div>
          <p className="text-[#5F5F5A]">
            Home budgets and live job cost handoff tables are restricted to internal Interstate Homes staff.
          </p>
        </div>
      </div>
    );
  }

  const budgets = data?.budgets ?? [];
  const liveRows = data?.liveJobCostRows ?? [];
  const selectableCostCodes = COST_CODES.filter(
    (cc) => cc.code !== '00' && (canSeeInternal || !cc.isInternalOnly)
  );

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
            Budget Build &amp; Live Job Cost Handoff
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.7, 5.9 &amp; 11 — Final budget = Signed POs + Fixed amounts. Approval writes
            one row per cost code (as text) directly to <code>job_cost_budgets</code>.
          </p>
        </div>
        {canAddFixed ? (
          <button
            type="button"
            onClick={() => setShowFixedForm((v) => !v)}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] transition-colors cursor-pointer shrink-0"
          >
            {showFixedForm ? 'Close Fixed Line Form' : '+ Add Fixed / Allowance Line'}
          </button>
        ) : null}
      </div>

      {notice ? (
        <div
          role="alert"
          className={`px-4 py-3 rounded-md text-xs border space-y-1.5 break-words ${
            notice.type === 'ok'
              ? 'bg-[#DCFCE7] border-[#86EFAC] text-[#166534]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold">{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="underline shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          {notice.details && notice.details.length > 0 ? (
            <ul className="list-disc pl-5 space-y-0.5">
              {notice.details.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {loadError ? (
        <div
          role="alert"
          className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-4 py-3 rounded-md text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
        >
          <span className="break-words">{loadError}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded bg-[#991B1B] text-white font-semibold cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      ) : null}

      {canAddFixed && showFixedForm ? (
        <form
          onSubmit={handleSaveFixedLine}
          className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-3"
        >
          <div className="font-display font-bold text-sm text-[#111111]">
            Add / Update Fixed or Allowance Budget Line
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Home</span>
              <select
                required
                value={fixedHomeId}
                onChange={(e) => setFixedHomeId(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                <option value="">Select home…</option>
                {budgets.map((b) => (
                  <option key={b.homeId} value={b.homeId}>
                    {b.homeCode} — {b.planName}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Cost Code</span>
              <select
                required
                value={fixedCostCode}
                onChange={(e) => setFixedCostCode(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                {selectableCostCodes.map((cc) => (
                  <option key={cc.code} value={cc.code}>
                    {cc.code} — {cc.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Amount (USD)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                placeholder="2500.00"
                value={fixedAmountDollars}
                onChange={(e) => setFixedAmountDollars(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 tabular-nums"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Note</span>
              <input
                type="text"
                maxLength={500}
                placeholder="Permit / utility fee / allowance note"
                value={fixedNote}
                onChange={(e) => setFixedNote(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
          </div>
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowFixedForm(false)}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-semibold text-[#3B3B38] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingFixed || !fixedHomeId}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#FCAE1A] text-[#111111] text-xs font-display font-bold hover:bg-[#E59C12] disabled:opacity-50 cursor-pointer"
            >
              {savingFixed ? 'Saving…' : 'Save Fixed / Allowance Line'}
            </button>
          </div>
        </form>
      ) : null}

      {/* Mobile Budget Summary Cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-5 text-xs text-[#5F5F5A] text-center">
            Loading budgets…
          </div>
        ) : budgets.length === 0 ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-5 text-xs text-[#5F5F5A] text-center">
            No home budgets available yet. Intake a home to initialize its estimate and budget.
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
                  disabled={approvingHomeId === b.homeId}
                  onClick={() => void handleApprove(b.homeId)}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] active:bg-[#FCAE1A] active:text-[#111111] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {approvingHomeId === b.homeId ? 'Approving…' : 'Approve & Write Live'}
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
            {loading ? (
              <tr>
                <td colSpan={7} className="py-6 px-4 text-center text-[#5F5F5A]">
                  Loading budgets…
                </td>
              </tr>
            ) : budgets.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 px-4 text-center text-[#5F5F5A]">
                  No home budgets available yet. Intake a home to initialize its estimate and budget.
                </td>
              </tr>
            ) : (
              budgets.map((b) => (
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
                        disabled={approvingHomeId === b.homeId}
                        onClick={() => void handleApprove(b.homeId)}
                        className="px-3 py-1.5 rounded bg-[#111111] text-white font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                      >
                        {approvingHomeId === b.homeId ? 'Approving…' : 'Approve & Write Live'}
                      </button>
                    ) : (
                      <span className="text-[#5F5F5A]">Pending Approver</span>
                    )}
                  </td>
                </tr>
              ))
            )}
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
          {loading ? (
            <div className="bg-white border border-[#E3E3DE] rounded-md p-4 text-xs text-[#5F5F5A] text-center">
              Loading live job cost rows…
            </div>
          ) : liveRows.length === 0 ? (
            <div className="bg-white border border-[#E3E3DE] rounded-md p-4 text-xs text-[#5F5F5A] text-center">
              No live job cost rows written yet. Approve a home budget to write live rows.
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
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-6 px-4 text-center text-[#5F5F5A]">
                    Loading live job cost rows…
                  </td>
                </tr>
              ) : liveRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 px-4 text-center text-[#5F5F5A]">
                    No live job cost rows written yet. Approve a home budget to write live rows.
                  </td>
                </tr>
              ) : (
                liveRows.map((row, idx) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ReauthModal
        open={reauthOpen}
        title="Verify Password to Approve Live Budget"
        onClose={() => {
          setReauthOpen(false);
        }}
        onVerified={() => {
          const homeIdToRetry = pendingApproveHomeIdRef.current;
          pendingApproveHomeIdRef.current = null;
          setReauthOpen(false);
          if (homeIdToRetry) {
            void handleApprove(homeIdToRetry);
          }
        }}
      />
    </div>
  );
}
