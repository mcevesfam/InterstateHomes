'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface SubCompliance {
  id: string;
  legalName: string;
  companyType: string;
  complianceDocs: Array<{
    docType: string;
    reviewStatus: string;
    expiresAt?: string | null;
    agreementVersion?: string | null;
  }>;
  complianceStatus: {
    eligible: boolean;
    blockingReasons: Array<{ docType: string; message: string }>;
  };
}

export default function CompliancePage() {
  const { role, subCompanyId } = useRole();
  const [subs, setSubs] = useState<SubCompliance[]>([]);

  usePageContext({
    section: 'Compliance',
    entityType: 'compliance_list',
    entityLabel: `${subs.filter((s) => !s.complianceStatus.eligible).length} Blocked Vendors`,
    summary: {
      totalSubs: subs.length,
      blockedCount: subs.filter((s) => !s.complianceStatus.eligible).length,
    },
  });

  useEffect(() => {
    apiFetch<{ subcontractors: SubCompliance[] }>('/api/subcontractors', { role, subCompanyId })
      .then((res) => setSubs(res.subcontractors))
      .catch(() => {});
  }, [role, subCompanyId]);

  return (
    <div className="space-y-5 min-w-0">
      <div>
        <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
          Compliance Dashboard &amp; Document Expiry
        </h1>
        <p className="text-xs text-[#5F5F5A] mt-0.5">
          Section 5.3 &amp; 8.2 — Automated 30/15/0-day expiry reminders; expired or missing docs
          block PO creation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {subs.map((sub) => (
          <div
            key={sub.id}
            className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-3 min-w-0"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-display font-bold text-sm text-[#111111] break-words">
                  {sub.legalName}
                </div>
                <div className="text-[11px] uppercase text-[#5F5F5A]">{sub.companyType}</div>
              </div>
              <span
                className={`shrink-0 text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap ${
                  sub.complianceStatus.eligible
                    ? 'bg-[#DCFCE7] text-[#166534]'
                    : 'bg-[#FEE2E2] text-[#991B1B]'
                }`}
              >
                {sub.complianceStatus.eligible ? 'Compliant' : 'PO Blocked'}
              </span>
            </div>

            {sub.complianceStatus.blockingReasons.length > 0 ? (
              <div className="bg-[#FEF2F2] border border-[#FECACA] rounded px-3 py-2 text-xs text-[#991B1B] space-y-0.5 break-words">
                {sub.complianceStatus.blockingReasons.map((b, i) => (
                  <div key={i}>• {b.message}</div>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {sub.complianceDocs.map((doc, idx) => (
                <div
                  key={idx}
                  className="border border-[#E3E3DE] rounded px-2.5 py-2 flex items-center justify-between gap-2 min-w-0"
                >
                  <span className="font-mono text-[11px] text-[#111111] break-words min-w-0">
                    {doc.docType}
                  </span>
                  <span className="text-[#5F5F5A] tabular-nums shrink-0 text-right">
                    {doc.expiresAt ?? doc.agreementVersion ?? 'On file'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
