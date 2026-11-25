export type UserRole =
  | 'admin'
  | 'estimator_approver'
  | 'project_manager'
  | 'subcontractor'
  | 'homeowner'; // Reserved for Phase 3 (Section 4.1)

export type Permission =
  | 'users:manage'
  | 'roles:manage'
  | 'cost_codes:manage'
  | 'templates:manage'
  | 'settings:manage'
  | 'audit_log:view'
  | 'plans:intake'
  | 'takeoffs:edit'
  | 'estimates:build'
  | 'estimates:approve'
  | 'estimates:export_homeowner'
  | 'quotes:issue'
  | 'quotes:decide'
  | 'quotes:respond_own'
  | 'price_sheets:edit_any'
  | 'price_sheets:edit_own'
  | 'compliance:review'
  | 'compliance:upload_own'
  | 'pos:issue'
  | 'pos:sign_approver'
  | 'pos:sign_sub'
  | 'budgets:approve'
  | 'budgets:view'
  | 'financials:view_internal' // Margin, profit (93), land (00L), real estate fees (88), overhead (92), sold amount
  | 'clarifications:view'
  | 'clarifications:create'
  | 'feedback:create'
  | 'feedback:view_own'
  | 'feedback:manage';

const ROLE_PERMISSIONS: Record<UserRole, Set<Permission>> = {
  admin: new Set<Permission>([
    'users:manage',
    'roles:manage',
    'cost_codes:manage',
    'templates:manage',
    'settings:manage',
    'audit_log:view',
    'plans:intake',
    'takeoffs:edit',
    'estimates:build',
    'estimates:approve',
    'estimates:export_homeowner',
    'quotes:issue',
    'quotes:decide',
    'price_sheets:edit_any',
    'compliance:review',
    'pos:issue',
    'pos:sign_approver',
    'budgets:approve',
    'budgets:view',
    'financials:view_internal',
    'clarifications:view',
    'clarifications:create',
    'feedback:create',
    'feedback:view_own',
    'feedback:manage',
  ]),
  estimator_approver: new Set<Permission>([
    // Cannot change agreement templates, user roles, or edit signed quote pricing
    'plans:intake',
    'takeoffs:edit',
    'estimates:build',
    'estimates:approve',
    'estimates:export_homeowner',
    'quotes:issue',
    'quotes:decide',
    'price_sheets:edit_any',
    'pos:issue',
    'pos:sign_approver',
    'budgets:approve',
    'budgets:view',
    'financials:view_internal',
    'clarifications:view',
    'clarifications:create',
    'feedback:create',
    'feedback:view_own',
  ]),
  project_manager: new Set<Permission>([
    // Superintendents/field: view budget, POs, signed agreements; log clarifications; NO margin/profit/land/sold or approvals
    'budgets:view',
    'clarifications:view',
    'clarifications:create',
    'feedback:create',
    'feedback:view_own',
  ]),
  subcontractor: new Set<Permission>([
    // Only own company records
    'quotes:respond_own',
    'price_sheets:edit_own',
    'compliance:upload_own',
    'pos:sign_sub',
    'clarifications:view',
    'clarifications:create',
    'feedback:create',
    'feedback:view_own',
  ]),
  homeowner: new Set<Permission>([]),
};

export function canAccess(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  estimator_approver: 'Estimator / Approver',
  project_manager: 'Project Manager / Field',
  subcontractor: 'Subcontractor Portal',
  homeowner: 'Homeowner (Phase 3)',
};
