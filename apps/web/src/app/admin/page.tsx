'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';
import type { SystemSettingsConfig } from '@interstate/shared';

interface AuditRow {
  id: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  ipAddress: string;
  createdAt: string;
}

export default function AdminPage() {
  const { role, subCompanyId } = useRole();
  const [settings, setSettings] = useState<SystemSettingsConfig | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);

  usePageContext({
    section: 'Admin Console',
    entityType: 'system_settings',
    entityLabel: role === 'admin' ? `${auditLogs.length} Audit Events` : 'System Defaults',
    summary: { auditCount: auditLogs.length },
  });

  useEffect(() => {
    apiFetch<{ settings: SystemSettingsConfig }>('/api/admin/settings', { role, subCompanyId })
      .then((res) => setSettings(res.settings))
      .catch(() => {});

    if (role === 'admin') {
      apiFetch<{ auditLogs: AuditRow[] }>('/api/admin/audit-logs', { role, subCompanyId })
        .then((res) => setAuditLogs(res.auditLogs))
        .catch(() => {});
    }
  }, [role, subCompanyId]);

  return (
    <div className="space-y-5 min-w-0">
      <div>
        <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
          Admin Console, Security Settings &amp; Audit Log
        </h1>
        <p className="text-xs text-[#5F5F5A] mt-0.5">
          Section 4 — Configurable security defaults, Master Agreement versioning, and immutable audit log.
        </p>
      </div>

      {settings ? (
        <div className="bg-white border border-[#E3E3DE] rounded-lg p-4 sm:p-5">
          <h2 className="text-sm font-display font-bold mb-3">
            Confirmed Security &amp; System Defaults
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="border border-[#E3E3DE] rounded p-3 min-w-0">
              <div className="text-[#5F5F5A]">Min Password Length</div>
              <div className="font-display font-bold text-base mt-0.5 tabular-nums">
                {settings.minPasswordLength} chars
              </div>
            </div>
            <div className="border border-[#E3E3DE] rounded p-3 min-w-0">
              <div className="text-[#5F5F5A]">Session Timeout</div>
              <div className="font-display font-bold text-base mt-0.5 tabular-nums">
                {settings.sessionTimeoutMinutes} min
              </div>
            </div>
            <div className="border border-[#E3E3DE] rounded p-3 min-w-0">
              <div className="text-[#5F5F5A]">Inactive Auto-Disable</div>
              <div className="font-display font-bold text-base mt-0.5 tabular-nums">
                {settings.inactiveDisableDays} days
              </div>
            </div>
            <div className="border border-[#E3E3DE] rounded p-3 min-w-0">
              <div className="text-[#5F5F5A]">Audit Retention</div>
              <div className="font-display font-bold text-base mt-0.5 tabular-nums">
                {settings.auditRetentionYears} years
              </div>
            </div>
            <div className="border border-[#E3E3DE] rounded p-3 min-w-0">
              <div className="text-[#5F5F5A]">Max Plan Upload</div>
              <div className="font-display font-bold text-base mt-0.5 tabular-nums">
                {settings.maxPlanUploadMb} MB
              </div>
            </div>
            <div className="border border-[#E3E3DE] rounded p-3 min-w-0">
              <div className="text-[#5F5F5A]">Master Subcontract Ver</div>
              <div className="font-display font-bold text-base mt-0.5 tabular-nums">
                v{settings.currentMasterAgreementVersion}
              </div>
            </div>
            <div className="border border-[#E3E3DE] rounded p-3 min-w-0">
              <div className="text-[#5F5F5A]">PO Number Format</div>
              <div className="font-mono font-bold text-xs mt-1 break-words">
                {settings.poNumberFormat}
              </div>
            </div>
            <div className="border border-[#E3E3DE] rounded p-3 min-w-0">
              <div className="text-[#5F5F5A]">Warehouse Refresh</div>
              <div className="font-mono font-bold text-xs mt-1 break-words">
                {settings.warehouseRefreshSchedule}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E3E3DE] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <h2 className="text-sm font-display font-bold">Immutable Audit Log (Read-Only)</h2>
          <span className="text-xs text-[#5F5F5A]">
            {role === 'admin'
              ? `${auditLogs.length} events`
              : 'Switch Active Role View to Admin to inspect audit log'}
          </span>
        </div>

        {role === 'admin' ? (
          <>
            {/* Mobile Stacked Audit Log Cards */}
            <div className="md:hidden divide-y divide-[#E3E3DE]">
              {auditLogs.length === 0 ? (
                <div className="p-4 text-xs text-[#5F5F5A] text-center">
                  No audit events recorded yet.
                </div>
              ) : (
                auditLogs.map((row) => (
                  <div key={row.id} className="p-4 space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="font-mono font-semibold text-[11px] px-2 py-0.5 rounded bg-[#F4F4F1] text-[#111111] break-all">
                        {row.action}
                      </span>
                      <span className="text-[11px] tabular-nums text-[#5F5F5A]">
                        {new Date(row.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="font-medium text-[#111111] break-all">{row.actorEmail}</div>
                    <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#5F5F5A]">
                      <span className="break-all">
                        {row.entityType}: {row.entityId}
                      </span>
                      <span className="font-mono shrink-0">{row.ipAddress}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Desktop Audit Log Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1] text-[10px] font-display uppercase text-[#5F5F5A]">
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-3">Actor</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Entity</th>
                    <th className="py-2.5 px-4">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3E3DE]">
                  {auditLogs.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2.5 px-4 tabular-nums text-[#5F5F5A]">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 font-medium">{row.actorEmail}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold">{row.action}</td>
                      <td className="py-2.5 px-3">
                        {row.entityType}: {row.entityId}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#5F5F5A]">{row.ipAddress}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
