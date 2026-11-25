'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch, formatCurrencyExact } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

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

export default function PurchaseOrdersPage() {
  const { role, subCompanyId } = useRole();
  const [pos, setPos] = useState<POItem[]>([]);
  const [alert, setAlert] = useState<{ type: 'ok' | 'err'; text: string; reasons?: string[] } | null>(
    null
  );

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

  const loadPos = () => {
    apiFetch<{ purchaseOrders: POItem[] }>('/api/purchase-orders', { role, subCompanyId })
      .then((res) => setPos(res.purchaseOrders))
      .catch(() => {});
  };

  useEffect(() => {
    loadPos();
  }, [role, subCompanyId]);

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
      const e = err as Error & { data?: { blockingReasons?: Array<{ message: string }> } };
      setAlert({
        type: 'err',
        text: e.message,
        reasons: e.data?.blockingReasons?.map((r) => r.message),
      });
    }
  };

  const handleSign = async (id: string) => {
    setAlert(null);
    try {
      const res = await apiFetch<{ purchaseOrder: POItem }>(`/api/purchase-orders/${id}/sign`, {
        method: 'POST',
        role,
        subCompanyId,
      });
      setAlert({
        type: 'ok',
        text: `Recorded DocuSeal e-signature for ${res.purchaseOrder.poNumber} (${res.purchaseOrder.status}).`,
      });
      loadPos();
    } catch (err: unknown) {
      setAlert({
        type: 'err',
        text: err instanceof Error ? err.message : 'Sign failed',
      });
    }
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
        {(role === 'admin' || role === 'estimator_approver') && (
          <button
            type="button"
            onClick={handleTestComplianceBlock}
            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-3.5 py-2 rounded-md border border-[#991B1B] bg-[#FEF2F2] text-xs font-display font-semibold text-[#991B1B] hover:bg-[#991B1B] hover:text-white active:bg-[#991B1B] active:text-white transition-colors"
          >
            Test Expired-COI PO Block (Scenario 5)
          </button>
        )}
      </div>

      {alert ? (
        <div
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

      {/* Mobile Stacked PO Cards (<md) */}
      <div className="md:hidden space-y-3">
        {pos.map((po) => (
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
              <div>
                <div className="font-semibold text-[#111111]">
                  {po.homeCode} · {po.costCode} {po.costCodeName}
                </div>
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

            {po.status !== 'fully_signed' ? (
              <button
                type="button"
                onClick={() => handleSign(po.id)}
                className="w-full min-h-[44px] flex items-center justify-center rounded-md bg-[#FCAE1A] text-xs text-[#111111] font-display font-bold hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white transition-colors"
              >
                E-Sign ({po.status === 'pending_sub_signature' ? 'Sub' : 'Approver'})
              </button>
            ) : (
              <div className="min-h-[40px] flex items-center justify-center rounded-md bg-[#DCFCE7] text-[#166534] text-xs font-display font-semibold">
                Certificate Stored
              </div>
            )}
          </article>
        ))}

        {pos.length === 0 ? (
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
              {pos.map((po) => (
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
                    {po.status !== 'fully_signed' ? (
                      <button
                        type="button"
                        onClick={() => handleSign(po.id)}
                        className="px-3 py-1.5 rounded bg-[#FCAE1A] text-[#111111] font-display font-bold hover:bg-[#111111] hover:text-white transition-colors"
                      >
                        E-Sign ({po.status === 'pending_sub_signature' ? 'Sub' : 'Approver'})
                      </button>
                    ) : (
                      <span className="text-[#166534] font-semibold">Certificate Stored</span>
                    )}
                  </td>
                </tr>
              ))}
              {pos.length === 0 ? (
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
    </div>
  );
}
