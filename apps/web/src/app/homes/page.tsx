'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, formatCurrency } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface HomeItem {
  id: string;
  homeCode: string;
  subdivisionCode: string;
  subdivisionName: string;
  lot: string;
  address: string;
  planName: string;
  elevation: string;
  garageHanding: string;
  finishedSqFt: number;
  garageSqFt: number;
  bedrooms: number;
  baths: number;
  stories: number;
  roofPitch: string;
  exteriorFinishMix: string;
  stage: string;
  planRevision: string;
  soldAmountCents: number | null;
}

const STAGE_PILLS: Record<string, { label: string; cls: string }> = {
  plan_intake: { label: 'Plan Intake', cls: 'bg-[#F4F4F1] text-[#3B3B38]' },
  estimating: { label: 'Estimating', cls: 'bg-[#DBEAFE] text-[#1E40AF]' },
  quotes_out: { label: 'Quotes Out', cls: 'bg-[#FEF3C7] text-[#8A5A00]' },
  pos_esign: { label: 'POs / E-Sign', cls: 'bg-[#FFEDD5] text-[#9A3412]' },
  live_budget: { label: 'Live Budget', cls: 'bg-[#DCFCE7] text-[#166534]' },
};

export default function HomesPage() {
  const { role, subCompanyId } = useRole();
  const [homes, setHomes] = useState<HomeItem[]>([]);
  const [showIntake, setShowIntake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  usePageContext({
    section: 'Homes & Plans',
    entityType: 'home_list',
    entityLabel: showIntake ? 'Plan Intake Form' : `${homes.length} Homes`,
    summary: { homeCount: homes.length, intakeOpen: showIntake },
  });

  const [form, setForm] = useState({
    subdivisionCode: 'CH',
    lot: '',
    address: '',
    planName: 'Zion 2450',
    elevation: 'Modern Desert',
    garageHanding: 'Right' as const,
    finishedSqFt: 2450,
    garageSqFt: 720,
    bedrooms: 4,
    baths: 3,
    stories: 1,
    roofPitch: '5:12',
    exteriorFinishMix: 'Stucco + Stone',
  });

  const loadHomes = () => {
    apiFetch<{ homes: HomeItem[] }>('/api/homes', { role, subCompanyId })
      .then((res) => setHomes(res.homes))
      .catch(() => {});
  };

  useEffect(() => {
    loadHomes();
  }, [role, subCompanyId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('intake') === '1' && (role === 'admin' || role === 'estimator_approver')) {
      setShowIntake(true);
    }
  }, [role]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await apiFetch<{ home: HomeItem }>('/api/homes', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify(form),
      });
      setMessage(`Created ${res.home.homeCode} and initialized all 81 estimate cost codes.`);
      setShowIntake(false);
      setForm({ ...form, lot: '', address: '' });
      loadHomes();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Failed to create home');
    } finally {
      setSubmitting(false);
    }
  };

  const getStagePill = (stage: string) =>
    STAGE_PILLS[stage] ?? {
      label: stage.replaceAll('_', ' '),
      cls: 'bg-[#F4F4F1] text-[#3B3B38]',
    };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-display font-bold text-[#111111]">Homes &amp; Plan Intake</h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.1 — Record subdivision, lot, house specs, plan library link, and revisions.
          </p>
        </div>
        {(role === 'admin' || role === 'estimator_approver') && (
          <button
            type="button"
            onClick={() => setShowIntake((v) => !v)}
            className="w-full sm:w-auto min-h-[44px] flex items-center justify-center px-4 py-2 rounded-md bg-[#FCAE1A] text-xs font-display font-bold text-[#111111] hover:bg-[#111111] hover:text-white active:bg-[#111111] active:text-white transition-colors"
          >
            {showIntake ? 'Close Intake Form' : '+ New Plan Intake'}
          </button>
        )}
      </div>

      {message ? (
        <div className="bg-white border border-[#FCAE1A] text-xs px-4 py-2.5 rounded-md text-[#111111]">
          {message}
        </div>
      ) : null}

      {showIntake ? (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-[#E3E3DE] rounded-lg p-4 sm:p-5 grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          <div>
            <label className="block text-xs font-semibold text-[#111111] mb-1">Subdivision</label>
            <select
              value={form.subdivisionCode}
              onChange={(e) => setForm({ ...form, subdivisionCode: e.target.value })}
              className="w-full min-h-[44px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
            >
              <option value="CH">CH — Cottonwood Hollow</option>
              <option value="LK">LK — Lava Knolls</option>
              <option value="NS">NS — North Slope at Copper Rock</option>
              <option value="PS">PS — Park Side at Grandpa&apos;s Pond</option>
              <option value="ZV">ZV — Zion Vista</option>
              <option value="SH">SH — Sand Hollow</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#111111] mb-1">Lot Number</label>
            <input
              required
              placeholder="e.g. 25"
              value={form.lot}
              onChange={(e) => setForm({ ...form, lot: e.target.value })}
              className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#111111] mb-1">Street Address</label>
            <input
              required
              placeholder="e.g. 512 W Cottonwood Hollow Rd"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#111111] mb-1">Plan Name (Library)</label>
            <input
              required
              value={form.planName}
              onChange={(e) => setForm({ ...form, planName: e.target.value })}
              className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#111111] mb-1">Elevation</label>
            <input
              value={form.elevation}
              onChange={(e) => setForm({ ...form, elevation: e.target.value })}
              className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#111111] mb-1">
              Finished Sq Ft / Garage Sq Ft
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                aria-label="Finished Sq Ft"
                value={form.finishedSqFt}
                onChange={(e) => setForm({ ...form, finishedSqFt: Number(e.target.value) })}
                className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
              />
              <input
                type="number"
                aria-label="Garage Sq Ft"
                value={form.garageSqFt}
                onChange={(e) => setForm({ ...form, garageSqFt: Number(e.target.value) })}
                className="w-full min-h-[44px] border border-[#E3E3DE] rounded-md px-3 py-2 text-base sm:text-sm text-[#111111] tabular-nums"
              />
            </div>
          </div>
          <div className="md:col-span-3 flex justify-end gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full md:w-auto min-h-[44px] flex items-center justify-center px-5 py-2.5 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] disabled:opacity-60 transition-colors"
            >
              {submitting ? 'Saving...' : 'Create Home & Start Estimate'}
            </button>
          </div>
        </form>
      ) : null}

      {/* Mobile Stacked Home Cards (<md) */}
      <div className="md:hidden space-y-3">
        {homes.map((h) => {
          const pill = getStagePill(h.stage);
          return (
            <article
              key={h.id}
              className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="font-display font-bold text-base text-[#111111]">
                      {h.homeCode}
                    </h2>
                    <span className="text-xs text-[#5F5F5A]">{h.planRevision}</span>
                  </div>
                </div>
                <span
                  className={`shrink-0 inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${pill.cls}`}
                >
                  {pill.label}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div>
                  <div className="font-semibold text-[#111111]">{h.subdivisionName}</div>
                  <div className="text-[#5F5F5A] break-words">{h.address}</div>
                </div>
                <div className="pt-1 border-t border-[#E3E3DE]/80">
                  <div className="font-medium text-[#111111]">
                    {h.planName} · {h.elevation}
                  </div>
                  <div className="text-[#5F5F5A] tabular-nums mt-0.5">
                    {h.finishedSqFt.toLocaleString()} sf + {h.garageSqFt.toLocaleString()} gar ·{' '}
                    {h.bedrooms}bd/{h.baths}ba · {h.roofPitch}
                  </div>
                </div>
                {h.soldAmountCents !== null ? (
                  <div className="flex items-center justify-between pt-1.5 border-t border-[#E3E3DE]/80">
                    <span className="text-[#5F5F5A]">Sold Price (Internal)</span>
                    <span className="font-display font-bold text-[#111111] tabular-nums">
                      {formatCurrency(h.soldAmountCents)}
                    </span>
                  </div>
                ) : null}
              </div>

              <Link
                href={`/estimates?homeId=${h.id}`}
                className="w-full min-h-[44px] flex items-center justify-center rounded-md border border-[#111111] bg-[#111111] text-white text-xs font-display font-bold hover:bg-[#FCAE1A] hover:text-[#111111] hover:border-[#FCAE1A] active:bg-[#FCAE1A] active:text-[#111111] transition-colors"
              >
                Open Estimate →
              </Link>
            </article>
          );
        })}
        {homes.length === 0 ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg px-4 py-8 text-center text-xs text-[#5F5F5A]">
            No homes recorded yet.
          </div>
        ) : null}
      </div>

      {/* Desktop Table (md+) */}
      <div className="hidden md:block bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1] text-[10px] font-display uppercase tracking-wider text-[#5F5F5A]">
                <th className="py-3 px-4">Home ID</th>
                <th className="py-3 px-4">Subdivision &amp; Address</th>
                <th className="py-3 px-4">Plan &amp; Specs</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4 text-right">Sold Price (Internal)</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E3DE] text-[13px]">
              {homes.map((h) => {
                const pill = getStagePill(h.stage);
                return (
                  <tr key={h.id} className="hover:bg-[#F4F4F1]/40">
                    <td className="py-3 px-4 font-display font-bold text-[#111111] whitespace-nowrap">
                      {h.homeCode}
                      <div className="text-[11px] font-normal text-[#5F5F5A]">{h.planRevision}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[#111111]">{h.subdivisionName}</div>
                      <div className="text-xs text-[#5F5F5A]">{h.address}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-[#111111]">
                        {h.planName} · {h.elevation}
                      </div>
                      <div className="text-xs text-[#5F5F5A] tabular-nums">
                        {h.finishedSqFt.toLocaleString()} sf + {h.garageSqFt.toLocaleString()} gar ·{' '}
                        {h.bedrooms}bd/{h.baths}ba · {h.roofPitch}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-block text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${pill.cls}`}
                      >
                        {pill.label}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-[#3B3B38]">
                      {formatCurrency(h.soldAmountCents)}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <Link
                        href={`/estimates?homeId=${h.id}`}
                        className="text-xs font-semibold text-[#8A5A00] hover:underline"
                      >
                        Open Estimate →
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {homes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-xs text-[#5F5F5A]">
                    No homes recorded yet.
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
