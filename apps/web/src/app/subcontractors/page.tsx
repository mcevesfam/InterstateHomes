'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Phone } from 'lucide-react';
import { COST_CODES, canAccess } from '@interstate/shared';
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

const SUBDIVISION_OPTIONS = ['ALL', 'CH', 'LK', 'NS', 'PS', 'ZV', 'SH'];

export default function SubcontractorsPage() {
  const { role, subCompanyId } = useRole();
  const canCreate = canAccess(role, 'price_sheets:edit_any');

  const [subs, setSubs] = useState<SubItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [legalName, setLegalName] = useState('');
  const [dbaName, setDbaName] = useState('');
  const [companyType, setCompanyType] = useState<'subcontractor' | 'supplier' | 'both'>('subcontractor');
  const [mainPhone, setMainPhone] = useState('');
  const [address, setAddress] = useState('');
  const [primaryContactName, setPrimaryContactName] = useState('');
  const [primaryContactEmail, setPrimaryContactEmail] = useState('');
  const [primaryContactPhone, setPrimaryContactPhone] = useState('');
  const [paymentTermsNetDays, setPaymentTermsNetDays] = useState('30');
  const [retainagePercent, setRetainagePercent] = useState('0');
  const [hasVehiclesOnSite, setHasVehiclesOnSite] = useState(true);
  const [selectedCostCodes, setSelectedCostCodes] = useState<string[]>(['31']);
  const [costCodeToAdd, setCostCodeToAdd] = useState('19');
  const [selectedSubdivisions, setSelectedSubdivisions] = useState<string[]>(['ALL']);
  const [submitting, setSubmitting] = useState(false);

  usePageContext({
    section: 'Subcontractors',
    entityType: 'subcontractor_list',
    entityLabel: `${subs.length} Vendors`,
    summary: { subcontractorCount: subs.length },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch<{ subcontractors: SubItem[] }>('/api/subcontractors', {
        role,
        subCompanyId,
      });
      setSubs(res.subcontractors);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load subcontractors.');
    } finally {
      setLoading(false);
    }
  }, [role, subCompanyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSubdivision = (code: string) => {
    setSelectedSubdivisions((prev) => {
      if (code === 'ALL') return ['ALL'];
      const withoutAll = prev.filter((c) => c !== 'ALL');
      if (withoutAll.includes(code)) {
        const next = withoutAll.filter((c) => c !== code);
        return next.length > 0 ? next : ['ALL'];
      }
      return [...withoutAll, code];
    });
  };

  const addCostCode = (code: string) => {
    if (!code) return;
    setSelectedCostCodes((prev) => (prev.includes(code) ? prev : [...prev, code]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCostCodes.length === 0) {
      setNotice({ type: 'err', text: 'Select at least one trade cost code served.' });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      await apiFetch('/api/subcontractors', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          legalName: legalName.trim(),
          dbaName: dbaName.trim() || undefined,
          companyType,
          address: address.trim() || undefined,
          mainPhone: mainPhone.trim() || undefined,
          primaryContactName: primaryContactName.trim() || undefined,
          primaryContactEmail: primaryContactEmail.trim() || undefined,
          primaryContactPhone: primaryContactPhone.trim() || undefined,
          hasVehiclesOnSite,
          costCodesServed: selectedCostCodes,
          subdivisionsServed: selectedSubdivisions.length > 0 ? selectedSubdivisions : ['ALL'],
          paymentTermsNetDays: Math.max(0, Math.round(Number(paymentTermsNetDays) || 30)),
          retainagePercent: Math.min(20, Math.max(0, Number(retainagePercent) || 0)),
        }),
      });
      setNotice({ type: 'ok', text: `Added vendor "${legalName.trim()}".` });
      setLegalName('');
      setDbaName('');
      setMainPhone('');
      setAddress('');
      setPrimaryContactName('');
      setPrimaryContactEmail('');
      setPrimaryContactPhone('');
      setPaymentTermsNetDays('30');
      setRetainagePercent('0');
      setHasVehiclesOnSite(true);
      setSelectedCostCodes(['31']);
      setSelectedSubdivisions(['ALL']);
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to create subcontractor.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const tradeCostCodes = COST_CODES.filter((cc) => cc.code !== '00' && !cc.isInternalOnly);

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
            Subcontractor &amp; Supplier Directory
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.3 &amp; 8.1 — Trades served, subdivisions, masked W-9 TINs, pricing freshness, and PO eligibility.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] transition-colors cursor-pointer shrink-0"
          >
            {showForm ? 'Close Form' : '+ Add Subcontractor / Supplier'}
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

      {canCreate && showForm ? (
        <form
          onSubmit={handleCreate}
          className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-4 text-xs"
        >
          <div className="font-display font-bold text-sm text-[#111111]">
            Add Subcontractor or Supplier
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Legal Name *</span>
              <input
                type="text"
                required
                minLength={2}
                maxLength={200}
                placeholder="e.g. Red Cliffs Drywall LLC"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">DBA Name (Optional)</span>
              <input
                type="text"
                maxLength={200}
                placeholder="Doing business as..."
                value={dbaName}
                onChange={(e) => setDbaName(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Company Type *</span>
              <select
                value={companyType}
                onChange={(e) =>
                  setCompanyType(e.target.value as 'subcontractor' | 'supplier' | 'both')
                }
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                <option value="subcontractor">Subcontractor</option>
                <option value="supplier">Supplier</option>
                <option value="both">Both (Sub + Supplier)</option>
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Primary Contact Name</span>
              <input
                type="text"
                maxLength={120}
                placeholder="e.g. Jordan Miller"
                value={primaryContactName}
                onChange={(e) => setPrimaryContactName(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Primary Contact Email</span>
              <input
                type="email"
                maxLength={200}
                placeholder="bids@vendor.example"
                value={primaryContactEmail}
                onChange={(e) => setPrimaryContactEmail(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Main Phone</span>
              <input
                type="tel"
                maxLength={30}
                placeholder="435-555-0192"
                value={mainPhone}
                onChange={(e) => setMainPhone(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Contact Mobile (Optional)</span>
              <input
                type="tel"
                maxLength={30}
                placeholder="435-555-0199"
                value={primaryContactPhone}
                onChange={(e) => setPrimaryContactPhone(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Payment Terms (Net Days)</span>
              <input
                type="number"
                min={0}
                value={paymentTermsNetDays}
                onChange={(e) => setPaymentTermsNetDays(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 tabular-nums"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Retainage (%)</span>
              <input
                type="number"
                min={0}
                max={20}
                step="0.5"
                value={retainagePercent}
                onChange={(e) => setRetainagePercent(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 tabular-nums"
              />
            </label>
          </div>

          <label className="space-y-1 block">
            <span className="font-semibold text-[#3B3B38]">Office / Remit Address</span>
            <input
              type="text"
              maxLength={300}
              placeholder="123 Industrial Way, Hurricane, UT 84737"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
            />
          </label>

          {/* Trade Cost Codes Served */}
          <div className="space-y-2">
            <div className="font-semibold text-[#3B3B38]">Trade Cost Codes Served *</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                aria-label="Choose a trade cost code to add"
                value={costCodeToAdd}
                onChange={(e) => setCostCodeToAdd(e.target.value)}
                className="w-full sm:w-72 min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                {tradeCostCodes.map((cc) => (
                  <option key={cc.code} value={cc.code}>
                    {cc.code} — {cc.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => addCostCode(costCodeToAdd)}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-3.5 py-2 rounded-md border border-[#E3E3DE] bg-[#F4F4F1] font-semibold text-[#111111] cursor-pointer"
              >
                + Add Code
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedCostCodes.map((code) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#111111] text-white font-mono text-[11px]"
                >
                  <span>{code}</span>
                  <button
                    type="button"
                    aria-label={`Remove cost code ${code}`}
                    onClick={() => setSelectedCostCodes((prev) => prev.filter((c) => c !== code))}
                    className="text-[#FCAE1A] font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Subdivisions Served */}
          <div className="space-y-2">
            <div className="font-semibold text-[#3B3B38]">Subdivisions Served</div>
            <div className="flex flex-wrap gap-2">
              {SUBDIVISION_OPTIONS.map((sc) => {
                const active = selectedSubdivisions.includes(sc);
                return (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => toggleSubdivision(sc)}
                    className={`min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-md border text-xs font-semibold cursor-pointer ${
                      active
                        ? 'bg-[#111111] text-[#FCAE1A] border-[#111111]'
                        : 'bg-white text-[#3B3B38] border-[#E3E3DE]'
                    }`}
                  >
                    {sc}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="min-h-[44px] sm:min-h-0 inline-flex items-center gap-2 text-xs text-[#3B3B38] cursor-pointer">
            <input
              type="checkbox"
              checked={hasVehiclesOnSite}
              onChange={(e) => setHasVehiclesOnSite(e.target.checked)}
              className="w-4 h-4"
            />
            <span>Operates vehicles on Interstate job sites (requires Auto Liability COI)</span>
          </label>

          <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2 border-t border-[#E3E3DE]">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white font-semibold text-[#3B3B38] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#FCAE1A] text-[#111111] font-display font-bold hover:bg-[#E59C12] disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Creating…' : 'Create Vendor'}
            </button>
          </div>
        </form>
      ) : null}

      {/* Mobile Vendor Cards */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-5 text-xs text-[#5F5F5A] text-center">
            Loading subcontractors &amp; suppliers…
          </div>
        ) : subs.length === 0 ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-5 text-xs text-[#5F5F5A] text-center space-y-2">
            <div>No subcontractors or suppliers recorded yet.</div>
            {canCreate && !showForm ? (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="min-h-[44px] px-4 py-2 rounded-md bg-[#111111] text-white font-display font-semibold cursor-pointer"
              >
                + Add First Vendor
              </button>
            ) : null}
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
            {loading ? (
              <tr>
                <td colSpan={6} className="py-6 px-4 text-center text-[#5F5F5A]">
                  Loading subcontractors &amp; suppliers…
                </td>
              </tr>
            ) : subs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 px-4 text-center text-[#5F5F5A]">
                  No subcontractors or suppliers recorded yet.
                </td>
              </tr>
            ) : (
              subs.map((s) => (
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
                    <div className="text-[#5F5F5A]">{s.primaryContactEmail || s.mainPhone || '—'}</div>
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
