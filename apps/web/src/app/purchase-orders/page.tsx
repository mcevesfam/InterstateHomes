'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { COST_CODES, canAccess } from '@interstate/shared';
import { apiFetch, formatCurrencyExact } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';
import { ReauthModal } from '@/components/ReauthModal';

interface POItem {
  id: string;
  poNumber: string;
  homeCode: string;
  costCode: string;
  costCodeName: string;
  subName: string;
  poType: 'subcontractor' | 'supplier';
  scopeSummary: string;
  planRevision: string;
  totalCents: number;
  masterAgreementRef: string | null;
  status: string;
  docusealSubmissionId: string;
}

interface HomeOption {
  id: string;
  homeCode: string;
  planName: string;
  planRevision?: string;
}

interface SubOption {
  id: string;
  legalName: string;
  companyType: 'subcontractor' | 'supplier' | 'both';
  complianceStatus?: {
    eligible: boolean;
    blockingReasons?: Array<{ message: string }>;
  };
}

interface ApiErrorLike extends Error {
  status?: number;
  data?: {
    error?: string;
    message?: string;
    blockingReasons?: Array<{ message: string }>;
  };
}

const ISSUABLE_COST_CODES = COST_CODES.filter(
  (c) => !c.isInternalOnly && c.code !== '00' && c.isEstimateable
);

export default function PurchaseOrdersPage() {
  const { role, subCompanyId, authMode } = useRole();
  const canIssuePo = canAccess(role, 'pos:issue');
  const canSignApprover = canAccess(role, 'pos:sign_approver');

  const [pos, setPos] = useState<POItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ type: 'ok' | 'err'; text: string; reasons?: string[] } | null>(
    null
  );
  const [signingPoId, setSigningPoId] = useState<string | null>(null);

  // Reauth modal state for 401 ReauthRequired on signing
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingSignPoId, setPendingSignPoId] = useState<string | null>(null);

  // Issue Purchase Order modal state
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [homes, setHomes] = useState<HomeOption[]>([]);
  const [subs, setSubs] = useState<SubOption[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<{ text: string; reasons?: string[] } | null>(null);
  const [issueForm, setIssueForm] = useState<{
    homeId: string;
    costCode: string;
    subId: string;
    poType: 'subcontractor' | 'supplier';
    scopeSummary: string;
    totalDollars: string;
    planRevision: string;
    splitScopeOverrideReason: string;
  }>({
    homeId: '',
    costCode: ISSUABLE_COST_CODES[0]?.code ?? '31',
    subId: '',
    poType: 'subcontractor',
    scopeSummary: '',
    totalDollars: '',
    planRevision: 'Rev 1',
    splitScopeOverrideReason: '',
  });

  usePageContext({
    section: 'Purchase Orders',
    entityType: 'po_queue',
    entityLabel: `${pos.length} Purchase Orders`,
    summary: {
      poCount: pos.length,
      pendingCount: pos.filter((p) => p.status !== 'fully_signed').length,
      hasComplianceAlert: alert?.type === 'err',
    },
  });

  const loadPos = useCallback(
    async (isCancelled?: () => boolean) => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await apiFetch<{ purchaseOrders: POItem[] }>('/api/purchase-orders', {
          role,
          subCompanyId,
        });
        if (!isCancelled?.()) {
          setPos(res.purchaseOrders ?? []);
        }
      } catch (err: unknown) {
        if (!isCancelled?.()) {
          setLoadError(err instanceof Error ? err.message : 'Unable to load purchase orders.');
        }
      } finally {
        if (!isCancelled?.()) setLoading(false);
      }
    },
    [role, subCompanyId]
  );

  useEffect(() => {
    let cancelled = false;
    void loadPos(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadPos]);

  const canSignPo = (po: POItem): boolean =>
    (role === 'subcontractor' && po.status === 'pending_sub_signature') ||
    (canSignApprover && po.status === 'pending_approver_signature');

  const openIssueModal = async () => {
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

      const firstHome = homeList[0];
      const firstSub = subList[0];
      setIssueForm((prev) => {
        const nextHome =
          prev.homeId && homeList.some((h) => h.id === prev.homeId)
            ? homeList.find((h) => h.id === prev.homeId)
            : firstHome;
        const nextSub =
          prev.subId && subList.some((s) => s.id === prev.subId)
            ? subList.find((s) => s.id === prev.subId)
            : firstSub;
        return {
          ...prev,
          homeId: nextHome?.id ?? '',
          planRevision: nextHome?.planRevision ?? prev.planRevision ?? 'Rev 1',
          subId: nextSub?.id ?? '',
          poType: nextSub?.companyType === 'supplier' ? 'supplier' : 'subcontractor',
        };
      });
    } catch (err: unknown) {
      setIssueError({
        text: err instanceof Error ? err.message : 'Failed to load homes and vendors.',
      });
    } finally {
      setLoadingRefs(false);
    }
  };

  const handleIssuePoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const totalNum = Number(issueForm.totalDollars);
    if (!issueForm.homeId || !issueForm.subId) {
      setIssueError({ text: 'Select a home and a vendor.' });
      return;
    }
    if (!Number.isFinite(totalNum) || totalNum < 0) {
      setIssueError({ text: 'Enter a valid non-negative PO dollar amount.' });
      return;
    }
    if (issueForm.scopeSummary.trim().length < 3) {
      setIssueError({ text: 'Provide a scope summary (at least 3 characters).' });
      return;
    }

    setIssuing(true);
    setIssueError(null);
    setAlert(null);

    try {
      const res = await apiFetch<{ purchaseOrder: POItem }>('/api/purchase-orders', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          homeId: issueForm.homeId,
          costCode: issueForm.costCode,
          subId: issueForm.subId,
          poType: issueForm.poType,
          scopeSummary: issueForm.scopeSummary.trim(),
          totalCents: Math.round(totalNum * 100),
          planRevision: issueForm.planRevision.trim() || 'Rev 1',
          ...(issueForm.splitScopeOverrideReason.trim()
            ? { splitScopeOverrideReason: issueForm.splitScopeOverrideReason.trim() }
            : {}),
        }),
      });
      setShowIssueModal(false);
      setIssueForm((prev) => ({
        ...prev,
        scopeSummary: '',
        totalDollars: '',
        splitScopeOverrideReason: '',
      }));
      setAlert({
        type: 'ok',
        text: `Issued Purchase Order ${res.purchaseOrder.poNumber} for ${res.purchaseOrder.subName} (${formatCurrencyExact(
          res.purchaseOrder.totalCents
        )}).`,
      });
      await loadPos();
    } catch (err: unknown) {
      const e = err as ApiErrorLike;
      const reasons = e.data?.blockingReasons?.map((r) => r.message);
      setIssueError({
        text: e.message || 'Failed to issue purchase order.',
        reasons,
      });
    } finally {
      setIssuing(false);
    }
  };

  const handleTestComplianceBlock = async () => {
    setAlert(null);
    try {
      await apiFetch('/api/purchase-orders', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          homeId: 'home-ch-14',
          costCode: '19',
          subId: 'sub-hurricane-plumbing',
          poType: 'subcontractor',
          scopeSummary: 'Plumbing rough-in & finish package',
          totalCents: 2_150_000,
        }),
      });
    } catch (err: unknown) {
      const e = err as ApiErrorLike;
      setAlert({
        type: 'err',
        text: e.message,
        reasons: e.data?.blockingReasons?.map((r) => r.message),
      });
    }
  };

  const handleSign = async (id: string) => {
    setAlert(null);
    setSigningPoId(id);
    try {
      const res = await apiFetch<{ purchaseOrder: POItem }>(`/api/purchase-orders/${id}/sign`, {
        method: 'POST',
        role,
        subCompanyId,
      });
      setAlert({
        type: 'ok',
        text: `Recorded DocuSeal e-signature for ${res.purchaseOrder.poNumber} (${res.purchaseOrder.status.replaceAll(
          '_',
          ' '
        )}).`,
      });
      await loadPos();
    } catch (err: unknown) {
      const e = err as ApiErrorLike;
      if (e.status === 401 && e.data?.error === 'ReauthRequired') {
        setPendingSignPoId(id);
        setReauthOpen(true);
        return;
      }
      setAlert({
        type: 'err',
        text: e.message || 'Sign failed.',
      });
    } finally {
      setSigningPoId(null);
    }
  };

  const handleReauthVerified = () => {
    const targetId = pendingSignPoId;
    setReauthOpen(false);
    setPendingSignPoId(null);
    if (targetId) {
      void handleSign(targetId);
    }
  };

  const renderWaitingLabel = (po: POItem) => {
    if (po.status === 'fully_signed') return 'Certificate Stored';
    if (po.status === 'pending_sub_signature') return 'Awaiting Sub Signature';
    if (po.status === 'pending_approver_signature') return 'Awaiting Approver';
    return po.status.replaceAll('_', ' ');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-[#111111]">
            Purchase Orders &amp; Subcontract Agreements
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.6 &amp; 8.2 — Subcontractor POs (referencing Master Subcontract Agreement) vs.
            Supplier POs, compliance-gated with DocuSeal e-signature.
          </p>
        </div>
        {canIssuePo ? (
          <div className="flex flex-col sm:flex-row w-full sm:w-auto items-stretch sm:items-center gap-2.5">
            {authMode === 'demo' ? (
              <button
                type="button"
                onClick={handleTestComplianceBlock}
                className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-3.5 py-2 rounded-md border border-[#991B1B] bg-[#FEF2F2] text-xs font-display font-semibold text-[#991B1B] hover:bg-[#991B1B] hover:text-white active:bg-[#991B1B] active:text-white transition-colors"
              >
                Test Expired-COI PO Block (Demo)
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void openIssueModal()}
              className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white transition-colors"
            >
              + Issue Purchase Order
            </button>
          </div>
        ) : null}
      </div>

      {alert ? (
        <div
          role="status"
          className={`rounded-lg px-4 py-3 text-xs border break-words ${
            alert.type === 'err'
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
              : 'bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]'
          }`}
        >
          <div className="font-bold">{alert.text}</div>
          {alert.reasons?.map((r, i) => (
            <div key={i} className="mt-1">
              • {r}
            </div>
          ))}
        </div>
      ) : null}

      {loadError ? (
        <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-4 py-3 rounded-lg text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 break-words">Unable to load purchase orders: {loadError}</div>
          <button
            type="button"
            onClick={() => void loadPos()}
            className="w-full sm:w-auto shrink-0 min-h-[44px] px-4 py-2 rounded-md border border-[#991B1B] bg-white text-xs font-display font-semibold text-[#991B1B] hover:bg-[#991B1B] hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="bg-white border border-[#E3E3DE] rounded-lg px-4 py-10 text-center text-xs text-[#5F5F5A]">
          Loading purchase orders…
        </div>
      ) : (
        <>
          {/* Mobile Stacked PO Cards (<md) */}
          <div className="md:hidden space-y-3">
            {pos.map((po) => {
              const eligibleToSign = canSignPo(po);
              const isSigning = signingPoId === po.id;
              return (
                <article
                  key={po.id}
                  className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-mono font-bold text-sm text-[#111111] break-all">
                      {po.poNumber}
                    </div>
                    <span
                      className={`shrink-0 inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                        po.status === 'fully_signed'
                          ? 'bg-[#DCFCE7] text-[#166534]'
                          : 'bg-[#FEF3C7] text-[#8A5A00]'
                      }`}
                    >
                      {po.status.replaceAll('_', ' ')}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="font-semibold text-[#111111]">
                      {po.homeCode} · {po.costCode} {po.costCodeName}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[#111111]">{po.subName}</span>
                      <span className="inline-block text-[10px] font-display font-bold uppercase px-2 py-0.5 rounded bg-[#F4F4F1] text-[#3B3B38] border border-[#E3E3DE]">
                        {po.poType}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E3E3DE]/80">
                      <div className="min-w-0">
                        <div className="text-[10px] font-display uppercase tracking-wider text-[#5F5F5A]">
                          Master Agreement
                        </div>
                        <div className="text-[#3B3B38] truncate">
                          {po.masterAgreementRef ?? 'Supplier Terms'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] font-display uppercase tracking-wider text-[#5F5F5A]">
                          Amount
                        </div>
                        <div className="text-base font-display font-bold tabular-nums text-[#111111]">
                          {formatCurrencyExact(po.totalCents)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {eligibleToSign ? (
                    <button
                      type="button"
                      disabled={isSigning}
                      onClick={() => void handleSign(po.id)}
                      className="w-full min-h-[44px] flex items-center justify-center rounded-md bg-[#FCAE1A] text-xs text-[#111111] font-display font-bold hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white disabled:opacity-60 transition-colors"
                    >
                      {isSigning
                        ? 'Recording Signature…'
                        : `E-Sign (${po.status === 'pending_sub_signature' ? 'Sub' : 'Approver'})`}
                    </button>
                  ) : po.status === 'fully_signed' ? (
                    <div className="min-h-[40px] flex items-center justify-center rounded-md bg-[#DCFCE7] text-[#166534] text-xs font-display font-semibold">
                      Certificate Stored
                    </div>
                  ) : (
                    <div className="min-h-[40px] flex items-center justify-center rounded-md bg-[#F4F4F1] text-[#5F5F5A] text-xs font-medium">
                      {renderWaitingLabel(po)}
                    </div>
                  )}
                </article>
              );
            })}

            {pos.length === 0 && !loadError ? (
              <div className="bg-white border border-[#E3E3DE] rounded-lg px-4 py-8 text-center text-xs text-[#5F5F5A]">
                No purchase orders issued yet.
              </div>
            ) : null}
          </div>

          {/* Desktop 7-Column Table (md+) */}
          <div className="hidden md:block bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1] text-[10px] font-display uppercase text-[#5F5F5A]">
                    <th className="py-3 px-4">PO Number</th>
                    <th className="py-3 px-3">Home / Code</th>
                    <th className="py-3 px-3">Vendor &amp; Type</th>
                    <th className="py-3 px-3">Master Agreement</th>
                    <th className="py-3 px-3 text-right">Amount</th>
                    <th className="py-3 px-3">E-Sign Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3E3DE]">
                  {pos.map((po) => {
                    const eligibleToSign = canSignPo(po);
                    const isSigning = signingPoId === po.id;
                    return (
                      <tr key={po.id} className="hover:bg-[#F4F4F1]/40">
                        <td className="py-3 px-4 font-mono font-bold text-[#111111] whitespace-nowrap">
                          {po.poNumber}
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[#111111]">{po.homeCode}</div>
                          <div className="text-[#5F5F5A]">
                            {po.costCode} {po.costCodeName}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-[#111111]">{po.subName}</div>
                          <div className="text-[11px] text-[#5F5F5A] uppercase">{po.poType} PO</div>
                        </td>
                        <td className="py-3 px-3 text-[#3B3B38]">
                          {po.masterAgreementRef ?? 'Supplier Terms'}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums font-semibold text-[#111111] whitespace-nowrap">
                          {formatCurrencyExact(po.totalCents)}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                              po.status === 'fully_signed'
                                ? 'bg-[#DCFCE7] text-[#166534]'
                                : 'bg-[#FEF3C7] text-[#8A5A00]'
                            }`}
                          >
                            {po.status.replaceAll('_', ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {eligibleToSign ? (
                            <button
                              type="button"
                              disabled={isSigning}
                              onClick={() => void handleSign(po.id)}
                              className="px-3 py-1.5 rounded bg-[#FCAE1A] text-[#111111] font-display font-bold hover:bg-[#111111] hover:text-white disabled:opacity-60 transition-colors"
                            >
                              {isSigning
                                ? 'Signing…'
                                : `E-Sign (${po.status === 'pending_sub_signature' ? 'Sub' : 'Approver'})`}
                            </button>
                          ) : po.status === 'fully_signed' ? (
                            <span className="text-[#166534] font-semibold">Certificate Stored</span>
                          ) : (
                            <span className="text-[#5F5F5A]">{renderWaitingLabel(po)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pos.length === 0 && !loadError ? (
                    <tr>
                      <td colSpan={7} className="py-8 px-4 text-center text-xs text-[#5F5F5A]">
                        No purchase orders issued yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Issue Purchase Order Modal */}
      {showIssueModal && canIssuePo ? (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="issue-po-modal-title"
        >
          <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl border border-[#E3E3DE] shadow-xl max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[#E3E3DE] sticky top-0 bg-white">
              <h2
                id="issue-po-modal-title"
                className="text-sm font-display font-bold text-[#111111]"
              >
                Issue Purchase Order
              </h2>
              <button
                type="button"
                aria-label="Close issue purchase order modal"
                onClick={() => setShowIssueModal(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md text-[#5F5F5A] hover:text-[#111111] hover:bg-[#F4F4F1]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleIssuePoSubmit} className="p-4 sm:p-5 space-y-4">
              {issueError ? (
                <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-3.5 py-2.5 rounded-md text-xs break-words space-y-1">
                  <div className="font-bold">{issueError.text}</div>
                  {issueError.reasons?.map((reason, idx) => (
                    <div key={idx}>• {reason}</div>
                  ))}
                </div>
              ) : null}

              {loadingRefs ? (
                <div className="py-6 text-center text-xs text-[#5F5F5A]">
                  Loading homes and vendors…
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-[#111111] mb-1">
                        Home
                      </label>
                      <select
                        required
                        value={issueForm.homeId}
                        onChange={(e) => {
                          const picked = homes.find((h) => h.id === e.target.value);
                          setIssueForm({
                            ...issueForm,
                            homeId: e.target.value,
                            planRevision: picked?.planRevision ?? issueForm.planRevision,
                          });
                        }}
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
                        Plan Revision
                      </label>
                      <input
                        required
                        value={issueForm.planRevision}
                        onChange={(e) =>
                          setIssueForm({ ...issueForm, planRevision: e.target.value })
                        }
                        className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                      />
                    </div>
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
                      {ISSUABLE_COST_CODES.map((cc) => (
                        <option key={cc.code} value={cc.code}>
                          {cc.code} — {cc.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#111111] mb-1">
                      Subcontractor / Supplier
                    </label>
                    <select
                      required
                      value={issueForm.subId}
                      onChange={(e) => {
                        const picked = subs.find((s) => s.id === e.target.value);
                        setIssueForm({
                          ...issueForm,
                          subId: e.target.value,
                          poType:
                            picked?.companyType === 'supplier' ? 'supplier' : 'subcontractor',
                        });
                      }}
                      className="w-full min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                    >
                      {subs.length === 0 ? (
                        <option value="">No vendors available</option>
                      ) : (
                        subs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.legalName} ({s.companyType}
                            {s.complianceStatus?.eligible === false ? ' · Compliance Blocked' : ''})
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-[#111111] mb-1">
                        PO Type
                      </label>
                      <select
                        value={issueForm.poType}
                        onChange={(e) =>
                          setIssueForm({
                            ...issueForm,
                            poType: e.target.value as 'subcontractor' | 'supplier',
                          })
                        }
                        className="w-full min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                      >
                        <option value="subcontractor">Subcontractor PO (MSA)</option>
                        <option value="supplier">Supplier PO (Materials)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#111111] mb-1">
                        Total Amount ($)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        required
                        placeholder="e.g. 21500.00"
                        value={issueForm.totalDollars}
                        onChange={(e) =>
                          setIssueForm({ ...issueForm, totalDollars: e.target.value })
                        }
                        className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#111111] mb-1">
                      Scope Summary
                    </label>
                    <textarea
                      rows={3}
                      required
                      placeholder="Describe included work, plan sheets, and delivery terms…"
                      value={issueForm.scopeSummary}
                      onChange={(e) =>
                        setIssueForm({ ...issueForm, scopeSummary: e.target.value })
                      }
                      className="w-full border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#111111] mb-1">
                      Split-Scope Override Reason{' '}
                      <span className="font-normal text-[#5F5F5A]">
                        (optional — required only for a second PO on the same home &amp; code)
                      </span>
                    </label>
                    <input
                      value={issueForm.splitScopeOverrideReason}
                      onChange={(e) =>
                        setIssueForm({ ...issueForm, splitScopeOverrideReason: e.target.value })
                      }
                      placeholder="e.g. Separate basement finish package"
                      className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
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
                  {issuing ? 'Issuing…' : 'Issue Purchase Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Re-authentication Modal for 401 ReauthRequired on PO E-Sign */}
      <ReauthModal
        open={reauthOpen}
        onClose={() => {
          setReauthOpen(false);
          setPendingSignPoId(null);
        }}
        onVerified={handleReauthVerified}
        title="Re-verify Password to E-Sign Purchase Order"
      />
    </div>
  );
}
