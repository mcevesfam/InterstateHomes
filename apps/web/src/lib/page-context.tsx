'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { PageContext } from '@interstate/shared';
import { useRole } from './role-context';
import { initClientTelemetry, recordRouteChange } from './telemetry';

export interface PageContextRegistration {
  section?: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
  summary?: Record<string, string | number | boolean | null>;
}

const DEFAULT_SECTION_BY_PATH: Record<string, string> = {
  '/': 'Dashboard',
  '/homes': 'Homes & Plans',
  '/estimates': 'Estimates',
  '/quotes': 'Quotes & Review',
  '/purchase-orders': 'Purchase Orders',
  '/budgets': 'Budgets',
  '/clarifications': 'Clarifications',
  '/subcontractors': 'Subcontractors',
  '/compliance': 'Compliance',
  '/price-sheets': 'Price Sheets',
  '/cost-codes': 'Cost Codes',
  '/admin': 'Admin Console',
  '/portal': 'Subcontractor Portal',
  '/feedback': 'Feedback & Fix Plans',
};

interface PageContextStoreValue {
  pageContext: PageContext;
  setPageMeta: (meta: PageContextRegistration | null) => void;
}

const PageContextReactContext = createContext<PageContextStoreValue | null>(null);

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const { role, authMode } = useRole();
  const [pageMeta, setPageMetaState] = useState<PageContextRegistration | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number } | undefined>(undefined);

  useEffect(() => {
    initClientTelemetry();
    const updateViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    recordRouteChange(pathname);
    setPageMetaState(null);
  }, [pathname]);

  const setPageMeta = useCallback((meta: PageContextRegistration | null) => {
    setPageMetaState(meta);
  }, []);

  const pageContext = useMemo<PageContext>(() => {
    const isBrowser = typeof window !== 'undefined';
    return {
      pathname,
      search: isBrowser ? window.location.search : '',
      pageTitle: isBrowser ? document.title : 'Interstate Homes',
      section: pageMeta?.section || DEFAULT_SECTION_BY_PATH[pathname] || pathname,
      entityType: pageMeta?.entityType,
      entityId: pageMeta?.entityId,
      entityLabel: pageMeta?.entityLabel,
      summary: pageMeta?.summary,
      viewport,
      userAgent: isBrowser ? navigator.userAgent.slice(0, 300) : undefined,
      appRole: role,
      authMode,
    };
  }, [pathname, pageMeta, viewport, role, authMode]);

  const value = useMemo(() => ({ pageContext, setPageMeta }), [pageContext, setPageMeta]);

  return (
    <PageContextReactContext.Provider value={value}>
      {children}
    </PageContextReactContext.Provider>
  );
}

export function usePageContext(meta: PageContextRegistration | null) {
  const ctx = useContext(PageContextReactContext);
  const serialized = meta ? JSON.stringify(meta) : '';

  useEffect(() => {
    if (!ctx) return;
    ctx.setPageMeta(serialized ? (JSON.parse(serialized) as PageContextRegistration) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, ctx?.setPageMeta]);
}

export function useCurrentPageContext(): PageContext {
  const ctx = useContext(PageContextReactContext);
  if (!ctx) {
    return {
      pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
      section: 'Workspace',
    };
  }
  return ctx.pageContext;
}
