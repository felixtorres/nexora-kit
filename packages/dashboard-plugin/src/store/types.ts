/**
 * DashboardStore types.
 *
 * Standalone dashboards that outlive conversations.
 * Promoted from conversation-scoped artifacts via convertArtifactToDashboard().
 */

export interface StoredDashboard {
  id: string;
  title: string;
  ownerId: string;
  teamId: string;
  definition: string;       // JSON DashboardDefinition
  refreshInterval?: number; // seconds, null = manual only
  lastRefreshedAt?: string;
  cachedResults?: string;   // JSON — pre-computed widget data for shared views
  createdAt: string;
  updatedAt: string;
}

export interface DashboardShare {
  id: string;
  dashboardId: string;
  token: string;
  permissions: 'read-only';
  expiresAt?: string;
  createdAt: string;
}

export interface CreateDashboardInput {
  title: string;
  ownerId: string;
  teamId: string;
  definition: string;
  refreshInterval?: number;
}

export interface DashboardStoreInterface {
  create(input: CreateDashboardInput): Promise<StoredDashboard>;
  get(id: string): Promise<StoredDashboard | null>;
  getByToken(token: string): Promise<{ dashboard: StoredDashboard; share: DashboardShare } | null>;
  list(teamId: string): Promise<StoredDashboard[]>;
  update(id: string, updates: Partial<Pick<StoredDashboard, 'title' | 'definition' | 'refreshInterval' | 'cachedResults' | 'lastRefreshedAt'>>): Promise<StoredDashboard | null>;
  delete(id: string): Promise<boolean>;

  // Sharing
  createShare(dashboardId: string, expiresAt?: string): Promise<DashboardShare>;
  getShare(token: string): Promise<DashboardShare | null>;
  deleteShare(id: string): Promise<boolean>;
  listShares(dashboardId: string): Promise<DashboardShare[]>;

  // Refresh
  listDueForRefresh(): Promise<StoredDashboard[]>;
}
