'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Pencil, Printer, X } from 'lucide-react';
import { canAccess, type PricingSource } from '@interstate/shared';
import { apiFetch, formatCurrencyExact } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';
import { InterstateLogo } from '@/components/InterstateLogo';

interface HomeSummary {
  id: string;
  homeCode: string;
  subdivisionName: string;
  planName: string;
}

interface EstimateLine {
  costCode: string;
  costCodeName: string;
  classificationCode: string;
  classificationName: string;
  quantity: number;
  unit: string;
  quantitySource: string;
  pricingSource: PricingSource;
  selectedSubId: string | null;
  selectedSubName: string | null;
  unitPriceCents: number;
  extendedCents: number;
  isAllowanceOrFixed?: boolean;
  notes?: string;
  competingSubQuotes: Array<{
    subId: string;
    subName: string;
    totalCents: number;
    isPreferred: boolean;
  }>;
}

interface EstimatePayload {
  home: HomeSummary;
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

interface EditLineDraft {
  costCode: string;
  costCodeName: string;
  quantity: string;
  unit: string;
  pricingSource: PricingSource;
  unitPriceDollars: string;
  fixedAmountDollars: string;
  notes: string;
}

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
  const isSubcontractor = role === 'subcontractor';
  const canBuild = canAccess(role, 'estimates:build');
  const canExportHomeowner = canAccess(role, 'estimates:export_homeowner');
  const canIntake = canAccess(role, 'plans:intake');

  const [homes, setHomes] = useState<HomeSummary[]>([]);
  const [loadingHomes, setLoadingHomes] = useState(!isSubcontractor);
  const [homesError, setHomesError] = useState<string | null>(null);
  const [homeId, setHomeId] = useState('');
  const [data, setData] = useState<EstimatePayload | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [busyCostCode, setBusyCostCode] = useState<string | null>(null);
  const [homeownerPreview, setHomeownerPreview] = useState<HomeownerProjection | null>(null);
  const [showHomeownerPdf, setShowHomeownerPdf] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedClassification, setSelectedClassification] = useState<string>('all');
  const [collapsedCodes, setCollapsedCodes] = useState<Record<string, boolean>>({});

  // Line editor modal state
  const [editDraft, setEditDraft] = useState<EditLineDraft | null>(null);
  const [savingLine, setSavingLine] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      setActiveOnly(true);
    }
  }, []);

  const fetchHomes = useCallback(
    async (isCancelled?: () => boolean) => {
      if (isSubcontractor) {
        setHomes([]);
        setHomeId('');
        setLoadingHomes(false);
        setHomesError(null);
        return;
      }
      setLoadingHomes(true);
      setHomesError(null);
      try {
        const res = await apiFetch<{ homes: HomeSummary[] }>('/api/homes', {
          role,
          subCompanyId,
        });
        if (isCancelled?.()) return;
        const list = res.homes ?? [];
        setHomes(list);

        const paramHomeId =
          typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('homeId')
            : null;

        setHomeId((current) => {
          if (current && list.some((h) => h.id === current)) return current;
          if (paramHomeId && list.some((h) => h.id === paramHomeId)) return paramHomeId;
          return list[0]?.id ?? '';
        });
      } catch (err: unknown) {
        if (isCancelled?.()) return;
        setHomes([]);
        setHomeId('');
        setHomesError(err instanceof Error ? err.message : 'Failed to load homes');
      } finally {
        if (!isCancelled?.()) setLoadingHomes(false);
      }
    },
    [isSubcontractor, role, subCompanyId]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchHomes(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [fetchHomes]);

  usePageContext({
    section: 'Estimates',
    entityType: homeId ? 'home' : 'workspace',
    entityId: homeId || undefined,
    entityLabel: isSubcontractor
      ? 'Restricted'
      : data
        ? `${data.home.homeCode} (v${data.estimate.versionNumber})`
        : homes.length === 0
          ? 'No Homes'
          : homeId,
    summary: {
      homeCode: data?.home.homeCode ?? null,
      estimateStatus: data?.estimate.status ?? null,
      estimateVersion: data?.estimate.versionNumber ?? null,
      lineCount: data?.estimate.lines.length ?? 0,
      showHomeownerPdf,
    },
  });

  const loadEstimate = useCallback(
    async (targetHomeId: string, isCancelled?: () => boolean) => {
      if (isSubcontractor || !targetHomeId) {
        setData(null);
        setEstimateError(null);
        setLoadingEstimate(false);
        return;
      }
      setLoadingEstimate(true);
      setEstimateError(null);
      try {
        const payload = await apiFetch<EstimatePayload>(`/api/homes/${targetHomeId}/estimate`, {
          role,
          subCompanyId,
        });
        if (isCancelled?.()) return;
        setData(payload);
      } catch (err: unknown) {
        if (isCancelled?.()) return;
        setData(null);
        setEstimateError(err instanceof Error ? err.message : 'Failed to load estimate');
      } finally {
        if (!isCancelled?.()) setLoadingEstimate(false);
      }
    },
    [isSubcontractor, role, subCompanyId]
  );

  useEffect(() => {
    if (isSubcontractor || !homeId) {
      setData(null);
      setHomeownerPreview(null);
      setShowHomeownerPdf(false);
      setEstimateError(null);
      setLoadingEstimate(false);
      return;
    }

    let cancelled = false;
    setData(null);
    setHomeownerPreview(null);
    setShowHomeownerPdf(false);
    void loadEstimate(homeId, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [homeId, isSubcontractor, loadEstimate]);

  const handleToggleHomeownerPdf = async () => {
    if (!homeId || !canExportHomeowner) return;
    setActionBanner(null);
    if (!showHomeownerPdf) {
      try {
        const res = await apiFetch<{ projection: HomeownerProjection }>(
          `/api/homes/${homeId}/estimate/homeowner`,
          { role, subCompanyId }
        );
        setHomeownerPreview(res.projection);
        setShowHomeownerPdf(true);
      } catch (err: unknown) {
        setActionBanner({
          type: 'err',
          text:
            err instanceof Error ? err.message : 'Failed to load homeowner estimate preview.',
        });
      }
      return;
    }
    setShowHomeownerPdf(false);
  };

  const handleSelectCompetingSub = async (
    costCode: string,
    subId: string,
    subName: string,
    totalCents: number
  ) => {
    if (!homeId || !canBuild) return;
    setBusyCostCode(costCode);
    setActionBanner(null);
    try {
      await apiFetch(`/api/estimates/${homeId}/lines/${costCode}`, {
        method: 'PATCH',
        role,
        subCompanyId,
        body: JSON.stringify({
          selectedSubId: subId,
          fixedAmountCents: totalCents,
        }),
      });
      setActionBanner({
        type: 'ok',
        text: `Updated code ${costCode} to ${subName} (${formatCurrencyExact(totalCents)}).`,
      });
      await loadEstimate(homeId);
    } catch (err: unknown) {
      setActionBanner({
        type: 'err',
        text: err instanceof Error ? err.message : `Failed to update cost code ${costCode}.`,
      });
    } finally {
      setBusyCostCode(null);
    }
  };

  const openEditLine = (line: EstimateLine) => {
    if (!canBuild) return;
    const isFixedMode =
      line.isAllowanceOrFixed ||
      line.pricingSource === 'fixed' ||
      line.pricingSource === 'allowance';
    setEditError(null);
    setEditDraft({
      costCode: line.costCode,
      costCodeName: line.costCodeName,
      quantity: String(line.quantity),
      unit: line.unit || 'LS',
      pricingSource: line.pricingSource,
      unitPriceDollars: (line.unitPriceCents / 100).toFixed(2),
      fixedAmountDollars: isFixedMode ? (line.extendedCents / 100).toFixed(2) : '',
      notes: line.notes ?? '',
    });
  };

  const handleSaveEditLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDraft || !homeId || !canBuild) return;

    const quantityNum = Number(editDraft.quantity);
    const unitPriceNum = Number(editDraft.unitPriceDollars);
    const hasFixed = editDraft.fixedAmountDollars.trim() !== '';
    const fixedNum = hasFixed ? Number(editDraft.fixedAmountDollars) : NaN;

    if (!Number.isFinite(quantityNum) || quantityNum < 0) {
      setEditError('Quantity must be a non-negative number.');
      return;
    }
    if (!hasFixed && (!Number.isFinite(unitPriceNum) || unitPriceNum < 0)) {
      setEditError('Unit price must be a non-negative dollar amount.');
      return;
    }
    if (hasFixed && (!Number.isFinite(fixedNum) || fixedNum < 0)) {
      setEditError('Fixed / allowance amount must be a non-negative dollar amount.');
      return;
    }

    setSavingLine(true);
    setEditError(null);
    setActionBanner(null);

    try {
      const payload: Record<string, unknown> = {
        unit: editDraft.unit.trim() || 'LS',
        pricingSource: editDraft.pricingSource,
        notes: editDraft.notes,
        isAllowanceOrFixed:
          editDraft.pricingSource === 'fixed' ||
          editDraft.pricingSource === 'allowance' ||
          hasFixed,
      };

      if (hasFixed) {
        payload.fixedAmountCents = Math.round(fixedNum * 100);
      } else {
        payload.quantity = quantityNum;
        payload.unitPriceCents = Math.round(unitPriceNum * 100);
      }

      await apiFetch(`/api/estimates/${homeId}/lines/${editDraft.costCode}`, {
        method: 'PATCH',
        role,
        subCompanyId,
        body: JSON.stringify(payload),
      });

      setActionBanner({
        type: 'ok',
        text: `Saved estimate line ${editDraft.costCode} ${editDraft.costCodeName}.`,
      });
      setEditDraft(null);
      await loadEstimate(homeId);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : 'Failed to save estimate line.');
    } finally {
      setSavingLine(false);
    }
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

  if (isSubcontractor) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-display font-bold text-[#111111]">
            81-Code Estimate Builder
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Internal Interstate Homes estimating workspace.
          </p>
        </div>
        <div className="bg-white border border-[#E3E3DE] rounded-lg px-5 py-8 text-center space-y-4">
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-base font-display font-bold text-[#111111]">
              Access Restricted to Internal Team
            </h2>
            <p className="text-xs text-[#5F5F5A]">
              Full home estimates and internal margin schedules are not available in the
              Subcontractor Portal. Review and respond to your assigned scopes in My Quotes or
              Purchase Orders.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5">
            <Link
              href="/quotes"
              className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white transition-colors"
            >
              Go to My Quotes
            </Link>
            <Link
              href="/purchase-orders"
              className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center px-5 py-2.5 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111] transition-colors"
            >
              View Purchase Orders
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
        {homes.length > 0 ? (
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
              {homes.map((home) => (
                <option key={home.id} value={home.id}>
                  {home.homeCode} — {home.planName}
                </option>
              ))}
            </select>
            {canExportHomeowner && homeId ? (
              <button
                type="button"
                onClick={handleToggleHomeownerPdf}
                disabled={loadingEstimate || !data}
                className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white disabled:opacity-50 transition-colors"
              >
                {showHomeownerPdf ? 'Back to Internal Builder' : 'Preview Homeowner Estimate PDF'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!canBuild ? (
        <div
          data-print-hide="true"
          className="bg-[#F4F4F1] border border-[#E3E3DE] text-[#3B3B38] px-4 py-2.5 rounded-lg text-xs"
        >
          Read-only field view — internal margin codes (00L, 88, 92, 93) are hidden and estimate
          editing is limited to Estimators and Admins.
        </div>
      ) : null}

      {actionBanner ? (
        <div
          role="status"
          data-print-hide="true"
          className={`rounded-lg px-4 py-3 text-xs border break-words ${
            actionBanner.type === 'err'
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
              : 'bg-[#DCFCE7] border-[#BBF7D0] text-[#166534]'
          }`}
        >
          {actionBanner.text}
        </div>
      ) : null}

      {homesError ? (
        <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-4 py-3 rounded-lg text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 break-words">Unable to load homes: {homesError}</div>
          <button
            type="button"
            onClick={() => void fetchHomes()}
            className="w-full sm:w-auto shrink-0 min-h-[44px] px-4 py-2 rounded-md border border-[#991B1B] bg-white text-xs font-display font-semibold text-[#991B1B] hover:bg-[#991B1B] hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loadingHomes ? (
        <div className="bg-white border border-[#E3E3DE] rounded-lg px-5 py-10 text-center space-y-2">
          <div className="text-sm font-display font-semibold text-[#111111]">
            Loading homes…
          </div>
          <p className="text-xs text-[#5F5F5A]">
            Fetching active homes and 81-code estimate schedules.
          </p>
        </div>
      ) : homes.length === 0 ? (
        <div className="bg-white border border-[#E3E3DE] rounded-lg px-5 py-10 text-center space-y-4">
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-base font-display font-bold text-[#111111]">
              No homes ready for estimating yet
            </h2>
            <p className="text-xs text-[#5F5F5A]">
              {canIntake
                ? 'Create a home in Plan Intake to initialize all 81 estimate cost codes and begin building quotes and subcontractor comparisons.'
                : 'Homes will appear here once an Estimator or Admin completes Plan Intake.'}
            </p>
          </div>
          {canIntake ? (
            <div className="flex justify-center">
              <Link
                href="/homes?intake=1"
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white transition-colors"
              >
                + New Plan Intake
              </Link>
            </div>
          ) : null}
        </div>
      ) : estimateError ? (
        <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-4 py-4 rounded-lg text-xs space-y-3">
          <div>Unable to load estimate for the selected home: {estimateError}</div>
          <button
            type="button"
            onClick={() => void loadEstimate(homeId)}
            className="min-h-[44px] inline-flex items-center justify-center px-4 py-2 rounded-md border border-[#991B1B] bg-white text-[#991B1B] font-display font-semibold hover:bg-[#991B1B] hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : loadingEstimate || !data ? (
        <div className="bg-white border border-[#E3E3DE] rounded-lg px-5 py-10 text-center space-y-2">
          <div className="text-sm font-display font-semibold text-[#111111]">
            Loading estimate…
          </div>
          <p className="text-xs text-[#5F5F5A]">
            Fetching 81-code line items and competing subcontractor quotes.
          </p>
        </div>
      ) : showHomeownerPdf && homeownerPreview ? (
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
                <strong className="text-[#111111]">{data.home.homeCode}</strong> ·{' '}
                {data.home.subdivisionName} · {data.home.planName} · Estimate v
                {data.estimate.versionNumber} ({data.estimate.status})
              </div>
              <div className="text-sm font-display font-bold text-[#111111] tabular-nums">
                Total Estimate: {formatCurrencyExact(data.estimate.totalEstimatedCents)}
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
                  className="bg-[#111111] text-white px-3.5 sm:px-4 py-2.5 min-h-[44px] w-full flex items-start sm:items-center justify-between gap-3 text-left hover:bg-[#1E1E1C] transition-colors"
                >
                  <span className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
                    {isCollapsed ? (
                      <ChevronRight
                        className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0 text-[#FCAE1A]"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronDown
                        className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0 text-[#FCAE1A]"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-display font-bold tracking-wide leading-snug break-words">
                        {cls.code} {cls.name}
                      </span>
                      <span className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/15 text-[#F4F4F1] tabular-nums">
                        {cls.activeCount} active
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[#FCAE1A] font-semibold pt-0.5 sm:pt-0">
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
                          <div key={line.costCode} className="p-3.5 space-y-2.5">
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

                            {line.notes ? (
                              <div className="text-[11px] text-[#5F5F5A] break-words">
                                Note: {line.notes}
                              </div>
                            ) : null}

                            {line.competingSubQuotes.length > 1 ? (
                              <div className="flex flex-col gap-2 pt-1">
                                <div className="text-[10px] font-display uppercase tracking-wider text-[#5F5F5A]">
                                  {canBuild ? 'Select competing sub quote' : 'Competing sub quotes'}
                                </div>
                                {line.competingSubQuotes.map((q) => {
                                  const selected = line.selectedSubId === q.subId;
                                  return canBuild ? (
                                    <button
                                      key={q.subId}
                                      type="button"
                                      disabled={busyCostCode === line.costCode}
                                      onClick={() =>
                                        void handleSelectCompetingSub(
                                          line.costCode,
                                          q.subId,
                                          q.subName,
                                          q.totalCents
                                        )
                                      }
                                      className={`w-full min-h-[44px] flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-xs text-left disabled:opacity-60 transition-colors ${
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
                                  ) : (
                                    <div
                                      key={q.subId}
                                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-xs ${
                                        selected
                                          ? 'bg-[#F4F4F1] text-[#111111] border-[#111111] font-semibold'
                                          : 'bg-white text-[#5F5F5A] border-[#E3E3DE]'
                                      }`}
                                    >
                                      <span className="min-w-0 truncate">{q.subName}</span>
                                      <span className="shrink-0 tabular-nums">
                                        {formatCurrencyExact(q.totalCents)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}

                            {canBuild ? (
                              <button
                                type="button"
                                onClick={() => openEditLine(line)}
                                className="w-full min-h-[44px] flex items-center justify-center gap-1.5 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111] active:bg-[#F4F4F1] transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                Edit Line
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      {/* Desktop Table (md+) */}
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
                              {canBuild ? <th className="py-2 px-3 text-right">Edit</th> : null}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E3E3DE]">
                            {cls.visibleLines.map((line) => (
                              <tr key={line.costCode} className="hover:bg-[#F4F4F1]/40">
                                <td className="py-2 px-3 font-mono font-semibold text-[#111111]">
                                  {line.costCode}
                                </td>
                                <td className="py-2 px-3 font-medium text-[#111111]">
                                  <div>{line.costCodeName}</div>
                                  {line.notes ? (
                                    <div className="text-[11px] font-normal text-[#5F5F5A]">
                                      {line.notes}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="py-2 px-3">
                                  <span className="px-2 py-0.5 rounded bg-[#F4F4F1] text-[#3B3B38] text-[10px] font-semibold uppercase">
                                    {line.pricingSource}
                                  </span>
                                </td>
                                <td className="py-2 px-3">
                                  {line.competingSubQuotes.length > 1 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {line.competingSubQuotes.map((q) => {
                                        const selected = line.selectedSubId === q.subId;
                                        return canBuild ? (
                                          <button
                                            key={q.subId}
                                            type="button"
                                            disabled={busyCostCode === line.costCode}
                                            onClick={() =>
                                              void handleSelectCompetingSub(
                                                line.costCode,
                                                q.subId,
                                                q.subName,
                                                q.totalCents
                                              )
                                            }
                                            className={`px-2.5 py-1 rounded border text-[11px] disabled:opacity-60 transition-colors ${
                                              selected
                                                ? 'bg-[#111111] text-white border-[#111111]'
                                                : 'bg-white border-[#E3E3DE] hover:border-[#FCAE1A]'
                                            }`}
                                          >
                                            {q.subName} ({formatCurrencyExact(q.totalCents)})
                                          </button>
                                        ) : (
                                          <span
                                            key={q.subId}
                                            className={`px-2.5 py-1 rounded border text-[11px] ${
                                              selected
                                                ? 'bg-[#F4F4F1] text-[#111111] border-[#111111] font-semibold'
                                                : 'bg-white text-[#5F5F5A] border-[#E3E3DE]'
                                            }`}
                                          >
                                            {q.subName} ({formatCurrencyExact(q.totalCents)})
                                          </span>
                                        );
                                      })}
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
                                {canBuild ? (
                                  <td className="py-2 px-3 text-right whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => openEditLine(line)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#E3E3DE] bg-white text-[11px] font-display font-semibold text-[#111111] hover:border-[#111111] transition-colors"
                                    >
                                      <Pencil className="w-3 h-3" aria-hidden="true" />
                                      Edit
                                    </button>
                                  </td>
                                ) : null}
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

          {visibleGroups.length === 0 ? (
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

      {/* Edit Estimate Line Modal */}
      {editDraft && canBuild ? (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-estimate-line-title"
        >
          <div className="bg-white w-full sm:max-w-lg sm:rounded-xl rounded-t-xl border border-[#E3E3DE] shadow-xl max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-[#E3E3DE] sticky top-0 bg-white">
              <div className="min-w-0">
                <h2
                  id="edit-estimate-line-title"
                  className="text-sm font-display font-bold text-[#111111] truncate"
                >
                  Edit {editDraft.costCode} — {editDraft.costCodeName}
                </h2>
                <p className="text-[11px] text-[#5F5F5A]">
                  Update quantity, unit price, or fixed/allowance lump sum.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close line editor"
                onClick={() => setEditDraft(null)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md text-[#5F5F5A] hover:text-[#111111] hover:bg-[#F4F4F1]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditLine} className="p-4 sm:p-5 space-y-4">
              {editError ? (
                <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-3.5 py-2.5 rounded-md text-xs">
                  {editError}
                </div>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[#111111] mb-1">
                    Pricing Source
                  </label>
                  <select
                    value={editDraft.pricingSource}
                    onChange={(e) =>
                      setEditDraft({
                        ...editDraft,
                        pricingSource: e.target.value as PricingSource,
                      })
                    }
                    className="w-full min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                  >
                    <option value="sub">Subcontractor</option>
                    <option value="supplier">Supplier</option>
                    <option value="fixed">Fixed Amount</option>
                    <option value="allowance">Allowance</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#111111] mb-1">Unit</label>
                  <input
                    required
                    value={editDraft.unit}
                    onChange={(e) => setEditDraft({ ...editDraft, unit: e.target.value })}
                    placeholder="LS, SF, LF, EA"
                    className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[#111111] mb-1">
                    Quantity
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    required
                    value={editDraft.quantity}
                    onChange={(e) => setEditDraft({ ...editDraft, quantity: e.target.value })}
                    className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#111111] mb-1">
                    Unit Price ($)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editDraft.unitPriceDollars}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, unitPriceDollars: e.target.value })
                    }
                    className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#111111] mb-1">
                  Fixed / Allowance Lump Sum ($) <span className="font-normal text-[#5F5F5A]">(optional — overrides Qty × Unit Price)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Leave blank to calculate Qty × Unit Price"
                  value={editDraft.fixedAmountDollars}
                  onChange={(e) =>
                    setEditDraft({ ...editDraft, fixedAmountDollars: e.target.value })
                  }
                  className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#111111] mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editDraft.notes}
                  onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                  placeholder="Scope assumptions, allowance details, or takeoff reference…"
                  className="w-full border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2 border-t border-[#E3E3DE]">
                <button
                  type="button"
                  onClick={() => setEditDraft(null)}
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLine}
                  className="w-full sm:w-auto min-h-[44px] px-5 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-bold hover:bg-[#FCAE1A] hover:text-[#111111] disabled:opacity-60 transition-colors"
                >
                  {savingLine ? 'Saving…' : 'Save Estimate Line'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
