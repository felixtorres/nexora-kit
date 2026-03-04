import type { ToolHandler } from '@nexora-kit/core';
import type { SkillDefinition, SkillInfo } from './types.js';

export class SkillRegistry {
  private skills = new Map<string, SkillInfo>();

  register(qualifiedName: string, definition: SkillDefinition, namespace: string, handler: ToolHandler): void {
    if (this.skills.has(qualifiedName)) {
      throw new Error(`Skill '${qualifiedName}' is already registered`);
    }
    this.skills.set(qualifiedName, { qualifiedName, definition, namespace, handler });
  }

  get(qualifiedName: string): SkillInfo | undefined {
    return this.skills.get(qualifiedName);
  }

  unregister(qualifiedName: string): void {
    this.skills.delete(qualifiedName);
  }

  unregisterNamespace(namespace: string): void {
    for (const [key, info] of this.skills) {
      if (info.namespace === namespace) {
        this.skills.delete(key);
      }
    }
  }

  listForModel(): SkillInfo[] {
    return [...this.skills.values()].filter(
      (s) => s.definition.invocation === 'model' || s.definition.invocation === 'both',
    );
  }

  listForUser(): SkillInfo[] {
    return [...this.skills.values()].filter(
      (s) => s.definition.invocation === 'user' || s.definition.invocation === 'both',
    );
  }

  listByNamespace(namespace: string): SkillInfo[] {
    return [...this.skills.values()].filter((s) => s.namespace === namespace);
  }

  list(): SkillInfo[] {
    return [...this.skills.values()];
  }

  has(qualifiedName: string): boolean {
    return this.skills.has(qualifiedName);
  }
}
