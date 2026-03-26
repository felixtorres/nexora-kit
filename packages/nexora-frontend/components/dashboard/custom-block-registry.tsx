'use client';

import type { ComponentType } from 'react';
import type { CustomBlock } from '@/lib/block-types';
import { ChartWidget } from './ChartWidget';
import type { ChartWidgetData } from './ChartWidget';
import { KpiCard } from './KpiCard';
import type { KpiCardData } from './KpiCard';
import { DataTable } from './DataTable';
import type { DataTableData } from './DataTable';
import { DashboardGrid } from './DashboardGrid';
import type { DashboardGridData } from './DashboardGrid';
import { FilterBar } from './FilterBar';
import type { FilterBarData } from './FilterBar';

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

function DashboardKpiBlock({ block }: CustomBlockComponentProps) {
  return <KpiCard data={block.data as KpiCardData} />;
}

function DashboardTableBlock({ block }: CustomBlockComponentProps) {
  return <DataTable data={block.data as DataTableData} />;
}

function DashboardGridBlock({ block }: CustomBlockComponentProps) {
  return <DashboardGrid data={block.data as DashboardGridData} />;
}

registry.set('custom:dashboard/chart', DashboardChartBlock);
registry.set('custom:dashboard/kpi', DashboardKpiBlock);
registry.set('custom:dashboard/table', DashboardTableBlock);
registry.set('custom:dashboard/grid', DashboardGridBlock);

function DashboardFilterBlock({ block }: CustomBlockComponentProps) {
  return <FilterBar data={block.data as FilterBarData} />;
}

registry.set('custom:dashboard/filter', DashboardFilterBlock);

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
