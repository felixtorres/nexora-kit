import * as semver from 'semver';
import type { PluginInstance } from '@nexora-kit/core';

export interface DependencyResolution {
  order: string[];
  missing: Array<{ from: string; requires: string; version: string }>;
  cycles: string[][];
}

export function resolveDependencies(plugins: Map<string, PluginInstance>): DependencyResolution {
  const missing: DependencyResolution['missing'] = [];
  const cycles: string[][] = [];

  // Build adjacency list (plugin → its dependencies)
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const [ns] of plugins) {
    adjacency.set(ns, []);
    inDegree.set(ns, 0);
  }

  for (const [ns, plugin] of plugins) {
    for (const dep of plugin.manifest.dependencies) {
      const depPlugin = plugins.get(dep.namespace);
      if (!depPlugin) {
        missing.push({ from: ns, requires: dep.namespace, version: dep.version });
        continue;
      }

      if (!semver.satisfies(depPlugin.manifest.version, dep.version)) {
        missing.push({ from: ns, requires: dep.namespace, version: dep.version });
        continue;
      }

      // dep.namespace → ns (ns depends on dep.namespace)
      adjacency.get(dep.namespace)!.push(ns);
      inDegree.set(ns, (inDegree.get(ns) ?? 0) + 1);
    }
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  for (const [ns, degree] of inDegree) {
    if (degree === 0) queue.push(ns);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // Detect cycles: any node not in the order is part of a cycle
  if (order.length < plugins.size) {
    const inCycle = new Set<string>();
    for (const [ns] of plugins) {
      if (!order.includes(ns)) inCycle.add(ns);
    }
    if (inCycle.size > 0) {
      cycles.push([...inCycle]);
    }
  }

  return { order, missing, cycles };
}
