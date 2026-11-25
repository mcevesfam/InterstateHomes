'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Home,
  Calculator,
  FileText,
  FileSignature,
  DollarSign,
  MessageSquareWarning,
  Users,
  ShieldAlert,
  Sheet,
  ListOrdered,
  Settings,
  LogOut,
  ShieldCheck,
  Sparkles,
  MessageSquarePlus,
  Menu,
  X,
  AlertCircle,
  RefreshCw,
  KeyRound,
  Copy,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { ROLE_LABELS, canAccess, type UserRole } from '@interstate/shared';
import { apiFetch } from '@/lib/api';
import { InterstateLogo } from './InterstateLogo';
import { AppErrorBoundary } from './AppErrorBoundary';
import { FeedbackWidget } from './FeedbackWidget';
import { useRole } from '@/lib/role-context';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeTone?: 'amber' | 'red';
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

interface BottomTabItem {
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: 'drawer';
}

interface DashboardBadges {
  quotesOut: number;
  countersToReview: number;
  posAwaitingSign: number;
  complianceAlerts: number;
  openClarifications: number;
}

const EMPTY_BADGES: DashboardBadges = {
  quotesOut: 0,
  countersToReview: 0,
  posAwaitingSign: 0,
  complianceAlerts: 0,
  openClarifications: 0,
};

function AccountSecurityModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { role, subCompanyId, user, refreshSession } = useRole();
  const [tab, setTab] = useState<'mfa' | 'password'>('mfa');

  // MFA state
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaSuccess, setMfaSuccess] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<'secret' | 'uri' | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSetupSecret(null);
      setOtpauthUri(null);
      setMfaCode('');
      setMfaError(null);
      setMfaSuccess(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwdError(null);
      setPwdSuccess(null);
      return;
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !mfaBusy && !pwdBusy) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, mfaBusy, pwdBusy, onClose]);

  if (!open) return null;

  async function handleStartMfaSetup() {
    setMfaBusy(true);
    setMfaError(null);
    setMfaSuccess(null);
    try {
      const res = await apiFetch<{ secret: string; otpauthUri: string }>('/api/auth/mfa/setup', {
        method: 'POST',
        role,
        subCompanyId,
      });
      setSetupSecret(res.secret);
      setOtpauthUri(res.otpauthUri);
      setMfaCode('');
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : 'Unable to start MFA setup.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleVerifyMfa(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const normalized = mfaCode.replace(/\D/g, '');
    if (normalized.length !== 6) {
      setMfaError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setMfaBusy(true);
    setMfaError(null);
    setMfaSuccess(null);
    try {
      await apiFetch('/api/auth/mfa/verify', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({ code: normalized, token: normalized }),
      });
      setSetupSecret(null);
      setOtpauthUri(null);
      setMfaCode('');
      await refreshSession();
      setMfaSuccess('Two-factor authentication is now active on your account.');
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : 'Invalid 6-digit verification code.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (!currentPassword || !newPassword) {
      setPwdError('Enter both your current password and a new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 12) {
      setPwdError('New password must be at least 12 characters long.');
      return;
    }

    setPwdBusy(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        role,
        subCompanyId,
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwdSuccess('Password updated successfully.');
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setPwdBusy(false);
    }
  }

  async function copyText(value: string, key: 'secret' | 'uri') {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore clipboard restrictions
    }
  }

  return (
    <div
      data-print-hide="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !mfaBusy && !pwdBusy) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-security-title"
        className="w-full max-w-lg max-h-[90dvh] bg-white border border-[#E3E3DE] rounded-xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="bg-[#111111] text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-md bg-[#FCAE1A] text-[#111111] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 id="account-security-title" className="font-display text-sm font-bold truncate">
                Account Security
              </h2>
              {user?.email ? (
                <div className="text-[11px] text-[#9D9D97] truncate">{user.email}</div>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Account Security"
            className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 inline-flex items-center justify-center p-1.5 rounded text-[#C9CED8] hover:text-white hover:bg-[#262624] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 border-b border-[#E3E3DE] bg-[#F4F4F1] text-xs font-display font-semibold shrink-0">
          <button
            type="button"
            onClick={() => setTab('mfa')}
            className={`min-h-[44px] py-2.5 text-center transition-colors cursor-pointer ${
              tab === 'mfa'
                ? 'bg-white text-[#111111] border-b-2 border-[#FCAE1A]'
                : 'text-[#5F5F5A] hover:text-[#111111]'
            }`}
          >
            Two-Factor Auth (MFA)
          </button>
          <button
            type="button"
            onClick={() => setTab('password')}
            className={`min-h-[44px] py-2.5 text-center transition-colors cursor-pointer ${
              tab === 'password'
                ? 'bg-white text-[#111111] border-b-2 border-[#FCAE1A]'
                : 'text-[#5F5F5A] hover:text-[#111111]'
            }`}
          >
            Change Password
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {tab === 'mfa' ? (
            <>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[#E3E3DE] bg-[#FAFAF8] px-4 py-3">
                <div>
                  <div className="text-xs font-display font-bold text-[#111111]">
                    Authenticator App (TOTP)
                  </div>
                  <div className="text-xs text-[#5F5F5A] mt-0.5">
                    Works with Google Authenticator, 1Password, Microsoft Authenticator, or Authy.
                  </div>
                </div>
                <span
                  className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                    user?.mfaEnabled
                      ? 'bg-[#DCFCE7] text-[#166534]'
                      : 'bg-[#FEF3C7] text-[#8A5A00]'
                  }`}
                >
                  {user?.mfaEnabled ? 'Enabled' : 'Not Set Up'}
                </span>
              </div>

              {mfaSuccess ? (
                <div className="flex items-start gap-2 rounded-lg border border-[#86EFAC] bg-[#DCFCE7] px-3.5 py-2.5 text-xs text-[#166534]">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{mfaSuccess}</span>
                </div>
              ) : null}

              {mfaError ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#991B1B]"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{mfaError}</span>
                </div>
              ) : null}

              {!setupSecret ? (
                <button
                  type="button"
                  onClick={handleStartMfaSetup}
                  disabled={mfaBusy}
                  className="w-full min-h-[44px] rounded-lg bg-[#111111] hover:bg-[#262624] text-white font-display text-xs font-semibold px-4 py-2.5 transition-colors disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  <KeyRound className="w-4 h-4 text-[#FCAE1A]" />
                  <span>
                    {mfaBusy
                      ? 'Generating setup key…'
                      : user?.mfaEnabled
                      ? 'Rotate Authenticator Key'
                      : 'Enroll Authenticator App'}
                  </span>
                </button>
              ) : (
                <form onSubmit={handleVerifyMfa} className="space-y-4">
                  <div className="rounded-lg border border-[#E3E3DE] bg-[#FAFAF8] p-3.5 space-y-3">
                    <div className="text-xs font-semibold text-[#111111]">
                      1. Add this setup key to your authenticator app:
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 min-w-0 break-all rounded bg-white border border-[#D4D4CE] px-3 py-2 font-mono text-xs text-[#111111]">
                        {setupSecret}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyText(setupSecret, 'secret')}
                        className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded border border-[#D4D4CE] bg-white hover:bg-[#F4F4F1] text-[#111111] cursor-pointer shrink-0"
                        aria-label="Copy setup key"
                      >
                        {copiedKey === 'secret' ? (
                          <Check className="w-4 h-4 text-[#166534]" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {otpauthUri ? (
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#5F5F5A]">
                        <span className="truncate">URI: {otpauthUri}</span>
                        <button
                          type="button"
                          onClick={() => void copyText(otpauthUri, 'uri')}
                          className="min-h-[36px] px-2 font-semibold text-[#111111] hover:underline shrink-0 cursor-pointer"
                        >
                          {copiedKey === 'uri' ? 'Copied' : 'Copy URI'}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <label
                      htmlFor="security-mfa-code"
                      className="block text-xs font-display font-semibold uppercase tracking-[0.08em] text-[#3B3B38] mb-1.5"
                    >
                      2. Enter 6-Digit Verification Code
                    </label>
                    <input
                      id="security-mfa-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      disabled={mfaBusy}
                      className="w-full min-h-[44px] rounded-lg border border-[#D4D4CE] bg-white px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.3em] tabular-nums text-[#111111] focus:outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#FCAE1A]/40"
                    />
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSetupSecret(null);
                        setOtpauthUri(null);
                        setMfaError(null);
                      }}
                      disabled={mfaBusy}
                      className="min-h-[44px] flex-1 rounded-lg border border-[#D4D4CE] bg-white hover:bg-[#F4F4F1] text-xs font-display font-semibold text-[#111111] cursor-pointer"
                    >
                      Cancel Setup
                    </button>
                    <button
                      type="submit"
                      disabled={mfaBusy || mfaCode.length !== 6}
                      className="min-h-[44px] flex-1 rounded-lg bg-[#FCAE1A] hover:bg-[#E59B0C] text-[#111111] text-xs font-display font-bold disabled:opacity-50 cursor-pointer"
                    >
                      {mfaBusy ? 'Verifying…' : 'Verify & Enable MFA'}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <form onSubmit={handleChangePassword} className="space-y-4" noValidate>
              {pwdSuccess ? (
                <div className="flex items-start gap-2 rounded-lg border border-[#86EFAC] bg-[#DCFCE7] px-3.5 py-2.5 text-xs text-[#166534]">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{pwdSuccess}</span>
                </div>
              ) : null}

              {pwdError ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#991B1B]"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{pwdError}</span>
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="sec-current-password"
                  className="block text-xs font-display font-semibold uppercase tracking-[0.08em] text-[#3B3B38] mb-1.5"
                >
                  Current Password
                </label>
                <input
                  id="sec-current-password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={pwdBusy}
                  className="w-full min-h-[44px] rounded-lg border border-[#D4D4CE] bg-white px-3.5 py-2.5 text-sm text-[#111111] focus:outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#FCAE1A]/40"
                />
              </div>

              <div>
                <label
                  htmlFor="sec-new-password"
                  className="block text-xs font-display font-semibold uppercase tracking-[0.08em] text-[#3B3B38] mb-1.5"
                >
                  New Password (min 12 chars)
                </label>
                <div className="relative">
                  <input
                    id="sec-new-password"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    disabled={pwdBusy}
                    className="w-full min-h-[44px] rounded-lg border border-[#D4D4CE] bg-white pl-3.5 pr-12 py-2.5 text-sm text-[#111111] focus:outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#FCAE1A]/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    aria-label={showPwd ? 'Hide passwords' : 'Show passwords'}
                    className="absolute inset-y-0 right-0 min-w-[44px] min-h-[44px] flex items-center justify-center text-[#5F5F5A] hover:text-[#111111] cursor-pointer"
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="sec-confirm-password"
                  className="block text-xs font-display font-semibold uppercase tracking-[0.08em] text-[#3B3B38] mb-1.5"
                >
                  Confirm New Password
                </label>
                <input
                  id="sec-confirm-password"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={pwdBusy}
                  className="w-full min-h-[44px] rounded-lg border border-[#D4D4CE] bg-white px-3.5 py-2.5 text-sm text-[#111111] focus:outline-none focus:border-[#111111] focus:ring-2 focus:ring-[#FCAE1A]/40"
                />
              </div>

              <button
                type="submit"
                disabled={pwdBusy}
                className="w-full min-h-[44px] rounded-lg bg-[#111111] hover:bg-[#262624] text-white font-display text-xs font-semibold px-4 py-2.5 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {pwdBusy ? 'Updating Password…' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    role,
    setRole,
    subCompanyId,
    authMode,
    user,
    authenticated,
    loading,
    authError,
    retryAuth,
    logout,
  } = useRole();
  const [signingOut, setSigningOut] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [pendingFeedbackCount, setPendingFeedbackCount] = useState(0);
  const [badges, setBadges] = useState<DashboardBadges>(EMPTY_BADGES);

  const isAuthRoute = pathname === '/login' || pathname.startsWith('/login/');

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Close mobile drawer on Escape and lock body scroll while open
  useEffect(() => {
    if (!mobileNavOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileNavOpen]);

  // Hydrate live sidebar badges from /api/dashboard/summary (no hardcoded counts)
  useEffect(() => {
    if (isAuthRoute || loading || authError || (authMode === 'postgres' && !authenticated)) {
      return;
    }

    let cancelled = false;
    const loadBadges = () => {
      apiFetch<{ kpis?: Partial<DashboardBadges> }>('/api/dashboard/summary', {
        role,
        subCompanyId,
      })
        .then((res) => {
          if (cancelled) return;
          setBadges({
            quotesOut: res.kpis?.quotesOut ?? 0,
            countersToReview: res.kpis?.countersToReview ?? 0,
            posAwaitingSign: res.kpis?.posAwaitingSign ?? 0,
            complianceAlerts: res.kpis?.complianceAlerts ?? 0,
            openClarifications: res.kpis?.openClarifications ?? 0,
          });
        })
        .catch(() => {
          if (!cancelled) setBadges(EMPTY_BADGES);
        });
    };

    loadBadges();
    window.addEventListener('interstate:dashboard-updated', loadBadges);
    return () => {
      cancelled = true;
      window.removeEventListener('interstate:dashboard-updated', loadBadges);
    };
  }, [isAuthRoute, loading, authError, authMode, authenticated, role, subCompanyId, pathname]);

  // Admin pending feedback count (only fetch when role can manage feedback)
  useEffect(() => {
    if (
      isAuthRoute ||
      loading ||
      authError ||
      (authMode === 'postgres' && !authenticated) ||
      !canAccess(role, 'feedback:manage')
    ) {
      setPendingFeedbackCount(0);
      return;
    }

    const loadFeedbackSummary = () => {
      apiFetch<{ pendingApprovalCount: number }>('/api/feedback/summary', { role, subCompanyId })
        .then((res) => setPendingFeedbackCount(res.pendingApprovalCount ?? 0))
        .catch(() => {});
    };
    loadFeedbackSummary();
    window.addEventListener('interstate:feedback-updated', loadFeedbackSummary);
    return () => window.removeEventListener('interstate:feedback-updated', loadFeedbackSummary);
  }, [isAuthRoute, loading, authError, authMode, authenticated, role, subCompanyId]);

  useEffect(() => {
    if (!isAuthRoute && !loading && !authError && authMode === 'postgres' && !authenticated) {
      router.replace('/login');
    }
  }, [isAuthRoute, loading, authError, authMode, authenticated, router]);

  useEffect(() => {
    if (
      !isAuthRoute &&
      !loading &&
      !authError &&
      (authMode === 'demo' || authenticated) &&
      role === 'subcontractor' &&
      pathname === '/'
    ) {
      router.replace('/portal');
    }
  }, [isAuthRoute, loading, authError, authMode, authenticated, role, pathname, router]);

  // Do not wrap /login in the sidebar AppShell
  if (isAuthRoute) {
    return <>{children}</>;
  }

  // Prevent flashing protected content or firing unauthenticated API calls while checking session
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F4F1] text-[#111111] gap-4">
        <InterstateLogo variant="light" />
        <div className="text-xs font-display uppercase tracking-[0.14em] text-[#5F5F5A]">
          Verifying session…
        </div>
      </div>
    );
  }

  // Clean auth-unavailable retry gate (never fall back silently to Demo Role Switcher)
  if (authError) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#F4F4F1] text-[#111111] p-6">
        <div className="w-full max-w-md bg-white border border-[#E3E3DE] rounded-xl shadow-sm p-6 sm:p-8 space-y-5 text-center">
          <div className="flex justify-center">
            <InterstateLogo variant="light" />
          </div>
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[#FEF2F2] text-[#991B1B] mx-auto">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-lg font-bold text-[#111111]">
              Unable to Verify Session
            </h1>
            <p className="text-sm text-[#5F5F5A] leading-relaxed">{authError}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => void retryAuth()}
              className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#111111] hover:bg-[#262624] text-white font-display text-xs font-semibold px-4 py-2.5 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4 text-[#FCAE1A]" />
              <span>Retry Connection</span>
            </button>
            <Link
              href="/login"
              className="min-h-[44px] flex-1 inline-flex items-center justify-center rounded-lg border border-[#D4D4CE] bg-white hover:bg-[#F4F4F1] text-[#111111] font-display text-xs font-semibold px-4 py-2.5 transition-colors"
            >
              Go to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (authMode === 'postgres' && !authenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F4F1] text-[#111111] gap-4">
        <InterstateLogo variant="light" />
        <div className="text-xs font-display uppercase tracking-[0.14em] text-[#5F5F5A]">
          Redirecting to sign in…
        </div>
      </div>
    );
  }

  if (role === 'subcontractor' && pathname === '/') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F4F1] text-[#111111] gap-4">
        <InterstateLogo variant="light" />
        <div className="text-xs font-display uppercase tracking-[0.14em] text-[#5F5F5A]">
          Opening Subcontractor Portal…
        </div>
      </div>
    );
  }

  const canManageAdmin = canAccess(role, 'users:manage') || canAccess(role, 'audit_log:view');
  const canBuildEstimates = canAccess(role, 'estimates:build');
  const canWorkQuotes = canAccess(role, 'quotes:issue') || canAccess(role, 'quotes:decide');
  const canEditPriceSheets = canAccess(role, 'price_sheets:edit_any');
  const canManageFeedback = canAccess(role, 'feedback:manage');

  const internalGroups: NavGroup[] = [
    {
      heading: 'ESTIMATING',
      items: [
        { label: 'Dashboard', href: '/', icon: LayoutDashboard },
        { label: 'Homes & Plans', href: '/homes', icon: Home },
        ...(canBuildEstimates
          ? [{ label: 'Estimates', href: '/estimates', icon: Calculator }]
          : []),
        ...(canWorkQuotes
          ? [
              {
                label: 'Quotes & Review',
                href: '/quotes',
                icon: FileText,
                badge: badges.countersToReview > 0 ? badges.countersToReview : undefined,
                badgeTone: 'amber' as const,
              },
            ]
          : []),
      ],
    },
    {
      heading: 'SUBCONTRACTS',
      items: [
        { label: 'Purchase Orders', href: '/purchase-orders', icon: FileSignature },
        ...(canAccess(role, 'budgets:view')
          ? [{ label: 'Budgets', href: '/budgets', icon: DollarSign }]
          : []),
        ...(canAccess(role, 'clarifications:view')
          ? [
              {
                label: 'Clarifications',
                href: '/clarifications',
                icon: MessageSquareWarning,
                badge: badges.openClarifications > 0 ? badges.openClarifications : undefined,
                badgeTone: 'amber' as const,
              },
            ]
          : []),
      ],
    },
    {
      heading: 'VENDORS',
      items: [
        { label: 'Subcontractors', href: '/subcontractors', icon: Users },
        {
          label: 'Compliance',
          href: '/compliance',
          icon: ShieldAlert,
          badge: badges.complianceAlerts > 0 ? badges.complianceAlerts : undefined,
          badgeTone: 'red' as const,
        },
        ...(canEditPriceSheets
          ? [{ label: 'Price Sheets', href: '/price-sheets', icon: Sheet }]
          : []),
      ],
    },
    {
      heading: 'SETUP',
      items: [
        { label: 'Cost Codes (81)', href: '/cost-codes', icon: ListOrdered },
        ...(canManageAdmin
          ? [{ label: 'Users, Settings & Audit', href: '/admin', icon: Settings }]
          : []),
        {
          label: canManageFeedback ? 'Feedback & Plans' : 'My Feedback',
          href: '/feedback',
          icon: Sparkles,
          badge: canManageFeedback && pendingFeedbackCount > 0 ? pendingFeedbackCount : undefined,
          badgeTone: 'amber' as const,
        },
      ],
    },
  ].filter((g) => g.items.length > 0);

  const subPortalGroups: NavGroup[] = [
    {
      heading: 'SUBCONTRACTOR PORTAL',
      items: [
        { label: 'Portal Overview', href: '/portal', icon: LayoutDashboard },
        {
          label: 'My Quotes',
          href: '/quotes',
          icon: FileText,
          badge: badges.quotesOut > 0 ? badges.quotesOut : undefined,
          badgeTone: 'amber',
        },
        {
          label: 'POs & Agreements',
          href: '/purchase-orders',
          icon: FileSignature,
          badge: badges.posAwaitingSign > 0 ? badges.posAwaitingSign : undefined,
          badgeTone: 'amber',
        },
        { label: 'Price Sheets', href: '/price-sheets', icon: Sheet },
        {
          label: 'Compliance Docs',
          href: '/compliance',
          icon: ShieldAlert,
          badge: badges.complianceAlerts > 0 ? badges.complianceAlerts : undefined,
          badgeTone: 'red',
        },
        {
          label: 'Clarifications',
          href: '/clarifications',
          icon: MessageSquareWarning,
          badge: badges.openClarifications > 0 ? badges.openClarifications : undefined,
          badgeTone: 'amber',
        },
        { label: 'My Feedback', href: '/feedback', icon: MessageSquarePlus },
      ],
    },
  ];

  const groups = role === 'subcontractor' ? subPortalGroups : internalGroups;

  const bottomTabs: BottomTabItem[] =
    role === 'subcontractor'
      ? [
          { label: 'Overview', href: '/portal', icon: LayoutDashboard },
          { label: 'Quotes', href: '/quotes', icon: FileText },
          { label: 'POs', href: '/purchase-orders', icon: FileSignature },
          { label: 'Compliance', href: '/compliance', icon: ShieldAlert },
          { label: 'More', icon: Menu, action: 'drawer' },
        ]
      : [
          { label: 'Dashboard', href: '/', icon: LayoutDashboard },
          { label: 'Homes', href: '/homes', icon: Home },
          { label: 'POs', href: '/purchase-orders', icon: FileSignature },
          { label: 'Clarify', href: '/clarifications', icon: MessageSquareWarning },
          { label: 'More', icon: Menu, action: 'drawer' },
        ];

  const directBottomHrefs = new Set(bottomTabs.map((t) => t.href).filter(Boolean));
  const MOBILE_ROLE_LABELS: Record<UserRole, string> = {
    admin: 'Admin',
    estimator_approver: 'Estimator',
    project_manager: 'Project Mgr',
    subcontractor: 'Subcontractor',
    homeowner: 'Homeowner',
  };
  const mobileRoleLabel = MOBILE_ROLE_LABELS[role] ?? ROLE_LABELS[role] ?? role;

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await logout();
      router.replace('/login');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F4F4F1] text-[#111111]">
      {/* Mobile Sticky Top Header (< md) */}
      <header
        data-print-hide="true"
        className="md:hidden sticky top-0 z-40 h-14 bg-[#111111] text-white px-3.5 flex items-center justify-between gap-2 border-b border-[#2C2C2A]"
      >
        <Link href={role === 'subcontractor' ? '/portal' : '/'} className="shrink-0">
          <InterstateLogo variant="dark" />
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <span className="shrink-0 whitespace-nowrap text-[10px] font-display font-semibold uppercase tracking-[0.04em] px-2 py-1 rounded bg-[#1C1C1A] border border-[#2C2C2A] text-[#FCAE1A]">
            {mobileRoleLabel}
          </span>
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            aria-controls="primary-navigation-drawer"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md bg-[#1C1C1A] border border-[#2C2C2A] text-white hover:bg-[#262624] transition-colors cursor-pointer shrink-0"
          >
            {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Drawer Backdrop (z-[55] above FeedbackWidget FAB z-50) */}
      {mobileNavOpen ? (
        <div
          data-print-hide="true"
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
          className="md:hidden fixed inset-0 z-[55] bg-black/50 backdrop-blur-[1px]"
        />
      ) : null}

      {/* Dark #111111 Slide-Over Drawer (z-[60] on <md) & Persistent Desktop Sidebar (md+) */}
      <aside
        id="primary-navigation-drawer"
        data-print-hide="true"
        aria-label="Primary navigation"
        className={`${
          mobileNavOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'
        } fixed inset-y-0 left-0 z-[60] h-[100dvh] w-72 max-w-[85vw] flex flex-col overflow-hidden bg-[#111111] text-white border-r border-[#2C2C2A] transition-transform duration-200 ease-out md:sticky md:top-0 md:h-screen md:z-auto md:w-60 md:max-w-none md:translate-x-0 md:pointer-events-auto md:flex shrink-0`}
      >
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Mobile Drawer Header */}
          <div className="md:hidden shrink-0 h-14 px-4 flex items-center justify-between border-b border-[#2C2C2A]">
            <InterstateLogo variant="dark" />
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation menu"
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-md text-[#C9CED8] hover:text-white hover:bg-[#1C1C1A] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Desktop Sidebar Header */}
          <div className="hidden md:block shrink-0 px-5 pt-5 pb-4 border-b border-[#2C2C2A]">
            <InterstateLogo variant="dark" />
            <div className="text-[11px] text-[#9D9D97] mt-2 tracking-wide">
              Estimating &amp; Budgets
            </div>
          </div>

          <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
            {groups.map((group) => (
              <div key={group.heading}>
                <div className="px-2.5 mb-1.5 text-[10px] font-display font-semibold tracking-[0.12em] text-[#9D9D97]">
                  {group.heading}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => setMobileNavOpen(false)}
                          className={`flex items-center justify-between min-h-[44px] md:min-h-0 px-2.5 py-2 rounded-md text-[13px] transition-colors ${
                            active
                              ? 'bg-[#262624] text-white font-semibold ring-1 ring-inset ring-[#FCAE1A]/40'
                              : 'text-[#C9CED8] hover:bg-[#1C1C1A] hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <Icon
                              className={`w-4 h-4 ${
                                active ? 'text-[#FCAE1A]' : 'opacity-80'
                              }`}
                            />
                            <span>{item.label}</span>
                          </span>
                          {item.badge ? (
                            <span
                              className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full leading-none tabular-nums ${
                                item.badgeTone === 'red'
                                  ? 'bg-[#7F1D1D] text-[#FECACA]'
                                  : 'bg-[#FCAE1A]/20 text-[#FCAE1A]'
                              }`}
                            >
                              {item.badge}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Footer: Authenticated Session Panel (Postgres mode) OR Role Preview Switcher (Demo mode) */}
        {authMode === 'postgres' && user ? (
          <div className="shrink-0 p-3.5 border-t border-[#2C2C2A] bg-[#0B0B0A] space-y-2.5 safe-bottom md:pb-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">{user.fullName}</div>
                <div className="text-[11px] text-[#9D9D97] truncate">{user.email}</div>
              </div>
              {user.mfaEnabled ? (
                <span
                  title="MFA Protected Session"
                  className="shrink-0 inline-flex items-center text-[#FCAE1A]"
                >
                  <ShieldCheck className="w-4 h-4" />
                </span>
              ) : null}
            </div>
            <div className="inline-block text-[10px] font-display uppercase tracking-[0.08em] px-2 py-0.5 rounded bg-[#1C1C1A] border border-[#2C2C2A] text-[#FCAE1A]">
              {ROLE_LABELS[user.role] ?? user.role}
            </div>
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  setSecurityModalOpen(true);
                }}
                className="w-full min-h-[44px] md:min-h-0 flex items-center justify-center gap-2 px-2.5 py-2 md:py-1.5 rounded text-xs font-semibold bg-[#1C1C1A] hover:bg-[#262624] border border-[#2C2C2A] text-[#FCAE1A] transition-colors cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Account Security</span>
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-full min-h-[44px] md:min-h-0 flex items-center justify-center gap-2 px-2.5 py-2 md:py-1.5 rounded text-xs font-semibold bg-[#1C1C1A] hover:bg-[#262624] border border-[#2C2C2A] text-[#E3E3DE] hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{signingOut ? 'Signing out…' : 'Sign Out'}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="shrink-0 p-3.5 border-t border-[#2C2C2A] bg-[#0B0B0A] safe-bottom md:pb-3.5">
            <label
              htmlFor="active-role-view-select"
              className="block text-[10px] font-display uppercase tracking-[0.1em] text-[#9D9D97] mb-1.5"
            >
              Active Role View
            </label>
            <select
              id="active-role-view-select"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="w-full min-h-[44px] md:min-h-0 bg-[#1C1C1A] border border-[#2C2C2A] rounded px-2.5 py-2 md:py-1.5 text-xs text-white focus:outline-none focus:border-[#FCAE1A]"
            >
              <option value="estimator_approver">{ROLE_LABELS.estimator_approver}</option>
              <option value="project_manager">{ROLE_LABELS.project_manager}</option>
              <option value="subcontractor">{ROLE_LABELS.subcontractor}</option>
              <option value="admin">{ROLE_LABELS.admin}</option>
            </select>
            <div className="mt-2 text-[10px] text-[#9D9D97]">
              {role === 'project_manager' && 'Profit, land & margin hidden (Sec 4)'}
              {role === 'subcontractor' && 'Scoped to Red Cliffs Drywall'}
              {role === 'estimator_approver' && 'Full estimating & PO approval'}
              {role === 'admin' && 'Full system & audit access'}
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Canvas */}
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-4 pb-24 md:p-6 md:pb-6 max-w-[1440px] w-full mx-auto">
          <AppErrorBoundary>{children}</AppErrorBoundary>
        </main>
      </div>

      {/* Mobile Sticky Bottom Tab Bar (< md) */}
      <nav
        data-print-hide="true"
        aria-label="Mobile quick navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#111111] text-white border-t border-[#2C2C2A] safe-bottom"
      >
        <div className="grid grid-cols-5 px-1 pt-1">
          {bottomTabs.map((tab) => {
            const Icon = tab.icon;
            if (tab.action === 'drawer') {
              const moreActive = mobileNavOpen || !directBottomHrefs.has(pathname);
              return (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open full navigation menu"
                  aria-expanded={mobileNavOpen}
                  className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-[10px] font-display transition-colors cursor-pointer ${
                    moreActive ? 'text-[#FCAE1A] font-semibold' : 'text-[#C9CED8] hover:text-white'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="leading-none truncate max-w-full">{tab.label}</span>
                </button>
              );
            }

            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href!}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1 text-[10px] font-display transition-colors ${
                  active ? 'text-[#FCAE1A] font-semibold' : 'text-[#C9CED8] hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="leading-none truncate max-w-full">{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <FeedbackWidget />
      <AccountSecurityModal
        open={securityModalOpen}
        onClose={() => setSecurityModalOpen(false)}
      />
    </div>
  );
}
