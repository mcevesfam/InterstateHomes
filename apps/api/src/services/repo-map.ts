export interface RouteFileMapping {
  webFiles: string[];
  apiFiles: string[];
  schemaFiles: string[];
  notes: string;
}

export const ROUTE_FILE_MAP: Record<string, RouteFileMapping> = {
  '/': {
    webFiles: ['apps/web/src/app/page.tsx', 'apps/web/src/components/AppShell.tsx'],
    apiFiles: ['apps/api/src/routes/dashboard.ts'],
    schemaFiles: ['apps/api/src/db/schema/homes.ts', 'apps/api/src/db/schema/estimating.ts'],
    notes: 'Executive & operational dashboard with Needs Attention queue; respects financials:view_internal.',
  },
  '/homes': {
    webFiles: ['apps/web/src/app/homes/page.tsx'],
    apiFiles: ['apps/api/src/routes/homes.ts'],
    schemaFiles: ['apps/api/src/db/schema/homes.ts'],
    notes: 'Homes list and Plan Intake form; redacts soldAmountCents for PM/subcontractor.',
  },
  '/estimates': {
    webFiles: ['apps/web/src/app/estimates/page.tsx'],
    apiFiles: ['apps/api/src/routes/estimates.ts', 'apps/api/src/routes/cost-codes.ts'],
    schemaFiles: ['apps/api/src/db/schema/estimating.ts', 'apps/api/src/db/schema/master.ts'],
    notes: '81-code estimate builder, competing sub quote selection, Internal vs Homeowner PDF projection.',
  },
  '/quotes': {
    webFiles: ['apps/web/src/app/quotes/page.tsx'],
    apiFiles: ['apps/api/src/routes/quotes.ts'],
    schemaFiles: ['apps/api/src/db/schema/estimating.ts'],
    notes: 'Subcontractor quote responses/counters and Estimator/Admin accept/reject decisions.',
  },
  '/purchase-orders': {
    webFiles: ['apps/web/src/app/purchase-orders/page.tsx'],
    apiFiles: ['apps/api/src/routes/purchase-orders.ts', 'apps/api/src/services/docuseal.ts'],
    schemaFiles: ['apps/api/src/db/schema/estimating.ts', 'apps/api/src/db/schema/subcontractors.ts'],
    notes: 'PO issuance gated by COI/W-9/license/MSA compliance rules; DocuSeal e-sign + recent reauth check.',
  },
  '/budgets': {
    webFiles: ['apps/web/src/app/budgets/page.tsx'],
    apiFiles: ['apps/api/src/routes/budgets.ts'],
    schemaFiles: ['apps/api/src/db/schema/estimating.ts'],
    notes: 'Job cost budget preview and live approval handoff; hides 00L/88/92/93 from PM.',
  },
  '/clarifications': {
    webFiles: ['apps/web/src/app/clarifications/page.tsx'],
    apiFiles: ['apps/api/src/routes/clarifications.ts'],
    schemaFiles: ['apps/api/src/db/schema/estimating.ts'],
    notes: 'Scope gap, plan conflict, and price dispute clarification items.',
  },
  '/subcontractors': {
    webFiles: ['apps/web/src/app/subcontractors/page.tsx'],
    apiFiles: ['apps/api/src/routes/subcontractors.ts'],
    schemaFiles: ['apps/api/src/db/schema/subcontractors.ts'],
    notes: 'Vendor directory, trade coverage, W-9 masked TINs (AES-256-GCM encrypted at rest).',
  },
  '/compliance': {
    webFiles: ['apps/web/src/app/compliance/page.tsx'],
    apiFiles: ['apps/api/src/routes/subcontractors.ts', 'apps/api/src/services/storage.ts'],
    schemaFiles: ['apps/api/src/db/schema/subcontractors.ts'],
    notes: 'COI GL/Auto/Workers Comp/W-9/Utah license/Master Agreement compliance status.',
  },
  '/price-sheets': {
    webFiles: ['apps/web/src/app/price-sheets/page.tsx'],
    apiFiles: ['apps/api/src/routes/subcontractors.ts'],
    schemaFiles: ['apps/api/src/db/schema/subcontractors.ts'],
    notes: 'Unit price sheets scoped by subcontractor.',
  },
  '/cost-codes': {
    webFiles: ['apps/web/src/app/cost-codes/page.tsx'],
    apiFiles: ['apps/api/src/routes/cost-codes.ts'],
    schemaFiles: ['apps/api/src/db/schema/master.ts'],
    notes: '81 canonical text cost codes across 11 classifications (never numeric-cast "03" or "00L").',
  },
  '/admin': {
    webFiles: ['apps/web/src/app/admin/page.tsx'],
    apiFiles: ['apps/api/src/routes/admin.ts'],
    schemaFiles: ['apps/api/src/db/schema/auth.ts', 'apps/api/src/db/schema/warehouse.ts'],
    notes: 'System settings, user list, warehouse refresh, and immutable audit log.',
  },
  '/portal': {
    webFiles: ['apps/web/src/app/portal/page.tsx'],
    apiFiles: ['apps/api/src/routes/quotes.ts', 'apps/api/src/routes/purchase-orders.ts', 'apps/api/src/routes/subcontractors.ts'],
    schemaFiles: ['apps/api/src/db/schema/subcontractors.ts', 'apps/api/src/db/schema/estimating.ts'],
    notes: 'Subcontractor Portal overview strictly scoped to actor.subCompanyId.',
  },
  '/feedback': {
    webFiles: ['apps/web/src/app/feedback/page.tsx', 'apps/web/src/components/FeedbackWidget.tsx'],
    apiFiles: ['apps/api/src/routes/feedback.ts', 'apps/api/src/services/feedback-ai.ts'],
    schemaFiles: ['apps/api/src/db/schema/feedback.ts'],
    notes: 'Closed-loop feedback widget, AI fix-plan approval queue, and GitHub Issue dispatch.',
  },
};

export const INTERSTATE_REPO_MAP = `
Interstate Homes Monorepo (apps/web, apps/api, packages/shared):
- Frontend: Next.js 15 App Router + React 19 + Tailwind CSS v4 (apps/web/src/app/*/page.tsx).
  - Shell & Auth: apps/web/src/components/AppShell.tsx, apps/web/src/lib/role-context.tsx, apps/web/src/lib/api.ts, apps/web/src/app/api/[...path]/route.ts (Next.js runtime proxy to Fastify).
  - Feedback & Telemetry: apps/web/src/lib/telemetry.ts, apps/web/src/lib/page-context.tsx, apps/web/src/components/FeedbackWidget.tsx, apps/web/src/app/feedback/page.tsx.
- Backend: Fastify v5 + Drizzle ORM + PostgreSQL (plus DEMO_MODE=true in-memory apps/api/src/data/demo-store.ts).
  - Core app & security: apps/api/src/app.ts, apps/api/src/security/auth-plugin.ts, apps/api/src/security/audit.ts, apps/api/src/security/crypto.ts.
  - Routes: health.ts, auth.ts, dashboard.ts, cost-codes.ts, homes.ts, subcontractors.ts, estimates.ts, quotes.ts, purchase-orders.ts, budgets.ts, clarifications.ts, admin.ts, feedback.ts.
  - Services: storage.ts (GCS/S3/mock), docuseal.ts, email.ts (Resend/console), server-log-buffer.ts, feedback-ai.ts, github-issues.ts.
- Shared: packages/shared/src/cost-codes.ts, roles.ts (RBAC matrix), business-rules.ts, schemas.ts, redaction.ts, feedback.ts.
- Critical Domain Invariants:
  1. Cost codes MUST remain text strings ("03", "00L") everywhere.
  2. Internal cost codes (00L, 88, 92, 93) and soldAmountCents MUST be hidden when !canAccess(role, 'financials:view_internal').
  3. Subcontractor queries MUST scope strictly to request.actor.subCompanyId.
  4. PO issuance MUST enforce compliance rules (COI GL/Auto/WC, W-9, license, MSA) server-side; signing requires recent reauth.
  5. Both Postgres mode and DEMO_MODE=true must stay in parity.
`.trim();

export function lookupFilesForRoute(pathname: string, failedPaths: string[] = []): {
  webFiles: string[];
  apiFiles: string[];
  schemaFiles: string[];
  notes: string;
} {
  const cleanPath = pathname.split('?')[0] || '/';
  const direct = ROUTE_FILE_MAP[cleanPath] ?? ROUTE_FILE_MAP['/']!;
  const apiSet = new Set(direct.apiFiles);

  for (const apiPath of failedPaths) {
    if (apiPath.includes('/purchase-orders')) apiSet.add('apps/api/src/routes/purchase-orders.ts');
    else if (apiPath.includes('/estimates')) apiSet.add('apps/api/src/routes/estimates.ts');
    else if (apiPath.includes('/quotes')) apiSet.add('apps/api/src/routes/quotes.ts');
    else if (apiPath.includes('/budgets')) apiSet.add('apps/api/src/routes/budgets.ts');
    else if (apiPath.includes('/homes')) apiSet.add('apps/api/src/routes/homes.ts');
    else if (apiPath.includes('/subcontractors') || apiPath.includes('/compliance')) {
      apiSet.add('apps/api/src/routes/subcontractors.ts');
    } else if (apiPath.includes('/clarifications')) apiSet.add('apps/api/src/routes/clarifications.ts');
    else if (apiPath.includes('/admin')) apiSet.add('apps/api/src/routes/admin.ts');
    else if (apiPath.includes('/auth')) apiSet.add('apps/api/src/routes/auth.ts');
  }

  return {
    webFiles: direct.webFiles,
    apiFiles: Array.from(apiSet),
    schemaFiles: direct.schemaFiles,
    notes: direct.notes,
  };
}
