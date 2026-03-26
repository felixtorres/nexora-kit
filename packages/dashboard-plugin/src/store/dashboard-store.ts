/**
 * In-memory DashboardStore implementation.
 *
 * For production, this would be backed by SQLite/PostgreSQL.
 * The in-memory version is used for testing and development.
 */

import type {
  DashboardStoreInterface,
  StoredDashboard,
  DashboardShare,
  CreateDashboardInput,
} from './types.js';

export class InMemoryDashboardStore implements DashboardStoreInterface {
  private dashboards = new Map<string, StoredDashboard>();
  private shares = new Map<string, DashboardShare>();
  private tokenIndex = new Map<string, string>(); // token → share id

  async create(input: CreateDashboardInput): Promise<StoredDashboard> {
    const now = new Date().toISOString();
    const dashboard: StoredDashboard = {
      id: crypto.randomUUID(),
      title: input.title,
      ownerId: input.ownerId,
      teamId: input.teamId,
      definition: input.definition,
      refreshInterval: input.refreshInterval,
      createdAt: now,
      updatedAt: now,
    };
    this.dashboards.set(dashboard.id, dashboard);
    return dashboard;
  }

  async get(id: string): Promise<StoredDashboard | null> {
    return this.dashboards.get(id) ?? null;
  }

  async getByToken(token: string): Promise<{ dashboard: StoredDashboard; share: DashboardShare } | null> {
    const shareId = this.tokenIndex.get(token);
    if (!shareId) return null;
    const share = this.shares.get(shareId);
    if (!share) return null;

    // Check expiry
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return null;
    }

    const dashboard = this.dashboards.get(share.dashboardId);
    if (!dashboard) return null;
    return { dashboard, share };
  }

  async list(teamId: string): Promise<StoredDashboard[]> {
    return [...this.dashboards.values()].filter((d) => d.teamId === teamId);
  }

  async update(
    id: string,
    updates: Partial<Pick<StoredDashboard, 'title' | 'definition' | 'refreshInterval' | 'cachedResults' | 'lastRefreshedAt'>>,
  ): Promise<StoredDashboard | null> {
    const existing = this.dashboards.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    this.dashboards.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    // Cascade delete shares
    for (const [shareId, share] of this.shares.entries()) {
      if (share.dashboardId === id) {
        this.tokenIndex.delete(share.token);
        this.shares.delete(shareId);
      }
    }
    return this.dashboards.delete(id);
  }

  async createShare(dashboardId: string, expiresAt?: string): Promise<DashboardShare> {
    const dashboard = this.dashboards.get(dashboardId);
    if (!dashboard) {
      throw new Error(`Dashboard '${dashboardId}' not found`);
    }

    const share: DashboardShare = {
      id: crypto.randomUUID(),
      dashboardId,
      token: crypto.randomUUID(),
      permissions: 'read-only',
      expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.shares.set(share.id, share);
    this.tokenIndex.set(share.token, share.id);
    return share;
  }

  async getShare(token: string): Promise<DashboardShare | null> {
    const shareId = this.tokenIndex.get(token);
    if (!shareId) return null;
    return this.shares.get(shareId) ?? null;
  }

  async deleteShare(id: string): Promise<boolean> {
    const share = this.shares.get(id);
    if (share) {
      this.tokenIndex.delete(share.token);
    }
    return this.shares.delete(id);
  }

  async listShares(dashboardId: string): Promise<DashboardShare[]> {
    return [...this.shares.values()].filter((s) => s.dashboardId === dashboardId);
  }

  async listDueForRefresh(): Promise<StoredDashboard[]> {
    const now = Date.now();
    return [...this.dashboards.values()].filter((d) => {
      if (!d.refreshInterval) return false;
      if (!d.lastRefreshedAt) return true;
      const elapsed = (now - new Date(d.lastRefreshedAt).getTime()) / 1000;
      return elapsed >= d.refreshInterval;
    });
  }
}
