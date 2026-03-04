import type { SkillRegistry } from './registry.js';
import { buildSkillIndex, type BuildSkillIndexOptions } from './skill-index.js';

export class SkillIndexAdapter {
  private readonly registry: SkillRegistry;
  private readonly pluginDocs = new Map<string, string>();
  private readonly disabledNamespaces = new Set<string>();

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  buildIndex(namespace: string): string {
    if (this.disabledNamespaces.has(namespace)) return '';

    const skills = this.registry.listByNamespace(namespace);
    const options: BuildSkillIndexOptions = {};
    const docs = this.pluginDocs.get(namespace);
    if (docs) {
      options.pluginDocs = docs;
    }
    return buildSkillIndex(skills, namespace, options);
  }

  setPluginDocs(namespace: string, docs: string): void {
    this.pluginDocs.set(namespace, docs);
  }

  disableForNamespace(namespace: string): void {
    this.disabledNamespaces.add(namespace);
  }
}
