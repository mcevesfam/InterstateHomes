'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { canAccess, type ComplianceDocType } from '@interstate/shared';
import { apiFetch } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface SubComplianceDoc {
  id?: string;
  docType: ComplianceDocType;
  fileName?: string;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  expiresAt?: string | null;
  limitAmountCents?: number | null;
  additionalInsured?: boolean | null;
  licenseClassification?: string | null;
  agreementVersion?: string | null;
}

interface SubCompliance {
  id: string;
  legalName: string;
  companyType: string;
  complianceDocs: SubComplianceDoc[];
  complianceStatus: {
    eligible: boolean;
    blockingReasons: Array<{ docType: string; message: string }>;
  };
}

const DOC_TYPE_LABELS: Record<ComplianceDocType, string> = {
  coi_gl: 'COI — General Liability',
  auto_liability: 'Auto Liability COI',
  workers_comp: "Workers' Comp / Exemption",
  w9: 'IRS Form W-9',
  utah_license: 'Utah Contractor License',
  business_license: 'Business License',
  master_agreement: 'Master Subcontract Agreement',
};

const REVIEW_BADGES: Record<string, string> = {
  approved: 'bg-[#DCFCE7] text-[#166534]',
  pending: 'bg-[#FEF3C7] text-[#8A5A00]',
  rejected: 'bg-[#FEE2E2] text-[#991B1B]',
};

export default function CompliancePage() {
  const { role, subCompanyId } = useRole();
  const canReview = canAccess(role, 'compliance:review');
  const canUpload = canAccess(role, 'compliance:upload_own') || canReview;

  const [subs, setSubs] = useState<SubCompliance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [reviewingDocKey, setReviewingDocKey] = useState<string | null>(null);

  const [showUploadForm, setShowUploadForm] = useState(false);
  const [targetSubId, setTargetSubId] = useState('');
  const [docType, setDocType] = useState<ComplianceDocType>('coi_gl');
  const [fileName, setFileName] = useState('');
  const [carrier, setCarrier] = useState('');
  const [policyOrLicenseNumber, setPolicyOrLicenseNumber] = useState('');
  const [limitDollars, setLimitDollars] = useState('1000000');
  const [additionalInsured, setAdditionalInsured] = useState(true);
  const [licenseClassification, setLicenseClassification] = useState('S270');
  const [expiresAt, setExpiresAt] = useState(() => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    return nextYear.toISOString().slice(0, 10);
  });
  const [agreementVersion, setAgreementVersion] = useState('2026.1');
  const [entityType, setEntityType] = useState('LLC');
  const [w9Tin, setW9Tin] = useState('');
  const [uploading, setUploading] = useState(false);

  usePageContext({
    section: 'Compliance',
    entityType: 'compliance_list',
    entityLabel: `${subs.filter((s) => !s.complianceStatus.eligible).length} Blocked Vendors`,
    summary: {
      totalSubs: subs.length,
      blockedCount: subs.filter((s) => !s.complianceStatus.eligible).length,
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch<{ subcontractors: SubCompliance[] }>('/api/subcontractors', {
        role,
        subCompanyId,
      });
      setSubs(res.subcontractors);
      setTargetSubId((prev) => prev || res.subcontractors[0]?.id || (role === 'subcontractor' ? subCompanyId : ''));
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load compliance records.');
    } finally {
      setLoading(false);
    }
  }, [role, subCompanyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedSubId = role === 'subcontractor' ? (subs[0]?.id ?? subCompanyId) : targetSubId;
    if (!resolvedSubId) {
      setNotice({ type: 'err', text: 'Select a subcontractor or supplier first.' });
      return;
    }

    const payload: Record<string, unknown> = {
      docType,
      fileName: fileName.trim(),
    };

    if (docType === 'coi_gl' || docType === 'auto_liability' || docType === 'workers_comp') {
      if (carrier.trim()) payload.carrier = carrier.trim();
      if (policyOrLicenseNumber.trim()) payload.policyOrLicenseNumber = policyOrLicenseNumber.trim();
      if (expiresAt) payload.expiresAt = expiresAt;
    }
    if (docType === 'coi_gl' || docType === 'auto_liability') {
      const limitVal = Number(limitDollars);
      if (Number.isFinite(limitVal) && limitVal >= 0) {
        payload.limitAmountCents = Math.round(limitVal * 100);
      }
    }
    if (docType === 'coi_gl') {
      payload.additionalInsured = additionalInsured;
    }
    if (docType === 'utah_license' || docType === 'business_license') {
      if (policyOrLicenseNumber.trim()) payload.policyOrLicenseNumber = policyOrLicenseNumber.trim();
      if (expiresAt) payload.expiresAt = expiresAt;
    }
    if (docType === 'utah_license' && licenseClassification.trim()) {
      payload.licenseClassification = licenseClassification.trim();
    }
    if (docType === 'master_agreement') {
      payload.agreementVersion = agreementVersion.trim() || '2026.1';
    }
    if (docType === 'w9') {
      if (entityType.trim()) payload.entityType = entityType.trim();
      if (w9Tin.trim()) payload.w9Tin = w9Tin.trim();
    }

    setUploading(true);
    setNotice(null);
    try {
      await apiFetch(`/api/subcontractors/${resolvedSubId}/compliance-docs`, {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify(payload),
      });
      setNotice({
        type: 'ok',
        text: `Uploaded ${DOC_TYPE_LABELS[docType]} (${fileName.trim()}).`,
      });
      setFileName('');
      setCarrier('');
      setPolicyOrLicenseNumber('');
      setW9Tin('');
      setShowUploadForm(false);
      await load();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to upload compliance document.',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleReview = async (
    subId: string,
    docId: string,
    reviewStatus: 'approved' | 'rejected'
  ) => {
    const key = `${subId}:${docId}`;
    setReviewingDocKey(key);
    setNotice(null);
    try {
      await apiFetch(`/api/subcontractors/${subId}/compliance-docs/${docId}/review`, {
        method: 'PATCH',
        role,
        subCompanyId,
        body: JSON.stringify({ reviewStatus }),
      });
      setNotice({
        type: 'ok',
        text: `Compliance document marked ${reviewStatus}.`,
      });
      await load();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update document review status.',
      });
    } finally {
      setReviewingDocKey(null);
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
            Compliance Dashboard &amp; Document Expiry
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.3 &amp; 8.2 — Automated 30/15/0-day expiry reminders; expired or missing docs
            block PO creation.
          </p>
        </div>
        {canUpload ? (
          <button
            type="button"
            onClick={() => setShowUploadForm((v) => !v)}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] transition-colors cursor-pointer shrink-0"
          >
            {showUploadForm ? 'Close Upload Form' : '+ Upload Compliance Document'}
          </button>
        ) : null}
      </div>

      {notice ? (
        <div
          role="alert"
          className={`px-4 py-3 rounded-md text-xs border flex items-start justify-between gap-2 break-words ${
            notice.type === 'ok'
              ? 'bg-[#DCFCE7] border-[#86EFAC] text-[#166534]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <span className="font-semibold">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="underline shrink-0 cursor-pointer">
            Dismiss
          </button>
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

      {canUpload && showUploadForm ? (
        <form
          onSubmit={handleUpload}
          className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-4 text-xs"
        >
          <div className="font-display font-bold text-sm text-[#111111]">
            Upload Compliance Document
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {role !== 'subcontractor' ? (
              <label className="space-y-1 block">
                <span className="font-semibold text-[#3B3B38]">Subcontractor / Supplier *</span>
                <select
                  required
                  value={targetSubId}
                  onChange={(e) => setTargetSubId(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
                >
                  <option value="">Select vendor…</option>
                  {subs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.legalName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Document Type *</span>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value as ComplianceDocType)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                {(Object.keys(DOC_TYPE_LABELS) as ComplianceDocType[]).map((key) => (
                  <option key={key} value={key}>
                    {DOC_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Document File Name *</span>
              <input
                type="text"
                required
                placeholder="e.g. 2026-COI-GL.pdf"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>

            {(docType === 'coi_gl' || docType === 'auto_liability' || docType === 'workers_comp') ? (
              <label className="space-y-1 block">
                <span className="font-semibold text-[#3B3B38]">Insurance Carrier</span>
                <input
                  type="text"
                  placeholder="e.g. Travelers / WCF"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
                />
              </label>
            ) : null}

            {(docType === 'coi_gl' ||
              docType === 'auto_liability' ||
              docType === 'workers_comp' ||
              docType === 'utah_license' ||
              docType === 'business_license') ? (
              <>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">
                    {docType.includes('license') ? 'License Number' : 'Policy Number'}
                  </span>
                  <input
                    type="text"
                    placeholder={docType.includes('license') ? 'e.g. UT-984512-5501' : 'e.g. GL-2026-4412'}
                    value={policyOrLicenseNumber}
                    onChange={(e) => setPolicyOrLicenseNumber(e.target.value)}
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 font-mono"
                  />
                </label>

                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">Expiration Date *</span>
                  <input
                    type="date"
                    required
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
                  />
                </label>
              </>
            ) : null}

            {(docType === 'coi_gl' || docType === 'auto_liability') ? (
              <label className="space-y-1 block">
                <span className="font-semibold text-[#3B3B38]">Coverage Limit (USD)</span>
                <input
                  type="number"
                  min={0}
                  step="1000"
                  placeholder="1000000"
                  value={limitDollars}
                  onChange={(e) => setLimitDollars(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 tabular-nums"
                />
              </label>
            ) : null}

            {docType === 'utah_license' ? (
              <label className="space-y-1 block">
                <span className="font-semibold text-[#3B3B38]">License Classification</span>
                <input
                  type="text"
                  placeholder="e.g. S270, S210, B100"
                  value={licenseClassification}
                  onChange={(e) => setLicenseClassification(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 font-mono"
                />
              </label>
            ) : null}

            {docType === 'master_agreement' ? (
              <label className="space-y-1 block">
                <span className="font-semibold text-[#3B3B38]">Agreement Version *</span>
                <input
                  type="text"
                  required
                  placeholder="2026.1"
                  value={agreementVersion}
                  onChange={(e) => setAgreementVersion(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 font-mono"
                />
              </label>
            ) : null}

            {docType === 'w9' ? (
              <>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">Tax Entity Type</span>
                  <select
                    value={entityType}
                    onChange={(e) => setEntityType(e.target.value)}
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
                  >
                    <option value="LLC">LLC</option>
                    <option value="Corporation">Corporation</option>
                    <option value="Sole Proprietor">Sole Proprietor</option>
                    <option value="Partnership">Partnership</option>
                  </select>
                </label>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">W-9 TIN / EIN (Encrypted &amp; Masked)</span>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder="XX-XXXXXXX (stored encrypted)"
                    value={w9Tin}
                    onChange={(e) => setW9Tin(e.target.value)}
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 font-mono"
                  />
                </label>
              </>
            ) : null}
          </div>

          {docType === 'coi_gl' ? (
            <label className="min-h-[44px] sm:min-h-0 inline-flex items-center gap-2 text-xs text-[#3B3B38] cursor-pointer">
              <input
                type="checkbox"
                checked={additionalInsured}
                onChange={(e) => setAdditionalInsured(e.target.checked)}
                className="w-4 h-4"
              />
              <span>Lists Interstate Homes as Additional Insured</span>
            </label>
          ) : null}

          <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2 border-t border-[#E3E3DE]">
            <button
              type="button"
              onClick={() => setShowUploadForm(false)}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white font-semibold text-[#3B3B38] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#FCAE1A] text-[#111111] font-display font-bold hover:bg-[#E59C12] disabled:opacity-50 cursor-pointer"
            >
              {uploading ? 'Uploading…' : 'Submit Document'}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <div className="bg-white border border-[#E3E3DE] rounded-lg p-6 text-xs text-[#5F5F5A] text-center">
          Loading compliance status…
        </div>
      ) : subs.length === 0 ? (
        <div className="bg-white border border-[#E3E3DE] rounded-lg p-6 text-xs text-[#5F5F5A] text-center">
          No subcontractors or compliance records found yet.
        </div>
      ) : (
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

              {sub.complianceDocs.length === 0 ? (
                <div className="border border-dashed border-[#E3E3DE] rounded px-3 py-3 text-xs text-[#5F5F5A] text-center">
                  No compliance documents uploaded yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {sub.complianceDocs.map((doc, idx) => {
                    const docKey = `${sub.id}:${doc.id ?? idx}`;
                    const isBusy = reviewingDocKey === docKey;
                    return (
                      <div
                        key={doc.id ?? idx}
                        className="border border-[#E3E3DE] rounded px-2.5 py-2 space-y-1.5 min-w-0"
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-mono text-[11px] font-semibold text-[#111111] break-words min-w-0">
                            {doc.docType}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize shrink-0 ${
                              REVIEW_BADGES[doc.reviewStatus] ?? REVIEW_BADGES.pending
                            }`}
                          >
                            {doc.reviewStatus}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[11px] text-[#5F5F5A] min-w-0">
                          <span className="truncate">{doc.fileName ?? 'Document'}</span>
                          <span className="tabular-nums shrink-0 text-right">
                            {doc.expiresAt ?? doc.agreementVersion ?? 'On file'}
                          </span>
                        </div>

                        {canReview && doc.id ? (
                          <div className="flex gap-1.5 pt-1 border-t border-[#E3E3DE]">
                            {doc.reviewStatus !== 'approved' ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleReview(sub.id, doc.id!, 'approved')}
                                className="flex-1 min-h-[44px] sm:min-h-[30px] px-2 py-1 rounded bg-[#166534] text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                              >
                                {isBusy ? 'Saving…' : 'Approve'}
                              </button>
                            ) : null}
                            {doc.reviewStatus !== 'rejected' ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleReview(sub.id, doc.id!, 'rejected')}
                                className="flex-1 min-h-[44px] sm:min-h-[30px] px-2 py-1 rounded border border-[#FECACA] bg-[#FEF2F2] text-[#991B1B] text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                              >
                                {isBusy ? 'Saving…' : 'Reject'}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
