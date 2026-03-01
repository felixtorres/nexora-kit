export type SandboxOperation =
  | { type: 'fs'; action: 'read' | 'write'; path: string }
  | { type: 'network'; action: 'connect'; host: string; port: number }
  | { type: 'env'; action: 'read'; key: string }
  | { type: 'secret'; action: 'read'; key: string }
  | { type: 'exec'; action: 'spawn'; command: string }
  | { type: 'code'; action: 'execute'; language: string };

export type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export type PermissionRule = string; // e.g., 'fs:read', 'network:connect', 'code:execute'

export class PermissionGate {
  private grants = new Map<string, Set<string>>();

  grant(pluginNamespace: string, permission: PermissionRule): void {
    let perms = this.grants.get(pluginNamespace);
    if (!perms) {
      perms = new Set();
      this.grants.set(pluginNamespace, perms);
    }
    perms.add(permission);
  }

  revoke(pluginNamespace: string, permission: PermissionRule): void {
    this.grants.get(pluginNamespace)?.delete(permission);
  }

  check(pluginNamespace: string, operation: SandboxOperation): PermissionResult {
    const perms = this.grants.get(pluginNamespace);
    const required = `${operation.type}:${operation.action}`;

    if (!perms) {
      return { allowed: false, reason: `Plugin '${pluginNamespace}' lacks permission '${required}'` };
    }

    if (!perms.has(required)) {
      return {
        allowed: false,
        reason: `Plugin '${pluginNamespace}' lacks permission '${required}'`,
      };
    }

    return { allowed: true };
  }

  listPermissions(pluginNamespace: string): PermissionRule[] {
    return [...(this.grants.get(pluginNamespace) ?? [])];
  }

  clearAll(pluginNamespace: string): void {
    this.grants.delete(pluginNamespace);
  }
}
