'use client';

import type { ComponentType } from 'react';
import type { CustomBlock } from '@/lib/block-types';
import { ChartWidget } from './ChartWidget';
import type { ChartWidgetData } from './ChartWidget';

type CustomBlockComponentProps = { block: CustomBlock };

/**
 * Registry mapping custom block types to their renderer components.
 * Plugins register their block types here.
 */
const registry = new Map<string, ComponentType<CustomBlockComponentProps>>();

// ── Built-in registrations ─────────────────────────────────────────────

function DashboardChartBlock({ block }: CustomBlockComponentProps) {
  return <ChartWidget data={block.data as ChartWidgetData} />;
}

registry.set('custom:dashboard/chart', DashboardChartBlock);

// ── Public API ─────────────────────────────────────────────────────────

export function registerCustomBlock(
  type: `custom:${string}`,
  component: ComponentType<CustomBlockComponentProps>,
): void {
  registry.set(type, component);
}

export function getCustomBlockRenderer(
  type: string,
): ComponentType<CustomBlockComponentProps> | undefined {
  return registry.get(type);
}

/**
 * Renders a custom block if a renderer is registered, otherwise returns null.
 */
export function CustomBlockRenderer({ block }: { block: CustomBlock }) {
  const Component = registry.get(block.type);
  if (!Component) return null;
  return <Component block={block} />;
}
