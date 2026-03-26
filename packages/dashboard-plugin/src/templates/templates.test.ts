import { describe, it, expect } from 'vitest';
import { TEMPLATES, getTemplate, listTemplates } from './index.js';
import { parseDashboard, serializeDashboard } from '../widgets/dashboard-model.js';

describe('Dashboard templates', () => {
  it('has at least 3 templates', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });

  it('each template has required fields', () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(t.definition.version).toBe(1);
      expect(t.definition.widgets.length).toBeGreaterThan(0);
    }
  });

  it('template definitions are valid (round-trip)', () => {
    for (const t of TEMPLATES) {
      // Fill in a dummy data source so parseDashboard validates
      const def = { ...t.definition, dataSources: ['test-ds'] };
      const json = serializeDashboard(def);
      const parsed = parseDashboard(json);
      expect(parsed.title).toBe(t.definition.title);
      expect(parsed.widgets.length).toBe(t.definition.widgets.length);
    }
  });

  it('getTemplate returns correct template', () => {
    const t = getTemplate('sales-overview');
    expect(t).toBeDefined();
    expect(t!.name).toBe('Sales Overview');
  });

  it('getTemplate returns undefined for unknown ID', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });

  it('listTemplates returns summary objects', () => {
    const list = listTemplates();
    expect(list.length).toBe(TEMPLATES.length);
    for (const item of list) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('description');
      expect(item).toHaveProperty('category');
      expect(item).not.toHaveProperty('definition');
    }
  });
});
