'use client';

import React, { useEffect, useState } from 'react';
import { Mail, Phone } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface SubItem {
  id: string;
  legalName: string;
  dbaName: string | null;
  companyType: string;
  mainPhone: string;
  primaryContactName: string;
  primaryContactEmail: string;
  status: string;
  costCodesServed: string[];
  subdivisionsServed: string[];
  paymentTermsNetDays: number;
  w9TinMasked: string;
  lastPricingUpdatedAt: string;
  complianceStatus: {
    eligible: boolean;
    blockingReasons: Array<{ docType: string; message: string }>;
  };
}

export default function SubcontractorsPage() {
  const { role, subCompanyId } = useRole();
  const [subs, setSubs] = useState<SubItem[]>([]);

  usePageContext({
    section: 'Subcontractors',
    entityType: 'subcontractor_list',
    entityLabel: `${subs.length} Vendors`,
    summary: { subcontractorCount: subs.length },
  });

  useEffect(() => {
    apiFetch<{ subcontractors: SubItem[] }>('/api/subcontractors', { role, subCompanyId })
      .then((res) => setSubs(res.subcontractors))
      .catch(() => {});
  }, [role, subCompanyId]);

  return (
    <div className="space-y-5 min-w-0">
      <div>
        <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
          Subcontractor &amp; Supplier Directory
        </h1>
        <p className="text-xs text-[#5F5F5A] mt-0.5">
          Section 5.3 &amp; 8.1 — Trades served, subdivisions, masked W-9 TINs, pricing freshness, and PO eligibility.
        </p>
      </div>

      {/* Mobile Vendor Cards */}
      <div className="md:hidden space-y-3">
        {subs.length === 0 ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-5 text-xs text-[#5F5F5A] text-center">
            No vendors found.
          </div>
        ) : (
          subs.map((s) => {
            const telHref = s.mainPhone ? `tel:${s.mainPhone.replace(/[^+\d]/g, '')}` : null;
            const mailHref = s.primaryContactEmail ? `mailto:${s.primaryContactEmail}` : null;
            return (
              <div
                key={s.id}
                className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-3 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display font-bold text-sm text-[#111111] break-words">
                      {s.legalName}
                    </div>
                    <div className="text-[11px] uppercase font-bold text-[#5F5F5A] mt-0.5">
                      {s.companyType} · Net {s.paymentTermsNetDays}d
                    </div>
                  </div>
                  {s.complianceStatus.eligible ? (
                    <span className="shrink-0 text-[11px] px-2.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] font-semibold">
                      Eligible
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] px-2.5 py-0.5 rounded-full bg-[#FEE2E2] text-[#991B1B] font-semibold">
                      PO Blocked ({s.complianceStatus.blockingReasons.length})
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 pt-2 border-t border-[#E3E3DE]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-display uppercase text-[#5F5F5A] shrink-0">
                      Trades
                    </span>
                    <span className="font-mono font-semibold text-[#111111] text-right break-words">
                      {s.costCodesServed.join(', ') || '—'}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-display uppercase text-[#5F5F5A] shrink-0">
                      Subdivisions
                    </span>
                    <span className="text-[#3B3B38] text-right break-words">
                      {s.subdivisionsServed.join(', ') || '—'}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-display uppercase text-[#5F5F5A] shrink-0">
                      W-9 TIN
                    </span>
                    <span className="font-mono text-[#3B3B38]">{s.w9TinMasked}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-display uppercase text-[#5F5F5A] shrink-0">
                      Pricing Updated
                    </span>
                    <span className="tabular-nums text-[#3B3B38]">{s.lastPricingUpdatedAt}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#E3E3DE] space-y-2">
                  <div className="text-[11px] text-[#5F5F5A]">
                    <span className="font-semibold text-[#111111]">{s.primaryContactName}</span>
                    {s.mainPhone ? <span> · {s.mainPhone}</span> : null}
                    {s.primaryContactEmail ? (
                      <div className="break-all">{s.primaryContactEmail}</div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {telHref ? (
                      <a
                        href={telHref}
                        aria-label={`Call ${s.legalName} at ${s.mainPhone}`}
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-[#111111] text-white font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] active:bg-[#FCAE1A] active:text-[#111111] transition-colors"
                      >
                        <Phone className="w-4 h-4 shrink-0" />
                        <span>Call</span>
                      </a>
                    ) : (
                      <span className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-[#F4F4F1] text-[#5F5F5A] font-display font-semibold">
                        <Phone className="w-4 h-4 shrink-0" />
                        <span>No Phone</span>
                      </span>
                    )}
                    {mailHref ? (
                      <a
                        href={mailHref}
                        aria-label={`Email ${s.primaryContactName} at ${s.primaryContactEmail}`}
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-[#E3E3DE] bg-[#F4F4F1] text-[#111111] font-display font-semibold hover:bg-[#E3E3DE] active:bg-[#E3E3DE] transition-colors"
                      >
                        <Mail className="w-4 h-4 shrink-0" />
                        <span>Email</span>
                      </a>
                    ) : (
                      <span className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-[#F4F4F1] text-[#5F5F5A] font-display font-semibold">
                        <Mail className="w-4 h-4 shrink-0" />
                        <span>No Email</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop 6-Column Directory Table */}
      <div className="hidden md:block overflow-x-auto bg-white border border-[#E3E3DE] rounded-lg">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1] text-[10px] font-display uppercase text-[#5F5F5A]">
              <th className="py-3 px-4">Company</th>
              <th className="py-3 px-3">Type &amp; Trades</th>
              <th className="py-3 px-3">Primary Contact</th>
              <th className="py-3 px-3">W-9 TIN (Masked)</th>
              <th className="py-3 px-3">Pricing Updated</th>
              <th className="py-3 px-4 text-right">PO Eligibility</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E3DE]">
            {subs.map((s) => (
              <tr key={s.id} className="hover:bg-[#F4F4F1]/40">
                <td className="py-3 px-4">
                  <div className="font-semibold text-[#111111]">{s.legalName}</div>
                  <div className="text-[11px] text-[#5F5F5A]">
                    Net {s.paymentTermsNetDays}d · Subdivisions: {s.subdivisionsServed.join(', ')}
                  </div>
                </td>
                <td className="py-3 px-3">
                  <div className="uppercase text-[10px] font-bold text-[#5F5F5A]">
                    {s.companyType}
                  </div>
                  <div className="font-mono mt-0.5">{s.costCodesServed.join(', ')}</div>
                </td>
                <td className="py-3 px-3">
                  <div>{s.primaryContactName}</div>
                  <div className="text-[#5F5F5A]">{s.primaryContactEmail}</div>
                </td>
                <td className="py-3 px-3 font-mono text-[#3B3B38]">{s.w9TinMasked}</td>
                <td className="py-3 px-3 tabular-nums text-[#3B3B38]">
                  {s.lastPricingUpdatedAt}
                </td>
                <td className="py-3 px-4 text-right">
                  {s.complianceStatus.eligible ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#166534] font-semibold whitespace-nowrap">
                      Eligible
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full bg-[#FEE2E2] text-[#991B1B] font-semibold whitespace-nowrap">
                      PO Blocked ({s.complianceStatus.blockingReasons.length})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
