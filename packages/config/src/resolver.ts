import { z } from 'zod';

export enum ConfigLayer {
  InstanceDefaults = 1,
  PluginDefaults = 2,
  UserPreferences = 3,
}

export interface ConfigContext {
  pluginNamespace?: string;
  userId?: string;
}

export interface ConfigEntry {
  key: string;
  value: unknown;
  layer: ConfigLayer;
  pluginNamespace?: string;
  userId?: string;
}

export class ConfigResolver {
  private entries: ConfigEntry[] = [];
  private schemas = new Map<string, z.ZodSchema>();

  set(key: string, value: unknown, layer: ConfigLayer, context?: Partial<ConfigContext>): void {
    const schema = this.schemas.get(key);
    if (schema) {
      const result = schema.safeParse(value);
      if (!result.success) {
        throw new Error(`Config validation failed for '${key}': ${result.error.message}`);
      }
    }

    // Remove existing entry at same layer+context
    this.entries = this.entries.filter(
      (e) =>
        !(
          e.key === key &&
          e.layer === layer &&
          e.pluginNamespace === context?.pluginNamespace &&
          e.userId === context?.userId
        ),
    );

    this.entries.push({
      key,
      value,
      layer,
      pluginNamespace: context?.pluginNamespace,
      userId: context?.userId,
    });
  }

  get<T>(key: string, context: ConfigContext): T | undefined {
    // Find all matching entries, sorted by layer (highest priority first)
    const candidates = this.entries
      .filter((e) => e.key === key && this.matchesContext(e, context))
      .sort((a, b) => b.layer - a.layer);

    return candidates[0]?.value as T | undefined;
  }

  getRequired<T>(key: string, context: ConfigContext): T {
    const value = this.get<T>(key, context);
    if (value === undefined) {
      throw new Error(`Required config key '${key}' not found for context ${JSON.stringify(context)}`);
    }
    return value;
  }

  registerSchema(key: string, schema: z.ZodSchema): void {
    this.schemas.set(key, schema);
  }

  getAll(context: ConfigContext): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const keys = new Set(this.entries.map((e) => e.key));
    for (const key of keys) {
      const value = this.get(key, context);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  private matchesContext(entry: ConfigEntry, context: ConfigContext): boolean {
    switch (entry.layer) {
      case ConfigLayer.InstanceDefaults:
        return true;

      case ConfigLayer.PluginDefaults:
        return !entry.pluginNamespace || entry.pluginNamespace === context.pluginNamespace;

      case ConfigLayer.UserPreferences:
        return !entry.userId || entry.userId === context.userId;

      default:
        return false;
    }
  }
}
