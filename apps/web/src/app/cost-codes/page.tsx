'use client';

import React, { useState } from 'react';
import { COST_CLASSIFICATIONS, COST_CODES } from '@interstate/shared';
import { usePageContext } from '@/lib/page-context';

export default function CostCodesPage() {
  const [search, setSearch] = useState('');
  const [clsFilter, setClsFilter] = useState('all');

  const filtered = COST_CODES.filter((cc) => {
    if (clsFilter !== 'all' && cc.classificationCode !== clsFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      cc.code.toLowerCase().includes(q) ||
      cc.name.toLowerCase().includes(q) ||
      cc.estimateBuiltFrom.toLowerCase().includes(q)
    );
  });

  usePageContext({
    section: 'Cost Codes',
    entityType: 'cost_code_list',
    entityLabel: `${filtered.length} of ${COST_CODES.length} Cost Codes`,
    summary: {
      totalCodes: COST_CODES.length,
      filteredCodes: filtered.length,
      clsFilter,
    },
  });

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
            Master Cost Codes ({COST_CODES.length} Codes / {COST_CLASSIFICATIONS.length} Classifications)
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 7 &amp; Business Rule 12 — Stored strictly as text everywhere (e.g. &quot;03&quot;, &quot;00L&quot;).
          </p>
        </div>
        <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-2 shrink-0">
          <input
            aria-label="Filter cost codes or trades"
            placeholder="Filter code or trade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-48 min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-xs text-[#111111]"
          />
          <select
            aria-label="Filter by cost classification"
            value={clsFilter}
            onChange={(e) => setClsFilter(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-xs text-[#111111]"
          >
            <option value="all">All 11 Classifications</option>
            {COST_CLASSIFICATIONS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mobile Cost-Code Cards */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-5 text-xs text-[#5F5F5A] text-center">
            No cost codes match your search or classification filter.
          </div>
        ) : (
          filtered.map((cc) => (
            <div
              key={cc.code}
              className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-2.5 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-[#F4F4F1] text-[#111111] shrink-0">
                    {cc.code}
                  </span>
                  <span className="font-display font-bold text-sm text-[#111111] break-words min-w-0">
                    {cc.name}
                  </span>
                </div>
                {cc.isInternalOnly ? (
                  <span className="shrink-0 px-2 py-0.5 rounded bg-[#111111] text-[#FCAE1A] text-[10px] font-semibold whitespace-nowrap">
                    Internal Only
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-[#5F5F5A]">Standard</span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-1.5 pt-2 border-t border-[#E3E3DE]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-display uppercase text-[#5F5F5A] shrink-0">
                    Classification
                  </span>
                  <span className="text-[#3B3B38] text-right break-words">
                    {cc.classificationCode} {cc.classificationName}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] font-display uppercase text-[#5F5F5A] shrink-0">
                    Pricing Sources
                  </span>
                  <span className="uppercase text-[10px] font-semibold text-[#111111] text-right">
                    {cc.pricingSources.join(' / ')}
                  </span>
                </div>
                <div className="pt-1">
                  <div className="text-[10px] font-display uppercase text-[#5F5F5A]">
                    Allowed Sub-Lines
                  </div>
                  <div className="text-[#5F5F5A] mt-0.5 break-words">
                    {cc.allowedSubLines.join(', ') || '—'}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop 6-Column Cost-Codes Table */}
      <div className="hidden md:block overflow-x-auto bg-white border border-[#E3E3DE] rounded-lg">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1] text-[10px] font-display uppercase text-[#5F5F5A]">
              <th className="py-2.5 px-4">Code</th>
              <th className="py-2.5 px-3">Classification</th>
              <th className="py-2.5 px-3">Line Item</th>
              <th className="py-2.5 px-3">Pricing Sources</th>
              <th className="py-2.5 px-3">Visibility</th>
              <th className="py-2.5 px-4">Allowed Sub-Lines</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E3E3DE]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 px-4 text-center text-[#5F5F5A]">
                  No cost codes match your search or classification filter.
                </td>
              </tr>
            ) : (
              filtered.map((cc) => (
                <tr key={cc.code} className="hover:bg-[#F4F4F1]/40">
                  <td className="py-2.5 px-4 font-mono font-bold">{cc.code}</td>
                  <td className="py-2.5 px-3 text-[#5F5F5A]">
                    {cc.classificationCode} {cc.classificationName}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-[#111111]">{cc.name}</td>
                  <td className="py-2.5 px-3 uppercase text-[10px] font-semibold">
                    {cc.pricingSources.join(' / ')}
                  </td>
                  <td className="py-2.5 px-3">
                    {cc.isInternalOnly ? (
                      <span className="px-2 py-0.5 rounded bg-[#111111] text-[#FCAE1A] text-[10px] font-semibold whitespace-nowrap">
                        Internal Only
                      </span>
                    ) : (
                      <span className="text-[#5F5F5A]">Standard</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-[#5F5F5A]">
                    {cc.allowedSubLines.join(', ') || '—'}
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
