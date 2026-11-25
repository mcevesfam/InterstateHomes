'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  FileSignature,
  FileText,
  MessageSquareWarning,
  RefreshCw,
  Sheet,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface SubPortalSummary {
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
}

const SEVERITY_BADGE: Record<string, string> = {
  red: 'bg-[#FEE2E2] text-[#991B1B]',
  amber: 'bg-[#FEF3C7] text-[#8A5A00]',
  blue: 'bg-[#DBEAFE] text-[#1E40AF]',
  neutral: 'bg-[#F4F4F1] text-[#3B3B38]',
};

export default function SubcontractorPortalPage() {
  const { role, subCompanyId, user } = useRole();
  const [summary, setSummary] = useState<SubPortalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePageContext({
    section: 'Subcontractor Portal',
    entityLabel: user?.fullName || 'Portal Overview',
    summary: summary
      ? {
          quotesOut: summary.kpis.quotesOut,
          posAwaitingSign: summary.kpis.posAwaitingSign,
          complianceAlerts: summary.kpis.complianceAlerts,
          openClarifications: summary.kpis.openClarifications,
        }
      : undefined,
  });

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<SubPortalSummary>('/api/dashboard/summary', {
        role,
        subCompanyId,
      });
      setSummary(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load your portal overview right now.'
      );
    } finally {
      setLoading(false);
    }
  }, [role, subCompanyId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const kpis = summary?.kpis;
  const complianceOk = (kpis?.complianceAlerts ?? 0) === 0;
  const actionItems = (summary?.needsAttention ?? []).filter((item) => item.href !== '/homes');

  const quickLinks = [
    {
      label: 'My Quotes',
      desc: 'Review & respond to pricing requests',
      href: '/quotes',
      icon: FileText,
    },
    {
      label: 'POs & Agreements',
      desc: 'Sign purchase orders & view scopes',
      href: '/purchase-orders',
      icon: FileSignature,
    },
    {
      label: 'Price Sheets',
      desc: 'Manage unit pricing & effective dates',
      href: '/price-sheets',
      icon: Sheet,
    },
    {
      label: 'Compliance Docs',
      desc: 'Upload COI, W-9, license & WC docs',
      href: '/compliance',
      icon: ShieldAlert,
    },
    {
      label: 'Clarifications',
      desc: 'Respond to scope & field questions',
      href: '/clarifications',
      icon: MessageSquareWarning,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#111111] tracking-tight">
            Subcontractor Portal
          </h1>
          <p className="text-sm text-[#5F5F5A] mt-1">
            Track your open quotes, purchase orders awaiting e-signature, compliance status, and field clarifications.
          </p>
        </div>
        {role !== 'subcontractor' ? (
          <Link
            href="/"
            className="min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#111111] hover:bg-[#262624] text-white font-display text-xs font-semibold transition-colors"
          >
            <span>Return to Internal Dashboard</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#FCAE1A]" />
          </Link>
        ) : null}
      </div>

      {/* Error State */}
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-sm text-[#991B1B]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadSummary()}
            className="min-h-[44px] sm:min-h-0 px-3.5 py-2 rounded-lg bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-display text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : null}

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-white border border-[#E3E3DE] rounded-xl p-4 sm:p-5 animate-pulse space-y-2.5"
            >
              <div className="h-3 w-24 bg-[#E3E3DE] rounded" />
              <div className="h-7 w-14 bg-[#E3E3DE] rounded" />
              <div className="h-3 w-32 bg-[#F4F4F1] rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Link
            href="/quotes"
            className="bg-white border border-[#E3E3DE] hover:border-[#FCAE1A] rounded-xl p-4 sm:p-5 transition-colors flex flex-col justify-between gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-display font-semibold text-[#5F5F5A]">My Quotes</span>
              <FileText className="w-4 h-4 text-[#8A5A00] shrink-0" />
            </div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-[#111111] tabular-nums">
              {kpis?.quotesOut ?? 0}
            </div>
            <div className="text-xs text-[#5F5F5A]">
              {(kpis?.countersToReview ?? 0) > 0
                ? `${kpis?.countersToReview} adjustment pending review`
                : 'Awaiting your response'}
            </div>
          </Link>

          <Link
            href="/purchase-orders"
            className="bg-white border border-[#E3E3DE] hover:border-[#FCAE1A] rounded-xl p-4 sm:p-5 transition-colors flex flex-col justify-between gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-display font-semibold text-[#5F5F5A]">
                POs to E-Sign
              </span>
              <FileSignature className="w-4 h-4 text-[#8A5A00] shrink-0" />
            </div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-[#111111] tabular-nums">
              {kpis?.posAwaitingSign ?? 0}
            </div>
            <div className="text-xs text-[#5F5F5A]">Awaiting your signature</div>
          </Link>

          <Link
            href="/compliance"
            className={`border rounded-xl p-4 sm:p-5 transition-colors flex flex-col justify-between gap-2 ${
              complianceOk
                ? 'bg-white border-[#E3E3DE] hover:border-[#166534]'
                : 'bg-[#FEF2F2] border-[#FCA5A5] hover:border-[#991B1B]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-display font-semibold text-[#5F5F5A]">Compliance</span>
              {complianceOk ? (
                <ShieldCheck className="w-4 h-4 text-[#166534] shrink-0" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-[#991B1B] shrink-0" />
              )}
            </div>
            <div
              className={`font-display text-xl sm:text-2xl font-bold tabular-nums ${
                complianceOk ? 'text-[#166534]' : 'text-[#991B1B]'
              }`}
            >
              {complianceOk ? 'PO Eligible' : `${kpis?.complianceAlerts} Alert${kpis?.complianceAlerts === 1 ? '' : 's'}`}
            </div>
            <div className="text-xs text-[#5F5F5A]">
              {complianceOk ? 'All required docs current' : 'Action required to receive POs'}
            </div>
          </Link>

          <Link
            href="/clarifications"
            className="bg-white border border-[#E3E3DE] hover:border-[#FCAE1A] rounded-xl p-4 sm:p-5 transition-colors flex flex-col justify-between gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-display font-semibold text-[#5F5F5A]">
                Clarifications
              </span>
              <MessageSquareWarning className="w-4 h-4 text-[#8A5A00] shrink-0" />
            </div>
            <div className="font-display text-2xl sm:text-3xl font-bold text-[#111111] tabular-nums">
              {kpis?.openClarifications ?? 0}
            </div>
            <div className="text-xs text-[#5F5F5A]">Open scope items</div>
          </Link>
        </div>
      )}

      {/* Action Feed */}
      <section className="bg-white border border-[#E3E3DE] rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#E3E3DE] flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-bold text-[#111111]">Action Items</h2>
          <span className="text-xs text-[#5F5F5A] tabular-nums">
            {loading ? 'Loading…' : `${actionItems.length} open`}
          </span>
        </div>

        {loading ? (
          <div className="p-5 space-y-3 animate-pulse">
            <div className="h-12 bg-[#F4F4F1] rounded-lg" />
            <div className="h-12 bg-[#F4F4F1] rounded-lg" />
          </div>
        ) : actionItems.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#DCFCE7] text-[#166534]">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="font-display text-sm font-bold text-[#111111]">
              You&apos;re all caught up
            </div>
            <p className="text-xs text-[#5F5F5A] max-w-sm mx-auto">
              There are no pending quotes or purchase orders waiting on your signature right now.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#E3E3DE]">
            {actionItems.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="min-h-[56px] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-[#FAFAF8] transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[10px] font-display font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          SEVERITY_BADGE[item.severity] ?? SEVERITY_BADGE.neutral
                        }`}
                      >
                        {item.badge}
                      </span>
                      <span className="text-sm font-semibold text-[#111111] break-words">
                        {item.title}
                      </span>
                    </div>
                    <p className="text-xs text-[#5F5F5A] break-words">{item.subtitle}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#5F5F5A] shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Portal Quick Navigation */}
      <section className="space-y-3">
        <h2 className="font-display text-sm font-bold text-[#111111]">Quick Access</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {quickLinks.map((q) => {
            const Icon = q.icon;
            return (
              <Link
                key={q.href}
                href={q.href}
                className="min-h-[60px] bg-white border border-[#E3E3DE] hover:border-[#111111] rounded-xl p-4 flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-lg bg-[#111111] text-[#FCAE1A] flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-display text-xs font-bold text-[#111111]">{q.label}</div>
                    <div className="text-xs text-[#5F5F5A] truncate">{q.desc}</div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-[#5F5F5A] shrink-0" />
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
