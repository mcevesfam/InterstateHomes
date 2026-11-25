'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { COST_CODES, canAccess } from '@interstate/shared';
import { apiFetch } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface Clarification {
  id: string;
  homeCode: string;
  costCode: string;
  costCodeName: string;
  category: string;
  title: string;
  status: string;
  ownerName: string;
  dueDate: string;
  messages: Array<{ author: string; body: string; createdAt: string }>;
}

interface HomeOption {
  id: string;
  homeCode: string;
  planName: string;
}

export default function ClarificationsPage() {
  const { role, subCompanyId } = useRole();
  const canCreate = canAccess(role, 'clarifications:create');
  const canSeeInternal = canAccess(role, 'financials:view_internal');

  const [items, setItems] = useState<Clarification[]>([]);
  const [homes, setHomes] = useState<HomeOption[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [homeId, setHomeId] = useState('');
  const [costCode, setCostCode] = useState('31');
  const [category, setCategory] = useState<'question' | 'scope_gap' | 'plan_conflict' | 'price_dispute'>('question');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(() =>
    new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10)
  );
  const [submitting, setSubmitting] = useState(false);

  usePageContext({
    section: 'Clarifications',
    entityType: 'clarification_list',
    entityLabel: `${items.length} Items (${statusFilter})`,
    summary: { totalItems: items.length, statusFilter },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [clrRes, homesRes] = await Promise.all([
        apiFetch<{ clarifications: Clarification[] }>('/api/clarifications', { role, subCompanyId }),
        canCreate
          ? apiFetch<{ homes: HomeOption[] }>('/api/homes', { role, subCompanyId }).catch(() => ({
              homes: [],
            }))
          : Promise.resolve({ homes: [] }),
      ]);
      setItems(clrRes.clarifications);
      setHomes(homesRes.homes);
      setHomeId((prev) => prev || homesRes.homes[0]?.id || '');
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load clarifications.');
    } finally {
      setLoading(false);
    }
  }, [canCreate, role, subCompanyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!homeId) {
      setNotice({ type: 'err', text: 'Select a home before logging a clarification.' });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      await apiFetch('/api/clarifications', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({
          homeId,
          costCode,
          category,
          title: title.trim(),
          description: description.trim(),
          dueDate: dueDate || undefined,
        }),
      });
      setNotice({ type: 'ok', text: `Logged clarification "${title.trim()}".` });
      setTitle('');
      setDescription('');
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to log clarification.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = items.filter((i) => statusFilter === 'all' || i.status === statusFilter);
  const selectableCostCodes = COST_CODES.filter(
    (cc) => cc.code !== '00' && (canSeeInternal || !cc.isInternalOnly)
  );

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
            Clarification Log
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 5.10 — Filterable post-approval log for questions, scope gaps, plan conflicts, and price disputes.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
          <select
            aria-label="Filter clarifications by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 text-xs font-semibold text-[#111111]"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="answered">Answered</option>
            <option value="closed">Closed</option>
          </select>
          {canCreate ? (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] transition-colors cursor-pointer"
            >
              {showForm ? 'Close Form' : '+ Log Clarification'}
            </button>
          ) : null}
        </div>
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
          className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-3 text-xs"
        >
          <div className="font-display font-bold text-sm text-[#111111]">Log New Clarification</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Home</span>
              <select
                required
                value={homeId}
                onChange={(e) => setHomeId(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                <option value="">Select home…</option>
                {homes.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.homeCode} — {h.planName}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Cost Code</span>
              <select
                required
                value={costCode}
                onChange={(e) => setCostCode(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                {selectableCostCodes.map((cc) => (
                  <option key={cc.code} value={cc.code}>
                    {cc.code} — {cc.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Category</span>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(
                    e.target.value as 'question' | 'scope_gap' | 'plan_conflict' | 'price_dispute'
                  )
                }
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                <option value="question">Question</option>
                <option value="scope_gap">Scope Gap</option>
                <option value="plan_conflict">Plan Conflict</option>
                <option value="price_dispute">Price Dispute</option>
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Due Date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="font-semibold text-[#3B3B38]">Title</span>
            <input
              type="text"
              required
              minLength={3}
              maxLength={200}
              placeholder="e.g. Garage soffit depth conflict between Rev 1 & framing plan"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
            />
          </label>
          <label className="space-y-1 block">
            <span className="font-semibold text-[#3B3B38]">Description / Initial Message</span>
            <textarea
              required
              minLength={3}
              maxLength={2000}
              rows={3}
              placeholder="Describe the question, conflict, or scope gap clearly..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
            />
          </label>
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white font-semibold text-[#3B3B38] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !homeId}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#FCAE1A] text-[#111111] font-display font-bold hover:bg-[#E59C12] disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Logging…' : 'Submit Clarification'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="space-y-3">
        {loading ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-5 text-xs text-[#5F5F5A] text-center">
            Loading clarifications…
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-[#E3E3DE] rounded-lg p-5 text-xs text-[#5F5F5A] text-center space-y-2">
            <div>
              {items.length === 0
                ? 'No clarifications logged yet.'
                : 'No clarifications match this status filter.'}
            </div>
            {canCreate && !showForm && homes.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="min-h-[44px] sm:min-h-[36px] px-4 py-2 rounded-md bg-[#111111] text-white font-display font-semibold cursor-pointer"
              >
                + Log Clarification
              </button>
            ) : null}
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-2.5 min-w-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#F4F4F1] text-[#111111] shrink-0">
                    {item.homeCode} · {item.costCode}
                  </span>
                  <span className="font-display font-bold text-sm text-[#111111] break-words min-w-0">
                    {item.title}
                  </span>
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#FEF3C7] text-[#8A5A00] shrink-0 tabular-nums">
                  {item.status} · Due {item.dueDate || 'TBD'}
                </span>
              </div>
              <div className="text-xs text-[#5F5F5A] break-words">
                Category: {item.category.replace('_', ' ')} · Owner: {item.ownerName}
              </div>
              {item.messages.map((m, idx) => (
                <div key={idx} className="bg-[#F4F4F1]/60 rounded px-3 py-2 text-xs break-words">
                  <span className="font-semibold text-[#111111]">{m.author}:</span> {m.body}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
