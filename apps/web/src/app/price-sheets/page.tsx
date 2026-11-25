'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { COST_CODES, canAccess } from '@interstate/shared';
import { apiFetch, formatCurrencyExact } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface PriceSheet {
  id: string;
  subCompanyId?: string;
  subName: string;
  costCode: string;
  costCodeName: string;
  subdivisionScope: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  inclusionsExclusions: string;
  items: Array<{ id: string; subLineName: string; unit: string; unitPriceCents: number }>;
}

interface SubOption {
  id: string;
  legalName: string;
}

interface DraftLineItem {
  subLineName: string;
  unit: string;
  unitPriceDollars: string;
}

const SUBDIVISION_SCOPES = ['ALL', 'CH', 'LK', 'NS', 'PS', 'ZV', 'SH'];

export default function PriceSheetsPage() {
  const { role, subCompanyId } = useRole();
  const canEditAny = canAccess(role, 'price_sheets:edit_any');
  const canEditOwn = canAccess(role, 'price_sheets:edit_own');
  const canCreate = canEditAny || canEditOwn;

  const [sheets, setSheets] = useState<PriceSheet[]>([]);
  const [subs, setSubs] = useState<SubOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [selectedSubId, setSelectedSubId] = useState('');
  const [costCode, setCostCode] = useState('31');
  const [subdivisionScope, setSubdivisionScope] = useState('ALL');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveTo, setEffectiveTo] = useState('');
  const [inclusionsExclusions, setInclusionsExclusions] = useState('');
  const [draftItems, setDraftItems] = useState<DraftLineItem[]>([
    { subLineName: '', unit: 'SF', unitPriceDollars: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  usePageContext({
    section: 'Price Sheets',
    entityType: 'price_sheet_list',
    entityLabel: `${sheets.length} Price Sheets`,
    summary: { priceSheetCount: sheets.length },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [sheetsRes, subsRes] = await Promise.all([
        apiFetch<{ priceSheets: PriceSheet[] }>('/api/price-sheets', { role, subCompanyId }),
        canCreate
          ? apiFetch<{ subcontractors: SubOption[] }>('/api/subcontractors', { role, subCompanyId }).catch(
              () => ({ subcontractors: [] })
            )
          : Promise.resolve({ subcontractors: [] }),
      ]);
      setSheets(sheetsRes.priceSheets);
      setSubs(subsRes.subcontractors);
      if (canEditOwn && !canEditAny) {
        setSelectedSubId(subsRes.subcontractors[0]?.id ?? subCompanyId);
      } else {
        setSelectedSubId((prev) => prev || subsRes.subcontractors[0]?.id || '');
      }
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load price sheets.');
    } finally {
      setLoading(false);
    }
  }, [canCreate, canEditAny, canEditOwn, role, subCompanyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraftItem = (idx: number, field: keyof DraftLineItem, value: string) => {
    setDraftItems((prev) => prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetSubId = canEditAny ? selectedSubId : (subs[0]?.id ?? subCompanyId);
    if (!targetSubId) {
      setNotice({ type: 'err', text: 'Select a subcontractor or supplier first.' });
      return;
    }

    const parsedItems = draftItems
      .map((row) => ({
        subLineName: row.subLineName.trim(),
        unit: row.unit.trim(),
        unitPriceCents: Math.round(Number(row.unitPriceDollars) * 100),
      }))
      .filter((row) => row.subLineName.length > 0 && row.unit.length > 0 && Number.isFinite(row.unitPriceCents) && row.unitPriceCents >= 0);

    if (parsedItems.length === 0) {
      setNotice({ type: 'err', text: 'Add at least one valid sub-line item with name, unit, and price.' });
      return;
    }

    setSubmitting(true);
    setNotice(null);
    try {
      await apiFetch('/api/price-sheets', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          subCompanyId: targetSubId,
          costCode,
          subdivisionScope,
          effectiveFrom,
          effectiveTo: effectiveTo.trim() || null,
          inclusionsExclusions: inclusionsExclusions.trim(),
          items: parsedItems,
        }),
      });
      setNotice({ type: 'ok', text: `Created effective-dated price sheet for cost code ${costCode}.` });
      setInclusionsExclusions('');
      setEffectiveTo('');
      setDraftItems([{ subLineName: '', unit: 'SF', unitPriceDollars: '' }]);
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to create price sheet.',
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
            Effective-Dated Trade Price Sheets
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.4 &amp; 8.3 — Price sheet changes take effect on a date and never alter already-sent quotes or signed POs.
          </p>
        </div>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] transition-colors cursor-pointer shrink-0"
          >
            {showForm ? 'Close Form' : '+ New Price Sheet'}
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
            New Effective-Dated Price Sheet
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {canEditAny ? (
              <label className="space-y-1 block sm:col-span-2 lg:col-span-2">
                <span className="font-semibold text-[#3B3B38]">Subcontractor / Supplier</span>
                <select
                  required
                  value={selectedSubId}
                  onChange={(e) => setSelectedSubId(e.target.value)}
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
              <span className="font-semibold text-[#3B3B38]">Cost Code</span>
              <select
                required
                value={costCode}
                onChange={(e) => setCostCode(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                {tradeCostCodes.map((cc) => (
                  <option key={cc.code} value={cc.code}>
                    {cc.code} — {cc.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Subdivision Scope</span>
              <select
                value={subdivisionScope}
                onChange={(e) => setSubdivisionScope(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                {SUBDIVISION_SCOPES.map((sc) => (
                  <option key={sc} value={sc}>
                    {sc === 'ALL' ? 'ALL Subdivisions' : sc}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Effective From</span>
              <input
                type="date"
                required
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>

            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Effective To (Optional)</span>
              <input
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
          </div>

          <label className="space-y-1 block">
            <span className="font-semibold text-[#3B3B38]">Inclusions &amp; Exclusions</span>
            <textarea
              rows={2}
              placeholder="e.g. Includes drywall stock, hang, tape, texture. Excludes scaffolds over 14ft."
              value={inclusionsExclusions}
              onChange={(e) => setInclusionsExclusions(e.target.value)}
              className="w-full border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
            />
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display font-bold text-[#111111]">Sub-Line Items</span>
              <button
                type="button"
                onClick={() =>
                  setDraftItems((prev) => [
                    ...prev,
                    { subLineName: '', unit: 'SF', unitPriceDollars: '' },
                  ])
                }
                className="min-h-[44px] sm:min-h-[32px] px-3 py-1 rounded border border-[#E3E3DE] bg-[#F4F4F1] text-xs font-semibold text-[#111111] cursor-pointer"
              >
                + Add Line
              </button>
            </div>
            {draftItems.map((row, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                <input
                  type="text"
                  required
                  placeholder="Sub-line name (e.g. Hang & Tape 1/2 in)"
                  value={row.subLineName}
                  onChange={(e) => updateDraftItem(idx, 'subLineName', e.target.value)}
                  className="sm:col-span-6 min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
                />
                <input
                  type="text"
                  required
                  placeholder="Unit (SF/LF/EA/LS)"
                  value={row.unit}
                  onChange={(e) => updateDraftItem(idx, 'unit', e.target.value)}
                  className="sm:col-span-2 min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  placeholder="Unit $ (USD)"
                  value={row.unitPriceDollars}
                  onChange={(e) => updateDraftItem(idx, 'unitPriceDollars', e.target.value)}
                  className="sm:col-span-3 min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 tabular-nums"
                />
                {draftItems.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setDraftItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="sm:col-span-1 min-h-[44px] sm:min-h-[38px] px-2 rounded border border-[#FECACA] bg-[#FEF2F2] text-[#991B1B] font-semibold cursor-pointer"
                  >
                    Remove
                  </button>
                ) : (
                  <span className="hidden sm:block sm:col-span-1" />
                )}
              </div>
            ))}
          </div>

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
              {submitting ? 'Creating…' : 'Save Price Sheet'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="space-y-4">
        {loading ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-6 text-xs text-[#5F5F5A] text-center">
            Loading price sheets…
          </div>
        ) : sheets.length === 0 ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-6 text-xs text-[#5F5F5A] text-center space-y-2">
            <div>No effective-dated price sheets recorded yet.</div>
            {canCreate && !showForm ? (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="min-h-[44px] sm:min-h-[36px] px-4 py-2 rounded-md bg-[#111111] text-white font-display font-semibold cursor-pointer"
              >
                + Create First Price Sheet
              </button>
            ) : null}
          </div>
        ) : (
          sheets.map((ps) => (
            <div key={ps.id} className="bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E3E3DE] flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#F4F4F1]/60">
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm text-[#111111] break-words">
                    {ps.subName} · <span className="font-mono">{ps.costCode}</span> {ps.costCodeName}
                  </div>
                  {ps.inclusionsExclusions ? (
                    <div className="text-xs text-[#5F5F5A] mt-0.5 break-words">
                      {ps.inclusionsExclusions}
                    </div>
                  ) : null}
                </div>
                <div className="text-xs text-[#3B3B38] tabular-nums shrink-0">
                  Effective {ps.effectiveFrom}
                  {ps.effectiveTo ? ` – ${ps.effectiveTo}` : ''} · Scope: {ps.subdivisionScope}
                </div>
              </div>

              {/* Mobile Sub-Line Cards */}
              <div className="md:hidden divide-y divide-[#E3E3DE]">
                {ps.items.map((item) => (
                  <div
                    key={item.id}
                    className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#111111] break-words">
                        {item.subLineName}
                      </div>
                      <div className="text-[11px] text-[#5F5F5A] mt-0.5">Unit: {item.unit}</div>
                    </div>
                    <div className="text-right tabular-nums font-bold text-[#111111] shrink-0">
                      {formatCurrencyExact(item.unitPriceCents)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Sub-Line Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E3E3DE] text-[10px] font-display uppercase text-[#5F5F5A]">
                      <th className="py-2 px-4">Sub-Line Item</th>
                      <th className="py-2 px-3">Unit</th>
                      <th className="py-2 px-4 text-right">Unit Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E3DE]">
                    {ps.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2 px-4 font-medium">{item.subLineName}</td>
                        <td className="py-2 px-3 text-[#5F5F5A]">{item.unit}</td>
                        <td className="py-2 px-4 text-right tabular-nums font-semibold">
                          {formatCurrencyExact(item.unitPriceCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
