import type { IAuditEventStore, AuditEvent, AuditEventFilter } from '@nexora-kit/storage';

export class AuditLogger {
  private readonly store: IAuditEventStore;

  constructor(store: IAuditEventStore) {
    this.store = store;
  }

  log(event: Omit<AuditEvent, 'id' | 'createdAt'>): number | Promise<number> {
    return this.store.insert(event);
  }

  logPluginInstall(
    actor: string,
    namespace: string,
    details?: Record<string, unknown>,
  ): number | Promise<number> {
    return this.log({
      actor,
      action: 'plugin.install',
      target: `plugin:${namespace}`,
      details,
      result: 'success',
    });
  }

  logPluginUninstall(actor: string, namespace: string): number | Promise<number> {
    return this.log({
      actor,
      action: 'plugin.uninstall',
      target: `plugin:${namespace}`,
      result: 'success',
    });
  }

  logPluginEnable(actor: string, namespace: string): number | Promise<number> {
    return this.log({
      actor,
      action: 'plugin.enable',
      target: `plugin:${namespace}`,
      result: 'success',
    });
  }

  logPluginDisable(actor: string, namespace: string): number | Promise<number> {
    return this.log({
      actor,
      action: 'plugin.disable',
      target: `plugin:${namespace}`,
      result: 'success',
    });
  }

  logConfigChange(
    actor: string,
    key: string,
    details?: Record<string, unknown>,
  ): number | Promise<number> {
    return this.log({
      actor,
      action: 'config.update',
      target: `config:${key}`,
      details,
      result: 'success',
    });
  }

  logFailure(
    actor: string,
    action: string,
    target: string,
    error: string,
  ): number | Promise<number> {
    return this.log({
      actor,
      action,
      target,
      details: { error },
      result: 'failure',
    });
  }

  query(filter?: AuditEventFilter): AuditEvent[] | Promise<AuditEvent[]> {
    return this.store.query(filter);
  }

  purge(retentionDays: number): number | Promise<number> {
    return this.store.deleteOlderThan(retentionDays);
  }
}
