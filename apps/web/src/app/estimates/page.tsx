'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Printer } from 'lucide-react';
import { apiFetch, formatCurrencyExact } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';
import { InterstateLogo } from '@/components/InterstateLogo';

interface EstimateLine {
  costCode: string;
  costCodeName: string;
  classificationCode: string;
  classificationName: string;
  quantity: number;
  unit: string;
  quantitySource: string;
  pricingSource: string;
  selectedSubId: string | null;
  selectedSubName: string | null;
  unitPriceCents: number;
  extendedCents: number;
  competingSubQuotes: Array<{
    subId: string;
    subName: string;
    totalCents: number;
    isPreferred: boolean;
  }>;
}

interface EstimatePayload {
  home: { id: string; homeCode: string; subdivisionName: string; planName: string };
  estimate: {
    id: string;
    versionNumber: number;
    status: string;
    totalEstimatedCents: number;
    lines: EstimateLine[];
  };
}

interface HomeownerProjection {
  homeCode: string;
  planName: string;
  subdivisionName: string;
  grandTotalCents: number;
  classifications: Array<{
    classificationCode: string;
    classificationName: string;
    totalCents: number;
    lines: Array<{ costCode: string; costCodeName: string; extendedCents: number }>;
  }>;
}

const DEFAULT_HOME_OPTIONS = [
  { id: 'home-ch-14', label: 'CH 14 — Zion 2450' },
  { id: 'home-lk-22', label: 'LK 22 — Coral 2120' },
  { id: 'home-ns-08', label: 'NS 08 — Copper View 3180' },
  { id: 'home-ps-11', label: 'PS 11 — Willow 1890' },
];

function isLineActive(line: EstimateLine): boolean {
  return (
    line.extendedCents > 0 ||
    line.quantity > 0 ||
    line.competingSubQuotes.length > 0 ||
    Boolean(line.selectedSubId)
  );
}

export default function EstimatesPage() {
  const { role, subCompanyId } = useRole();
  const [homeId, setHomeId] = useState('home-ch-14');
  const [data, setData] = useState<EstimatePayload | null>(null);
  const [homeownerPreview, setHomeownerPreview] = useState<HomeownerProjection | null>(null);
  const [showHomeownerPdf, setShowHomeownerPdf] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedClassification, setSelectedClassification] = useState<string>('all');
  const [collapsedCodes, setCollapsedCodes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      setActiveOnly(true);
    }
    const params = new URLSearchParams(window.location.search);
    const paramHomeId = params.get('homeId');
    if (paramHomeId) {
      setHomeId(paramHomeId);
    }
  }, []);

  usePageContext({
    section: 'Estimates',
    entityType: 'home',
    entityId: homeId,
    entityLabel: data ? `${data.home.homeCode} (v${data.estimate.versionNumber})` : homeId,
    summary: {
      homeCode: data?.home.homeCode ?? null,
      estimateStatus: data?.estimate.status ?? null,
      estimateVersion: data?.estimate.versionNumber ?? null,
      lineCount: data?.estimate.lines.length ?? 0,
      showHomeownerPdf,
    },
  });

  const loadEstimate = (targetHomeId: string) => {
    apiFetch<EstimatePayload>(`/api/homes/${targetHomeId}/estimate`, { role, subCompanyId })
      .then(setData)
      .catch(() => {});
  };

  useEffect(() => {
    loadEstimate(homeId);
  }, [homeId, role, subCompanyId]);

  const handleToggleHomeownerPdf = async () => {
    if (!showHomeownerPdf) {
      const res = await apiFetch<{ projection: HomeownerProjection }>(
        `/api/homes/${homeId}/estimate/homeowner`,
        { role, subCompanyId }
      );
      setHomeownerPreview(res.projection);
    }
    setShowHomeownerPdf((v) => !v);
  };

  const handleSelectCompetingSub = async (costCode: string, subId: string, totalCents: number) => {
    await apiFetch(`/api/estimates/${homeId}/lines/${costCode}`, {
      method: 'PATCH',
      role,
      subCompanyId,
      body: JSON.stringify({
        selectedSubId: subId,
        fixedAmountCents: totalCents,
      }),
    });
    loadEstimate(homeId);
  };

  const classificationGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        lines: EstimateLine[];
        activeCount: number;
        subtotalCents: number;
      }
    >();
    for (const line of data?.estimate.lines ?? []) {
      const existing = map.get(line.classificationCode) ?? {
        code: line.classificationCode,
        name: line.classificationName,
        lines: [],
        activeCount: 0,
        subtotalCents: 0,
      };
      existing.lines.push(line);
      if (isLineActive(line)) existing.activeCount += 1;
      existing.subtotalCents += line.extendedCents;
      map.set(line.classificationCode, existing);
    }
    return Array.from(map.values());
  }, [data]);

  const totalLineCount = data?.estimate.lines.length ?? 0;
  const totalActiveCount = useMemo(
    () => (data?.estimate.lines ?? []).filter(isLineActive).length,
    [data]
  );

  const visibleGroups = useMemo(() => {
    return classificationGroups
      .filter((cls) => selectedClassification === 'all' || cls.code === selectedClassification)
      .map((cls) => ({
        ...cls,
        visibleLines: activeOnly ? cls.lines.filter(isLineActive) : cls.lines,
      }))
      .filter((cls) => {
        if (selectedClassification !== 'all') return true;
        return !activeOnly || cls.visibleLines.length > 0;
      });
  }, [classificationGroups, selectedClassification, activeOnly]);

  const toggleClassification = (code: string) => {
    setCollapsedCodes((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const handleClassificationFilterChange = (value: string) => {
    setSelectedClassification(value);
    if (value !== 'all') {
      setCollapsedCodes((prev) => ({ ...prev, [value]: false }));
    }
  };

  const allExpanded = visibleGroups.every((g) => !collapsedCodes[g.code]);
  const handleToggleExpandAll = () => {
    const next: Record<string, boolean> = { ...collapsedCodes };
    for (const g of visibleGroups) {
      next[g.code] = allExpanded;
    }
    setCollapsedCodes(next);
  };

  const homeOptions = useMemo(() => {
    if (
      data?.home &&
      !DEFAULT_HOME_OPTIONS.some((opt) => opt.id === data.home.id)
    ) {
      return [
        { id: data.home.id, label: `${data.home.homeCode} — ${data.home.planName}` },
        ...DEFAULT_HOME_OPTIONS,
      ];
    }
    return DEFAULT_HOME_OPTIONS;
  }, [data]);

  return (
    <div className="space-y-5">
      <div
        data-print-hide="true"
        className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4"
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-[#111111]">
            81-Code Estimate Builder
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.2 &amp; Section 7 — Side-by-side sub pricing, fixed/allowance entries, and
            Internal vs. Homeowner PDF output.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row w-full sm:w-auto items-stretch sm:items-center gap-2.5">
          <select
            aria-label="Select home estimate"
            value={homeId}
            onChange={(e) => {
              setHomeId(e.target.value);
              setShowHomeownerPdf(false);
              setSelectedClassification('all');
            }}
            className="w-full sm:w-auto min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-xs font-semibold text-[#111111]"
          >
            {homeOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
          {(role === 'admin' || role === 'estimator_approver') && (
            <button
              type="button"
              onClick={handleToggleHomeownerPdf}
              className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white transition-colors"
            >
              {showHomeownerPdf ? 'Back to Internal Builder' : 'Preview Homeowner Estimate PDF'}
            </button>
          )}
        </div>
      </div>

      {showHomeownerPdf && homeownerPreview ? (
        <div className="max-w-4xl mx-auto space-y-3">
          <div
            data-print-hide="true"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white border border-[#E3E3DE] rounded-lg px-4 py-3"
          >
            <span className="text-xs text-[#5F5F5A]">
              Homeowner-safe projection ready for print or PDF export.
            </span>
            <button
              type="button"
              data-print-hide="true"
              onClick={() => window.print()}
              className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-bold hover:bg-[#FCAE1A] hover:text-[#111111] transition-colors"
            >
              <Printer className="w-4 h-4 shrink-0" aria-hidden="true" />
              Print / Save PDF
            </button>
          </div>

          <div className="bg-white border border-[#E3E3DE] rounded-lg p-4 sm:p-8 shadow-sm space-y-5 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#E3E3DE] pb-5">
              <div className="min-w-0">
                <InterstateLogo variant="light" />
                <div className="text-xs text-[#5F5F5A] mt-2 break-words">
                  52 S 850 W, Suite 202A, Hurricane, UT 84737 · 435-635-2944 · myinterstatehome.com
                </div>
              </div>
              <div className="sm:text-right">
                <div className="text-xs font-display uppercase tracking-wider text-[#8A5A00] font-bold">
                  Homeowner Estimate
                </div>
                <div className="text-lg font-display font-bold text-[#111111] mt-0.5">
                  {homeownerPreview.homeCode} — {homeownerPreview.planName}
                </div>
                <div className="text-xs text-[#5F5F5A]">{homeownerPreview.subdivisionName}</div>
              </div>
            </div>

            <div className="bg-[#F4F4F1] rounded px-3.5 sm:px-4 py-2.5 text-xs text-[#3B3B38]">
              Rule 10 Verified: Vendor names, unit costs, land (00L), real estate fees (88), fixed
              overhead (92), profit (93), and margin are stripped from this view.
            </div>

            <div className="space-y-4">
              {homeownerPreview.classifications.map((cls) => (
                <div key={cls.classificationCode} className="border border-[#E3E3DE] rounded-md overflow-hidden">
                  <div className="flex items-center justify-between gap-3 bg-[#F4F4F1] px-3.5 sm:px-4 py-2 text-xs font-display font-bold text-[#111111]">
                    <span className="min-w-0">
                      {cls.classificationCode} {cls.classificationName}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatCurrencyExact(cls.totalCents)}</span>
                  </div>
                  <div className="divide-y divide-[#E3E3DE]">
                    {cls.lines.map((l) => (
                      <div
                        key={l.costCode}
                        className="flex items-start justify-between gap-3 px-3.5 sm:px-4 py-2 text-xs"
                      >
                        <span className="min-w-0 text-[#111111]">
                          <span className="font-mono text-[#5F5F5A] mr-2">{l.costCode}</span>
                          {l.costCodeName}
                        </span>
                        <span className="shrink-0 tabular-nums font-medium text-[#111111]">
                          {formatCurrencyExact(l.extendedCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-baseline justify-between gap-4 border-t-2 border-[#111111] pt-4 text-sm sm:text-base font-display font-bold text-[#111111]">
              <span>Estimated Construction Total</span>
              <span className="shrink-0 tabular-nums">
                {formatCurrencyExact(homeownerPreview.grandTotalCents)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Estimate Summary & Filter Bar */}
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-3.5 sm:px-4 sm:py-3 space-y-3">
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2">
              <div className="text-xs text-[#3B3B38]">
                <strong className="text-[#111111]">{data?.home.homeCode}</strong> ·{' '}
                {data?.home.subdivisionName} · {data?.home.planName} · Estimate v
                {data?.estimate.versionNumber} ({data?.estimate.status})
              </div>
              <div className="text-sm font-display font-bold text-[#111111] tabular-nums">
                Total Estimate: {formatCurrencyExact(data?.estimate.totalEstimatedCents)}
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pt-2.5 border-t border-[#E3E3DE]">
              {/* Active lines only / Show all 81 codes toggle */}
              <div
                role="group"
                aria-label="Estimate line visibility"
                className="grid grid-cols-2 sm:inline-flex rounded-md border border-[#E3E3DE] bg-[#F4F4F1] p-0.5 gap-0.5"
              >
                <button
                  type="button"
                  onClick={() => setActiveOnly(true)}
                  className={`min-h-[44px] sm:min-h-[38px] px-3 py-1.5 rounded text-xs font-display font-semibold transition-colors ${
                    activeOnly
                      ? 'bg-[#111111] text-white'
                      : 'text-[#3B3B38] hover:text-[#111111]'
                  }`}
                >
                  Active lines ({totalActiveCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveOnly(false)}
                  className={`min-h-[44px] sm:min-h-[38px] px-3 py-1.5 rounded text-xs font-display font-semibold transition-colors ${
                    !activeOnly
                      ? 'bg-[#111111] text-white'
                      : 'text-[#3B3B38] hover:text-[#111111]'
                  }`}
                >
                  Show all {totalLineCount || 81} codes
                </button>
              </div>

              {/* Classification filter/jump + expand/collapse */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <select
                  aria-label="Filter or jump to classification"
                  value={selectedClassification}
                  onChange={(e) => handleClassificationFilterChange(e.target.value)}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-xs font-medium text-[#111111]"
                >
                  <option value="all">
                    All classifications ({classificationGroups.length})
                  </option>
                  {classificationGroups.map((cls) => (
                    <option key={cls.code} value={cls.code}>
                      {cls.code} {cls.name} ({cls.activeCount}/{cls.lines.length} active)
                    </option>
                  ))}
                </select>
                {visibleGroups.length > 1 ? (
                  <button
                    type="button"
                    onClick={handleToggleExpandAll}
                    className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-3 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111] transition-colors whitespace-nowrap"
                  >
                    {allExpanded ? 'Collapse all' : 'Expand all'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {visibleGroups.map((cls) => {
            const isCollapsed = Boolean(collapsedCodes[cls.code]);
            return (
              <div
                key={cls.code}
                className="bg-white border border-[#E3E3DE] rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleClassification(cls.code)}
                  className="bg-[#111111] text-white px-3.5 sm:px-4 py-2.5 min-h-[44px] w-full flex items-center justify-between gap-3 text-left hover:bg-[#1E1E1C] transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 shrink-0 text-[#FCAE1A]" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-4 h-4 shrink-0 text-[#FCAE1A]" aria-hidden="true" />
                    )}
                    <span className="text-xs font-display font-bold tracking-wide truncate">
                      {cls.code} {cls.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-[#F4F4F1] tabular-nums">
                      {cls.activeCount} active
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[#FCAE1A] font-semibold">
                    {formatCurrencyExact(cls.subtotalCents)}
                  </span>
                </button>

                {!isCollapsed ? (
                  cls.visibleLines.length === 0 ? (
                    <div className="px-4 py-5 text-xs text-[#5F5F5A] flex flex-wrap items-center justify-between gap-2">
                      <span>No active lines in this classification.</span>
                      {activeOnly ? (
                        <button
                          type="button"
                          onClick={() => setActiveOnly(false)}
                          className="text-[#8A5A00] font-semibold underline"
                        >
                          Show all {totalLineCount || 81} codes
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      {/* Mobile Stacked Line Cards (<md) */}
                      <div className="md:hidden divide-y divide-[#E3E3DE]">
                        {cls.visibleLines.map((line) => (
                          <div key={line.costCode} className="p-3.5 space-y-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1 text-xs">
                                <span className="font-mono font-bold text-[#111111] mr-1.5">
                                  {line.costCode}
                                </span>
                                <span className="font-semibold text-[#111111] break-words">
                                  {line.costCodeName}
                                </span>
                              </div>
                              <div className="shrink-0 text-xs font-display font-bold tabular-nums text-[#111111]">
                                {formatCurrencyExact(line.extendedCents)}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className="px-2 py-0.5 rounded bg-[#F4F4F1] text-[#3B3B38] text-[10px] font-semibold uppercase">
                                  {line.pricingSource}
                                </span>
                                <span className="tabular-nums text-[#3B3B38]">
                                  {line.quantity.toLocaleString()} {line.unit}
                                </span>
                              </div>
                              {line.competingSubQuotes.length <= 1 ? (
                                <span className="text-[#5F5F5A] truncate max-w-full">
                                  {line.selectedSubName ??
                                    (line.pricingSource === 'fixed' ? 'Hand-entered fixed' : '—')}
                                </span>
                              ) : null}
                            </div>

                            {line.competingSubQuotes.length > 1 ? (
                              <div className="flex flex-col gap-2 pt-1">
                                <div className="text-[10px] font-display uppercase tracking-wider text-[#5F5F5A]">
                                  Select competing sub quote
                                </div>
                                {line.competingSubQuotes.map((q) => {
                                  const selected = line.selectedSubId === q.subId;
                                  return (
                                    <button
                                      key={q.subId}
                                      type="button"
                                      onClick={() =>
                                        handleSelectCompetingSub(
                                          line.costCode,
                                          q.subId,
                                          q.totalCents
                                        )
                                      }
                                      className={`w-full min-h-[44px] flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-xs text-left transition-colors ${
                                        selected
                                          ? 'bg-[#111111] text-white border-[#111111] font-semibold'
                                          : 'bg-white text-[#111111] border-[#E3E3DE] hover:border-[#FCAE1A]'
                                      }`}
                                    >
                                      <span className="min-w-0 truncate">{q.subName}</span>
                                      <span
                                        className={`shrink-0 tabular-nums font-semibold ${
                                          selected ? 'text-[#FCAE1A]' : 'text-[#111111]'
                                        }`}
                                      >
                                        {formatCurrencyExact(q.totalCents)}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      {/* Desktop 6-Column Table (md+) */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1] text-[10px] font-display uppercase text-[#5F5F5A]">
                              <th className="py-2 px-3 w-16">Code</th>
                              <th className="py-2 px-3">Line Item</th>
                              <th className="py-2 px-3">Source</th>
                              <th className="py-2 px-3">Selected Sub / Side-by-Side</th>
                              <th className="py-2 px-3 text-right">Qty / Unit</th>
                              <th className="py-2 px-3 text-right">Extended</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E3E3DE]">
                            {cls.visibleLines.map((line) => (
                              <tr key={line.costCode} className="hover:bg-[#F4F4F1]/40">
                                <td className="py-2 px-3 font-mono font-semibold text-[#111111]">
                                  {line.costCode}
                                </td>
                                <td className="py-2 px-3 font-medium text-[#111111]">
                                  {line.costCodeName}
                                </td>
                                <td className="py-2 px-3">
                                  <span className="px-2 py-0.5 rounded bg-[#F4F4F1] text-[#3B3B38] text-[10px] font-semibold uppercase">
                                    {line.pricingSource}
                                  </span>
                                </td>
                                <td className="py-2 px-3">
                                  {line.competingSubQuotes.length > 1 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {line.competingSubQuotes.map((q) => (
                                        <button
                                          key={q.subId}
                                          type="button"
                                          onClick={() =>
                                            handleSelectCompetingSub(
                                              line.costCode,
                                              q.subId,
                                              q.totalCents
                                            )
                                          }
                                          className={`px-2.5 py-1 rounded border text-[11px] transition-colors ${
                                            line.selectedSubId === q.subId
                                              ? 'bg-[#111111] text-white border-[#111111]'
                                              : 'bg-white border-[#E3E3DE] hover:border-[#FCAE1A]'
                                          }`}
                                        >
                                          {q.subName} ({formatCurrencyExact(q.totalCents)})
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[#5F5F5A]">
                                      {line.selectedSubName ??
                                        (line.pricingSource === 'fixed'
                                          ? 'Hand-entered fixed'
                                          : '—')}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums text-[#3B3B38] whitespace-nowrap">
                                  {line.quantity.toLocaleString()} {line.unit}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums font-semibold text-[#111111] whitespace-nowrap">
                                  {formatCurrencyExact(line.extendedCents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )
                ) : null}
              </div>
            );
          })}

          {data && visibleGroups.length === 0 ? (
            <div className="bg-white border border-[#E3E3DE] rounded-lg px-4 py-8 text-center text-xs text-[#5F5F5A] space-y-2">
              <div>No active estimate lines match the current filter.</div>
              <button
                type="button"
                onClick={() => {
                  setActiveOnly(false);
                  setSelectedClassification('all');
                }}
                className="min-h-[44px] inline-flex items-center justify-center px-4 py-2 rounded-md border border-[#111111] text-[#111111] font-display font-semibold"
              >
                Show all {totalLineCount || 81} codes
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
