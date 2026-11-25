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
} from 'lucide-react';
import { ROLE_LABELS, type UserRole } from '@interstate/shared';
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { role, setRole, subCompanyId, authMode, user, authenticated, loading, logout } = useRole();
  const [signingOut, setSigningOut] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [pendingFeedbackCount, setPendingFeedbackCount] = useState(0);

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

  useEffect(() => {
    if (isAuthRoute || loading || (authMode === 'postgres' && !authenticated)) return;
    const loadFeedbackSummary = () => {
      apiFetch<{ pendingApprovalCount: number }>('/api/feedback/summary', { role, subCompanyId })
        .then((res) => setPendingFeedbackCount(res.pendingApprovalCount ?? 0))
        .catch(() => {});
    };
    loadFeedbackSummary();
    window.addEventListener('interstate:feedback-updated', loadFeedbackSummary);
    return () => window.removeEventListener('interstate:feedback-updated', loadFeedbackSummary);
  }, [isAuthRoute, loading, authMode, authenticated, role, subCompanyId]);

  useEffect(() => {
    if (!isAuthRoute && !loading && authMode === 'postgres' && !authenticated) {
      router.replace('/login');
    }
  }, [isAuthRoute, loading, authMode, authenticated, router]);

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

  if (!loading && authMode === 'postgres' && !authenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F4F1] text-[#111111] gap-4">
        <InterstateLogo variant="light" />
        <div className="text-xs font-display uppercase tracking-[0.14em] text-[#5F5F5A]">
          Redirecting to sign in…
        </div>
      </div>
    );
  }

  const internalGroups: NavGroup[] = [
    {
      heading: 'ESTIMATING',
      items: [
        { label: 'Dashboard', href: '/', icon: LayoutDashboard },
        { label: 'Homes & Plans', href: '/homes', icon: Home },
        { label: 'Estimates', href: '/estimates', icon: Calculator },
        { label: 'Quotes & Review', href: '/quotes', icon: FileText, badge: 1, badgeTone: 'amber' },
      ],
    },
    {
      heading: 'SUBCONTRACTS',
      items: [
        { label: 'Purchase Orders', href: '/purchase-orders', icon: FileSignature },
        { label: 'Budgets', href: '/budgets', icon: DollarSign },
        { label: 'Clarifications', href: '/clarifications', icon: MessageSquareWarning, badge: 1, badgeTone: 'amber' },
      ],
    },
    {
      heading: 'VENDORS',
      items: [
        { label: 'Subcontractors', href: '/subcontractors', icon: Users },
        { label: 'Compliance', href: '/compliance', icon: ShieldAlert, badge: 1, badgeTone: 'red' },
        { label: 'Price Sheets', href: '/price-sheets', icon: Sheet },
      ],
    },
    {
      heading: 'SETUP',
      items: [
        { label: 'Cost Codes (81)', href: '/cost-codes', icon: ListOrdered },
        { label: 'Users, Settings & Audit', href: '/admin', icon: Settings },
        {
          label: role === 'admin' ? 'Feedback & Plans' : 'My Feedback',
          href: '/feedback',
          icon: Sparkles,
          badge: role === 'admin' && pendingFeedbackCount > 0 ? pendingFeedbackCount : undefined,
          badgeTone: 'amber',
        },
      ],
    },
  ];

  const subPortalGroups: NavGroup[] = [
    {
      heading: 'SUBCONTRACTOR PORTAL',
      items: [
        { label: 'Portal Overview', href: '/portal', icon: LayoutDashboard },
        { label: 'My Quotes', href: '/quotes', icon: FileText, badge: 1, badgeTone: 'amber' },
        { label: 'POs & Agreements', href: '/purchase-orders', icon: FileSignature },
        { label: 'Price Sheets', href: '/price-sheets', icon: Sheet },
        { label: 'Compliance Docs', href: '/compliance', icon: ShieldAlert },
        { label: 'Clarifications', href: '/clarifications', icon: MessageSquareWarning },
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
  const activeRoleLabel = ROLE_LABELS[role] ?? role;

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
        <div className="flex items-center gap-2 min-w-0">
          <span className="max-w-[128px] truncate text-[10px] font-display font-semibold uppercase tracking-[0.06em] px-2 py-1 rounded bg-[#1C1C1A] border border-[#2C2C2A] text-[#FCAE1A]">
            {activeRoleLabel}
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

      {/* Mobile Drawer Backdrop */}
      {mobileNavOpen ? (
        <div
          data-print-hide="true"
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
          className="md:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px]"
        />
      ) : null}

      {/* Dark #111111 Slide-Over Drawer (< md) & Persistent Desktop Sidebar (md+) */}
      <aside
        id="primary-navigation-drawer"
        data-print-hide="true"
        aria-label="Primary navigation"
        className={`${
          mobileNavOpen ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none'
        } fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex flex-col justify-between bg-[#111111] text-white border-r border-[#2C2C2A] overflow-y-auto transition-transform duration-200 ease-out md:static md:inset-auto md:z-auto md:w-60 md:max-w-none md:translate-x-0 md:pointer-events-auto md:flex shrink-0`}
      >
        <div>
          {/* Mobile Drawer Header */}
          <div className="md:hidden h-14 px-4 flex items-center justify-between border-b border-[#2C2C2A]">
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
          <div className="hidden md:block px-5 pt-5 pb-4 border-b border-[#2C2C2A]">
            <InterstateLogo variant="dark" />
            <div className="text-[11px] text-[#9D9D97] mt-2 tracking-wide">
              Estimating &amp; Budgets
            </div>
          </div>

          <nav className="px-3 py-4 space-y-5">
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
          <div className="p-3.5 border-t border-[#2C2C2A] bg-[#0B0B0A] space-y-2.5 safe-bottom md:pb-3.5">
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
        ) : (
          <div className="p-3.5 border-t border-[#2C2C2A] bg-[#0B0B0A] safe-bottom md:pb-3.5">
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
    </div>
  );
}
