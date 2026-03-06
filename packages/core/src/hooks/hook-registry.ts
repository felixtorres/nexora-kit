import type { HookEventName } from './hook-events.js';

export interface HookConfig {
  command: string;
  args?: string[];
}

export interface RegisteredHook {
  namespace: string;
  event: HookEventName;
  config: HookConfig;
  /** Skill-scoped hooks are active only while the skill is active. */
  skillScoped?: string;
}

/**
 * Registry for plugin and skill hooks.
 *
 * Hooks are disabled by default. An admin must explicitly enable hook execution
 * per plugin via the `enableHooksForNamespace()` method. When disabled, hooks
 * are stored but never fired.
 */
export class HookRegistry {
  private hooks: RegisteredHook[] = [];
  private enabledNamespaces = new Set<string>();

  /**
   * Register hooks from a plugin or skill.
   */
  register(namespace: string, event: HookEventName, config: HookConfig, skillScoped?: string): void {
    this.hooks.push({ namespace, event, config, skillScoped });
  }

  /**
   * Unregister all hooks for a namespace.
   */
  unregisterNamespace(namespace: string): void {
    this.hooks = this.hooks.filter((h) => h.namespace !== namespace);
  }

  /**
   * Unregister skill-scoped hooks for a specific skill.
   */
  unregisterSkillHooks(namespace: string, skillName: string): void {
    this.hooks = this.hooks.filter(
      (h) => !(h.namespace === namespace && h.skillScoped === skillName),
    );
  }

  /**
   * Enable hook execution for a namespace (admin action).
   */
  enableHooksForNamespace(namespace: string): void {
    this.enabledNamespaces.add(namespace);
  }

  /**
   * Disable hook execution for a namespace.
   */
  disableHooksForNamespace(namespace: string): void {
    this.enabledNamespaces.delete(namespace);
  }

  /**
   * Check if hooks are enabled for a namespace.
   */
  isEnabled(namespace: string): boolean {
    return this.enabledNamespaces.has(namespace);
  }

  /**
   * Get all hooks that should fire for a given event.
   * Only returns hooks from enabled namespaces.
   */
  getHooksForEvent(event: HookEventName, activeSkills?: string[]): RegisteredHook[] {
    return this.hooks.filter((h) => {
      if (h.event !== event) return false;
      if (!this.enabledNamespaces.has(h.namespace)) return false;
      // Skill-scoped hooks only fire when the skill is active
      if (h.skillScoped && (!activeSkills || !activeSkills.includes(h.skillScoped))) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get all registered hooks (regardless of enabled state).
   */
  listAll(): RegisteredHook[] {
    return [...this.hooks];
  }
}
