'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ROLE_LABELS, canAccess } from '@interstate/shared';
import { apiFetch, formatCurrency } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface DashboardSummary {
  role: string;
  kpis: {
    activeHomes: number;
    quotesOut: number;
    countersToReview: number;
    posAwaitingSign: number;
    complianceAlerts: number;
    openClarifications: number;
  };
  needsAttention: Array<{
    id: string;
    badge: string;
    severity: string;
    title: string;
    subtitle: string;
    href: string;
  }>;
  activeHomes: Array<{
    id: string;
    homeCode: string;
    subdivisionName: string;
    planName: string;
    stage: string;
    planRevision: string;
    posSignedLabel: string;
    soldAmountCents: number | null;
  }>;
  pipeline: Array<{
    stage: string;
    label: string;
    count: number;
    totalEstimateCents: number;
  }>;
}

const BADGE_STYLES: Record<string, string> = {
  red: 'bg-[#FEE2E2] text-[#991B1B] border-[#FECACA]',
  amber: 'bg-[#FEF3C7] text-[#8A5A00] border-[#FDE68A]',
  blue: 'bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]',
  neutral: 'bg-[#F4F4F1] text-[#3B3B38] border-[#E3E3DE]',
};

const STAGE_PILLS: Record<string, { label: string; cls: string }> = {
  plan_intake: { label: 'Plan Intake', cls: 'bg-[#F4F4F1] text-[#3B3B38]' },
  estimating: { label: 'Estimating', cls: 'bg-[#DBEAFE] text-[#1E40AF]' },
  quotes_out: { label: 'Quotes Out', cls: 'bg-[#FEF3C7] text-[#8A5A00]' },
  pos_esign: { label: 'POs / E-Sign', cls: 'bg-[#FFEDD5] text-[#9A3412]' },
  live_budget: { label: 'Live Budget', cls: 'bg-[#DCFCE7] text-[#166534]' },
};

export default function DashboardPage() {
  const { role, subCompanyId } = useRole();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canIntake = canAccess(role, 'plans:intake');
  const canBuildEstimates = canAccess(role, 'estimates:build');

  usePageContext({
    section: 'Dashboard',
    entityType: 'workspace',
    entityLabel: data ? `${data.kpis.activeHomes} Active Homes` : 'Executive Overview',
    summary: data
      ? {
          activeHomes: data.kpis.activeHomes,
          quotesOut: data.kpis.quotesOut,
          posAwaitingSign: data.kpis.posAwaitingSign,
          complianceAlerts: data.kpis.complianceAlerts,
        }
      : undefined,
  });

  const loadSummary = useCallback(
    async (isCancelled?: () => boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch<DashboardSummary>('/api/dashboard/summary', {
          role,
          subCompanyId,
        });
        if (!isCancelled?.()) {
          setData(res);
        }
      } catch (err: unknown) {
        if (!isCancelled?.()) {
          setError(err instanceof Error ? err.message : 'Unable to load dashboard summary.');
        }
      } finally {
        if (!isCancelled?.()) setLoading(false);
      }
    },
    [role, subCompanyId]
  );

  useEffect(() => {
    let cancelled = false;
    void loadSummary(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadSummary]);

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="space-y-5">
      {/* Header matching wireframe */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-[#5F5F5A]">
            {todayLabel} · Signed in as {ROLE_LABELS[role]}
          </div>
          <h1 className="text-2xl font-display font-bold tracking-tight text-[#111111] mt-0.5">
            Dashboard
          </h1>
        </div>
        {canIntake ? (
          <div className="flex flex-col sm:flex-row w-full sm:w-auto items-stretch sm:items-center gap-2.5">
            <Link
              href="/homes?intake=1"
              className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-3.5 py-2 rounded-md border border-[#E3E3DE] bg-white text-xs font-display font-semibold text-[#111111] hover:border-[#111111] active:bg-[#F4F4F1] transition-colors"
            >
              New Plan Intake
            </Link>
            <Link
              href="/estimates"
              className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white transition-colors"
            >
              + Open Estimate Builder
            </Link>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] px-4 py-3 rounded-lg text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 break-words">Unable to load dashboard data: {error}</div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            className="w-full sm:w-auto shrink-0 min-h-[44px] px-4 py-2 rounded-md border border-[#991B1B] bg-white text-xs font-display font-semibold text-[#991B1B] hover:bg-[#991B1B] hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Top 6 KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-3.5">
        {[
          { label: 'Active homes', value: data?.kpis.activeHomes ?? '—', sub: 'In workflow' },
          { label: 'Quotes out', value: data?.kpis.quotesOut ?? '—', sub: 'Awaiting sub reply' },
          { label: 'Counters to review', value: data?.kpis.countersToReview ?? '—', sub: 'Sub price/qty edits' },
          { label: 'POs awaiting sign', value: data?.kpis.posAwaitingSign ?? '—', sub: 'DocuSeal queue' },
          { label: 'Compliance alerts', value: data?.kpis.complianceAlerts ?? '—', sub: 'Expired / missing docs' },
          { label: 'Open clarifications', value: data?.kpis.openClarifications ?? '—', sub: 'Post-approval log' },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="min-w-0 bg-white border border-[#E3E3DE] rounded-lg px-3.5 py-3 sm:px-4 sm:py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
          >
            <div className="text-xs text-[#5F5F5A] truncate">{kpi.label}</div>
            <div className="text-2xl font-display font-bold text-[#111111] mt-1 tabular-nums">
              {loading && !data ? '…' : kpi.value}
            </div>
            <div className="text-[11px] text-[#5F5F5A] mt-0.5 leading-snug">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Middle 2-Column Row: Needs Attention + Active Homes */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Needs Attention */}
        <section className="lg:col-span-6 bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#E3E3DE]">
            <h2 className="text-sm font-display font-bold text-[#111111]">Needs attention</h2>
            <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#8A5A00] tabular-nums">
              {data?.needsAttention.length ?? 0} open
            </span>
          </div>
          <div className="divide-y divide-[#E3E3DE]">
            {loading && !data ? (
              <div className="px-4 py-8 text-center text-xs text-[#5F5F5A]">
                Loading action queue…
              </div>
            ) : (
              <>
                {(data?.needsAttention ?? []).map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-start gap-3 px-4 py-3.5 min-h-[44px] hover:bg-[#F4F4F1]/60 active:bg-[#F4F4F1] transition-colors"
                  >
                    <span
                      className={`shrink-0 mt-0.5 text-[10px] font-display font-bold px-2 py-0.5 rounded border ${
                        BADGE_STYLES[item.severity] ?? BADGE_STYLES.neutral
                      }`}
                    >
                      {item.badge}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-[#111111] leading-snug break-words">
                        {item.title}
                      </div>
                      <div className="text-xs text-[#5F5F5A] mt-0.5 break-words">{item.subtitle}</div>
                    </div>
                  </Link>
                ))}
                {data && data.needsAttention.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-[#5F5F5A]">
                    All compliance, quote, PO, and clarification queues are clear.
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* Active Homes */}
        <section className="lg:col-span-6 bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[#E3E3DE]">
            <h2 className="text-sm font-display font-bold text-[#111111]">Active homes</h2>
            {role !== 'subcontractor' ? (
              <Link
                href="/homes"
                className="text-xs font-semibold text-[#8A5A00] hover:underline py-1"
              >
                View all homes
              </Link>
            ) : null}
          </div>

          {loading && !data ? (
            <div className="px-4 py-8 text-center text-xs text-[#5F5F5A]">
              Loading active homes…
            </div>
          ) : (
            <>
              {/* Mobile Compact Home Cards (<sm) */}
              <div className="sm:hidden divide-y divide-[#E3E3DE]">
                {(data?.activeHomes ?? []).map((home) => {
                  const pill = STAGE_PILLS[home.stage] ?? STAGE_PILLS.plan_intake;
                  const homeHref = canBuildEstimates ? `/estimates?homeId=${home.id}` : '/homes';
                  return (
                    <Link
                      key={home.id}
                      href={homeHref}
                      className="block px-4 py-3.5 min-h-[44px] active:bg-[#F4F4F1] hover:bg-[#F4F4F1]/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display font-bold text-sm text-[#111111]">
                          {home.homeCode}
                        </span>
                        <span
                          className={`shrink-0 inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${pill.cls}`}
                        >
                          {pill.label}
                        </span>
                      </div>
                      <div className="text-[13px] font-medium text-[#111111] mt-1">
                        {home.planName}{' '}
                        <span className="text-[#5F5F5A] font-normal">· {home.subdivisionName}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-[#5F5F5A] mt-1 tabular-nums">
                        <span>{home.planRevision}</span>
                        <span>POs signed: {home.posSignedLabel}</span>
                      </div>
                    </Link>
                  );
                })}
                {role === 'subcontractor' ? (
                  <div className="py-8 px-4 text-center text-xs text-[#5F5F5A]">
                    Subcontractor Portal view shows only your assigned quotes and POs.
                  </div>
                ) : null}
                {data && role !== 'subcontractor' && data.activeHomes.length === 0 ? (
                  <div className="py-8 px-4 text-center text-xs text-[#5F5F5A]">
                    No active homes in workflow yet.
                  </div>
                ) : null}
              </div>

              {/* Desktop/Tablet Table (sm+) */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1]/70 text-[10px] font-display uppercase tracking-wider text-[#5F5F5A]">
                      <th className="py-2.5 px-4">Home</th>
                      <th className="py-2.5 px-3">Plan / Sub</th>
                      <th className="py-2.5 px-3">POs</th>
                      <th className="py-2.5 px-4 text-right">Stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3E3DE] text-[13px]">
                    {(data?.activeHomes ?? []).map((home) => {
                      const pill = STAGE_PILLS[home.stage] ?? STAGE_PILLS.plan_intake;
                      const homeHref = canBuildEstimates
                        ? `/estimates?homeId=${home.id}`
                        : '/homes';
                      return (
                        <tr key={home.id} className="hover:bg-[#F4F4F1]/40">
                          <td className="py-2.5 px-4 font-semibold text-[#111111] whitespace-nowrap">
                            <Link href={homeHref} className="hover:underline">
                              {home.homeCode}
                            </Link>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-[#111111]">{home.planName}</div>
                            <div className="text-[11px] text-[#5F5F5A]">
                              {home.subdivisionName} · {home.planRevision}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 tabular-nums text-[#3B3B38]">
                            {home.posSignedLabel}
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <span
                              className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${pill.cls}`}
                            >
                              {pill.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {role === 'subcontractor' ? (
                      <tr>
                        <td colSpan={4} className="py-8 px-4 text-center text-xs text-[#5F5F5A]">
                          Subcontractor Portal view shows only your assigned quotes and POs.
                        </td>
                      </tr>
                    ) : null}
                    {data && role !== 'subcontractor' && data.activeHomes.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 px-4 text-center text-xs text-[#5F5F5A]">
                          No active homes in workflow yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Bottom 5-Stage Pipeline Strip matching wireframe */}
      {role !== 'subcontractor' ? (
        <section className="bg-white border border-[#E3E3DE] rounded-lg p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
            <h2 className="text-sm font-display font-bold text-[#111111]">Homes pipeline</h2>
            <span className="text-xs text-[#5F5F5A]">
              Plans-to-budget single-pass workflow (Section 2)
            </span>
          </div>
          {loading && !data ? (
            <div className="py-6 text-center text-xs text-[#5F5F5A]">Loading pipeline…</div>
          ) : (
            <div className="flex overflow-x-auto snap-x gap-2.5 pb-1 md:grid md:grid-cols-5 md:gap-3 md:pb-0">
              {(data?.pipeline ?? []).map((stage) => (
                <Link
                  key={stage.stage}
                  href="/homes"
                  className="shrink-0 md:shrink min-w-[145px] md:min-w-0 snap-start border border-[#E3E3DE] rounded-md p-3 hover:border-[#FCAE1A] active:bg-[#F4F4F1] transition-colors bg-[#F4F4F1]/30"
                >
                  <div className="text-xs text-[#5F5F5A] truncate">{stage.label}</div>
                  <div className="text-xl font-display font-bold text-[#111111] mt-1 tabular-nums">
                    {stage.count}
                  </div>
                  <div className="text-xs text-[#5F5F5A] mt-0.5 tabular-nums">
                    {formatCurrency(stage.totalEstimateCents)}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
