'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ROLE_LABELS,
  canAccess,
  type SystemSettingsConfig,
  type UserRole,
} from '@interstate/shared';
import { apiFetch, formatCurrency } from '@/lib/api';
import { usePageContext } from '@/lib/page-context';
import { useRole } from '@/lib/role-context';

interface AuditRow {
  id: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  ipAddress: string;
  createdAt: string;
}

interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  subCompanyId: string | null;
  status: string;
  mfaEnabled: boolean;
  approvalLimitCents: number | null;
  lastLoginAt: string | null;
  failedLoginAttempts?: number;
}

interface SubOption {
  id: string;
  legalName: string;
}

interface WarehouseRefreshResult {
  ok: boolean;
  runId: string;
  rowsWritten: number;
  tables: Record<string, number>;
  finishedAt: string;
}

const STATUS_BADGES: Record<string, string> = {
  active: 'bg-[#DCFCE7] text-[#166534]',
  locked: 'bg-[#FEE2E2] text-[#991B1B]',
  disabled: 'bg-[#F4F4F1] text-[#5F5F5A]',
};

export default function AdminPage() {
  const { role, subCompanyId, authMode } = useRole();
  const isAdmin = canAccess(role, 'users:manage') && canAccess(role, 'settings:manage');

  const [settings, setSettings] = useState<SystemSettingsConfig | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [subs, setSubs] = useState<SubOption[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Warehouse refresh
  const [refreshingWarehouse, setRefreshingWarehouse] = useState(false);

  // Invite user form
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('estimator_approver');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteSubCompanyId, setInviteSubCompanyId] = useState('');
  const [inviteApprovalLimitDollars, setInviteApprovalLimitDollars] = useState('');
  const [invitingUser, setInvitingUser] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // Editable settings form
  const [editingSettings, setEditingSettings] = useState(false);
  const [draftSettings, setDraftSettings] = useState<SystemSettingsConfig | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  usePageContext({
    section: 'Admin Console',
    entityType: 'system_settings',
    entityLabel: isAdmin ? `${users.length} Users · ${auditLogs.length} Audit Events` : 'Admin Restricted',
    summary: { userCount: users.length, auditCount: auditLogs.length },
  });

  const loadAll = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [settingsRes, usersRes, auditRes, subsRes] = await Promise.all([
        apiFetch<{ settings: SystemSettingsConfig }>('/api/admin/settings', { role, subCompanyId }),
        apiFetch<{ users: AdminUserRow[] }>('/api/admin/users', { role, subCompanyId }),
        apiFetch<{ auditLogs: AuditRow[] }>('/api/admin/audit-logs', { role, subCompanyId }),
        apiFetch<{ subcontractors: SubOption[] }>('/api/subcontractors', { role, subCompanyId }).catch(
          () => ({ subcontractors: [] })
        ),
      ]);
      setSettings(settingsRes.settings);
      setDraftSettings(settingsRes.settings);
      setUsers(usersRes.users);
      setAuditLogs(auditRes.auditLogs);
      setSubs(subsRes.subcontractors);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load admin console data.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, role, subCompanyId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRefreshWarehouse = async () => {
    setRefreshingWarehouse(true);
    setNotice(null);
    try {
      const res = await apiFetch<WarehouseRefreshResult>('/api/admin/warehouse/refresh', {
        method: 'POST',
        role,
        subCompanyId,
      });
      setNotice({
        type: 'ok',
        text: `Warehouse refreshed (${res.rowsWritten} rows written across 6 tables · Run ${res.runId}).`,
      });
      await loadAll();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Warehouse refresh failed.',
      });
    } finally {
      setRefreshingWarehouse(false);
    }
  };

  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setInvitingUser(true);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        fullName: inviteFullName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      };
      if (invitePassword.trim()) payload.password = invitePassword.trim();
      if (inviteRole === 'subcontractor' && inviteSubCompanyId) {
        payload.subCompanyId = inviteSubCompanyId;
      }
      if (
        (inviteRole === 'admin' || inviteRole === 'estimator_approver') &&
        inviteApprovalLimitDollars.trim() !== ''
      ) {
        const limitVal = Number(inviteApprovalLimitDollars);
        if (Number.isFinite(limitVal) && limitVal >= 0) {
          payload.approvalLimitCents = Math.round(limitVal * 100);
        }
      }

      const res = await apiFetch<{ user: AdminUserRow; temporaryPassword?: string }>(
        '/api/admin/users',
        {
          method: 'POST',
          role,
          subCompanyId,
          body: JSON.stringify(payload),
        }
      );

      setNotice({
        type: 'ok',
        text: res.temporaryPassword
          ? `Invited ${res.user.email}. Temporary password (copy now): ${res.temporaryPassword}`
          : `Created user ${res.user.email} (${ROLE_LABELS[res.user.role] ?? res.user.role}).`,
      });
      setInviteFullName('');
      setInviteEmail('');
      setInvitePassword('');
      setInviteSubCompanyId('');
      setInviteApprovalLimitDollars('');
      setShowInviteForm(false);
      await loadAll();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to invite user.',
      });
    } finally {
      setInvitingUser(false);
    }
  };

  const handlePatchUser = async (
    userId: string,
    patch: Record<string, unknown>,
    successMsg: string
  ) => {
    setBusyUserId(userId);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        role,
        subCompanyId,
        body: JSON.stringify(patch),
      });
      setNotice({ type: 'ok', text: successMsg });
      await loadAll();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update user.',
      });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftSettings) return;
    setSavingSettings(true);
    setNotice(null);
    try {
      const res = await apiFetch<{ settings: SystemSettingsConfig }>('/api/admin/settings', {
        method: 'PATCH',
        role,
        subCompanyId,
        body: JSON.stringify({
          minPasswordLength: draftSettings.minPasswordLength,
          sessionTimeoutMinutes: draftSettings.sessionTimeoutMinutes,
          inactiveDisableDays: draftSettings.inactiveDisableDays,
          auditRetentionYears: draftSettings.auditRetentionYears,
          maxPlanUploadMb: draftSettings.maxPlanUploadMb,
          currentMasterAgreementVersion: draftSettings.currentMasterAgreementVersion,
          poNumberFormat: draftSettings.poNumberFormat,
          warehouseRefreshSchedule: draftSettings.warehouseRefreshSchedule,
          requireMasterAgreement: draftSettings.requireMasterAgreement,
          defaultGlMinLimitCents: draftSettings.defaultGlMinLimitCents,
          defaultAutoMinLimitCents: draftSettings.defaultAutoMinLimitCents,
        }),
      });
      setSettings(res.settings);
      setDraftSettings(res.settings);
      setEditingSettings(false);
      setNotice({ type: 'ok', text: 'Updated security & system settings.' });
      await loadAll();
    } catch (err: unknown) {
      setNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to update settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="space-y-4 min-w-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
            Admin Console, Security Settings &amp; Audit Log
          </h1>
        </div>
        <div className="bg-white border border-[#E3E3DE] rounded-lg p-6 text-xs space-y-1.5">
          <div className="font-display font-bold text-sm text-[#111111]">
            Administrator Access Required
          </div>
          <p className="text-[#5F5F5A]">
            {authMode === 'demo'
              ? 'User management, security settings, and the immutable audit log require the Admin role.'
              : 'User management, security defaults, warehouse controls, and the immutable audit log are restricted to Interstate Homes administrators.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-display font-bold text-[#111111]">
            Admin Console, Security Settings &amp; Audit Log
          </h1>
          <p className="text-xs text-[#5F5F5A] mt-0.5">
            Section 4 — User provisioning, configurable security defaults, warehouse refresh, and immutable audit log.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={refreshingWarehouse}
            onClick={() => void handleRefreshWarehouse()}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-3.5 py-2 rounded-md border border-[#E3E3DE] bg-white hover:bg-[#F4F4F1] text-xs font-display font-semibold text-[#111111] disabled:opacity-50 cursor-pointer"
          >
            {refreshingWarehouse ? 'Refreshing Warehouse…' : 'Refresh Warehouse Now'}
          </button>
          <button
            type="button"
            onClick={() => setShowInviteForm((v) => !v)}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#111111] text-white text-xs font-display font-semibold hover:bg-[#FCAE1A] hover:text-[#111111] transition-colors cursor-pointer"
          >
            {showInviteForm ? 'Close Invite Form' : '+ Invite User'}
          </button>
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
            onClick={() => void loadAll()}
            className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded bg-[#991B1B] text-white font-semibold cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Invite User Form */}
      {showInviteForm ? (
        <form
          onSubmit={handleInviteUser}
          className="bg-white border border-[#E3E3DE] rounded-lg p-4 space-y-4 text-xs"
        >
          <div className="font-display font-bold text-sm text-[#111111]">
            Invite / Provision User Account
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Full Name *</span>
              <input
                type="text"
                required
                minLength={2}
                placeholder="e.g. Morgan Taylor"
                value={inviteFullName}
                onChange={(e) => setInviteFullName(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Email *</span>
              <input
                type="email"
                required
                placeholder="name@interstatehomes.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">Role *</span>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              >
                <option value="admin">Admin</option>
                <option value="estimator_approver">Estimator / Approver</option>
                <option value="project_manager">Project Manager / Field</option>
                <option value="subcontractor">Subcontractor Portal</option>
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="font-semibold text-[#3B3B38]">
                Initial Password (optional — auto-generated if blank)
              </span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={settings?.minPasswordLength ?? 12}
                placeholder={`Min ${settings?.minPasswordLength ?? 12} chars`}
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
              />
            </label>
            {inviteRole === 'subcontractor' ? (
              <label className="space-y-1 block">
                <span className="font-semibold text-[#3B3B38]">Linked Subcontractor Company *</span>
                <select
                  required
                  value={inviteSubCompanyId}
                  onChange={(e) => setInviteSubCompanyId(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2"
                >
                  <option value="">Select company…</option>
                  {subs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.legalName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {(inviteRole === 'admin' || inviteRole === 'estimator_approver') ? (
              <label className="space-y-1 block">
                <span className="font-semibold text-[#3B3B38]">PO Approval Limit (USD, optional)</span>
                <input
                  type="number"
                  min={0}
                  step="100"
                  placeholder="Blank = unlimited"
                  value={inviteApprovalLimitDollars}
                  onChange={(e) => setInviteApprovalLimitDollars(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] bg-white rounded-md px-3 py-2 tabular-nums"
                />
              </label>
            ) : null}
          </div>
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2 border-t border-[#E3E3DE]">
            <button
              type="button"
              onClick={() => setShowInviteForm(false)}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white font-semibold text-[#3B3B38] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={invitingUser}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#FCAE1A] text-[#111111] font-display font-bold hover:bg-[#E59C12] disabled:opacity-50 cursor-pointer"
            >
              {invitingUser ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      ) : null}

      {/* Users Management */}
      <div className="bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E3E3DE] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-display font-bold">Users &amp; Access Control</h2>
          <span className="text-xs text-[#5F5F5A] tabular-nums">{users.length} users</span>
        </div>

        {/* Mobile Users List */}
        <div className="md:hidden divide-y divide-[#E3E3DE]">
          {loading ? (
            <div className="p-4 text-xs text-[#5F5F5A] text-center">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="p-4 text-xs text-[#5F5F5A] text-center">No users found.</div>
          ) : (
            users.map((u) => {
              const isBusy = busyUserId === u.id;
              const needsUnlock = u.status === 'locked' || (u.failedLoginAttempts ?? 0) > 0;
              return (
                <div key={u.id} className="p-4 space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display font-bold text-sm text-[#111111] break-words">
                        {u.fullName}
                      </div>
                      <div className="text-[#5F5F5A] break-all">{u.email}</div>
                    </div>
                    <span
                      className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                        STATUS_BADGES[u.status] ?? STATUS_BADGES.active
                      }`}
                    >
                      {u.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#5F5F5A]">
                    <span className="px-2 py-0.5 rounded bg-[#F4F4F1] text-[#111111] font-semibold">
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                    <span>MFA: {u.mfaEnabled ? 'Enabled' : 'Not set'}</span>
                    {u.approvalLimitCents !== null ? (
                      <span className="tabular-nums">Limit: {formatCurrency(u.approvalLimitCents)}</span>
                    ) : null}
                    {(u.failedLoginAttempts ?? 0) > 0 ? (
                      <span className="text-[#991B1B] font-semibold">
                        Failed logins: {u.failedLoginAttempts}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {needsUnlock ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void handlePatchUser(
                            u.id,
                            { unlock: true, status: 'active' },
                            `Unlocked ${u.email}.`
                          )
                        }
                        className="flex-1 min-h-[44px] px-3 py-2 rounded-md bg-[#FCAE1A] text-[#111111] font-display font-bold disabled:opacity-50 cursor-pointer"
                      >
                        Unlock
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void handlePatchUser(
                          u.id,
                          { status: u.status === 'active' ? 'disabled' : 'active' },
                          `${u.status === 'active' ? 'Disabled' : 'Activated'} ${u.email}.`
                        )
                      }
                      className="flex-1 min-h-[44px] px-3 py-2 rounded-md border border-[#E3E3DE] bg-white text-[#111111] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {u.status === 'active' ? 'Disable' : 'Activate'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Users Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E3E3DE] bg-[#F4F4F1] text-[10px] font-display uppercase text-[#5F5F5A]">
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-3">Role</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">MFA</th>
                <th className="py-2.5 px-3">Last Login</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E3DE]">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-6 px-4 text-center text-[#5F5F5A]">
                    Loading users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 px-4 text-center text-[#5F5F5A]">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const isBusy = busyUserId === u.id;
                  const needsUnlock = u.status === 'locked' || (u.failedLoginAttempts ?? 0) > 0;
                  return (
                    <tr key={u.id} className="hover:bg-[#F4F4F1]/40">
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-[#111111]">{u.fullName}</div>
                        <div className="text-[#5F5F5A]">{u.email}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div>{ROLE_LABELS[u.role] ?? u.role}</div>
                        {u.approvalLimitCents !== null ? (
                          <div className="text-[11px] text-[#5F5F5A] tabular-nums">
                            Limit {formatCurrency(u.approvalLimitCents)}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                            STATUS_BADGES[u.status] ?? STATUS_BADGES.active
                          }`}
                        >
                          {u.status}
                        </span>
                        {(u.failedLoginAttempts ?? 0) > 0 ? (
                          <div className="text-[10px] text-[#991B1B] mt-0.5">
                            {u.failedLoginAttempts} failed
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-3 text-[#5F5F5A]">
                        {u.mfaEnabled ? 'Enabled' : 'Not enrolled'}
                      </td>
                      <td className="py-2.5 px-3 text-[#5F5F5A] tabular-nums">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {needsUnlock ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handlePatchUser(
                                  u.id,
                                  { unlock: true, status: 'active' },
                                  `Unlocked ${u.email}.`
                                )
                              }
                              className="px-2.5 py-1 rounded bg-[#FCAE1A] text-[#111111] font-semibold disabled:opacity-50 cursor-pointer"
                            >
                              Unlock
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handlePatchUser(
                                u.id,
                                { status: u.status === 'active' ? 'disabled' : 'active' },
                                `${u.status === 'active' ? 'Disabled' : 'Activated'} ${u.email}.`
                              )
                            }
                            className="px-2.5 py-1 rounded border border-[#E3E3DE] bg-white hover:bg-[#F4F4F1] text-[#111111] font-semibold disabled:opacity-50 cursor-pointer"
                          >
                            {u.status === 'active' ? 'Disable' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security & System Settings */}
      {settings ? (
        <div className="bg-white border border-[#E3E3DE] rounded-lg p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-display font-bold">
              Confirmed Security &amp; System Defaults
            </h2>
            <button
              type="button"
              onClick={() => {
                setDraftSettings(settings);
                setEditingSettings((v) => !v);
              }}
              className="min-h-[44px] sm:min-h-[34px] px-3 py-1.5 rounded-md border border-[#E3E3DE] bg-white hover:bg-[#F4F4F1] text-xs font-semibold text-[#111111] cursor-pointer"
            >
              {editingSettings ? 'Cancel Edit' : 'Edit Settings'}
            </button>
          </div>

          {editingSettings && draftSettings ? (
            <form onSubmit={handleSaveSettings} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">Min Password Length</span>
                  <input
                    type="number"
                    min={8}
                    max={64}
                    required
                    value={draftSettings.minPasswordLength}
                    onChange={(e) =>
                      setDraftSettings({
                        ...draftSettings,
                        minPasswordLength: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] rounded-md px-3 py-2 tabular-nums"
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">Session Timeout (min)</span>
                  <input
                    type="number"
                    min={5}
                    max={480}
                    required
                    value={draftSettings.sessionTimeoutMinutes}
                    onChange={(e) =>
                      setDraftSettings({
                        ...draftSettings,
                        sessionTimeoutMinutes: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] rounded-md px-3 py-2 tabular-nums"
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">Inactive Disable (days)</span>
                  <input
                    type="number"
                    min={7}
                    max={365}
                    required
                    value={draftSettings.inactiveDisableDays}
                    onChange={(e) =>
                      setDraftSettings({
                        ...draftSettings,
                        inactiveDisableDays: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] rounded-md px-3 py-2 tabular-nums"
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">Audit Retention (years)</span>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    required
                    value={draftSettings.auditRetentionYears}
                    onChange={(e) =>
                      setDraftSettings({
                        ...draftSettings,
                        auditRetentionYears: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] rounded-md px-3 py-2 tabular-nums"
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">Max Plan Upload (MB)</span>
                  <input
                    type="number"
                    min={10}
                    max={2048}
                    required
                    value={draftSettings.maxPlanUploadMb}
                    onChange={(e) =>
                      setDraftSettings({
                        ...draftSettings,
                        maxPlanUploadMb: Number(e.target.value),
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] rounded-md px-3 py-2 tabular-nums"
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">Master Agreement Ver</span>
                  <input
                    type="text"
                    required
                    value={draftSettings.currentMasterAgreementVersion}
                    onChange={(e) =>
                      setDraftSettings({
                        ...draftSettings,
                        currentMasterAgreementVersion: e.target.value,
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] rounded-md px-3 py-2 font-mono"
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">PO Number Format</span>
                  <input
                    type="text"
                    required
                    value={draftSettings.poNumberFormat}
                    onChange={(e) =>
                      setDraftSettings({
                        ...draftSettings,
                        poNumberFormat: e.target.value,
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] rounded-md px-3 py-2 font-mono"
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="font-semibold text-[#3B3B38]">Warehouse Schedule (Cron)</span>
                  <input
                    type="text"
                    required
                    value={draftSettings.warehouseRefreshSchedule}
                    onChange={(e) =>
                      setDraftSettings({
                        ...draftSettings,
                        warehouseRefreshSchedule: e.target.value,
                      })
                    }
                    className="w-full min-h-[44px] sm:min-h-[38px] border border-[#E3E3DE] rounded-md px-3 py-2 font-mono"
                  />
                </label>
              </div>
              <label className="min-h-[44px] sm:min-h-0 inline-flex items-center gap-2 text-xs text-[#3B3B38] cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftSettings.requireMasterAgreement}
                  onChange={(e) =>
                    setDraftSettings({
                      ...draftSettings,
                      requireMasterAgreement: e.target.checked,
                    })
                  }
                  className="w-4 h-4"
                />
                <span>Require signed Master Subcontract Agreement before issuing POs</span>
              </label>
              <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2 border-t border-[#E3E3DE]">
                <button
                  type="button"
                  onClick={() => setEditingSettings(false)}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md border border-[#E3E3DE] bg-white font-semibold text-[#3B3B38] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-4 py-2 rounded-md bg-[#FCAE1A] text-[#111111] font-display font-bold hover:bg-[#E59C12] disabled:opacity-50 cursor-pointer"
                >
                  {savingSettings ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </form>
          ) : (
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
          )}
        </div>
      ) : null}

      {/* Immutable Audit Log */}
      <div className="bg-white border border-[#E3E3DE] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E3E3DE] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <h2 className="text-sm font-display font-bold">Immutable Audit Log (Read-Only)</h2>
          <span className="text-xs text-[#5F5F5A] tabular-nums">{auditLogs.length} events</span>
        </div>

        {/* Mobile Stacked Audit Log Cards */}
        <div className="md:hidden divide-y divide-[#E3E3DE]">
          {loading ? (
            <div className="p-4 text-xs text-[#5F5F5A] text-center">Loading audit log…</div>
          ) : auditLogs.length === 0 ? (
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
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-6 px-4 text-center text-[#5F5F5A]">
                    Loading audit log…
                  </td>
                </tr>
              ) : auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 px-4 text-center text-[#5F5F5A]">
                    No audit events recorded yet.
                  </td>
                </tr>
              ) : (
                auditLogs.map((row) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
