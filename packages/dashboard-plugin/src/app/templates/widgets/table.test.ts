import { describe, it, expect } from 'vitest';
import { renderTableWidget } from './table.js';
import type { AppTableWidget } from '../../types.js';

const TABLE: AppTableWidget = {
  id: 'tbl-orders',
  type: 'table',
  title: 'Recent Orders',
  query: { dataSourceId: 'db', sql: 'SELECT * FROM orders' },
  columns: [
    { key: 'date', label: 'Date' },
    { key: 'customer', label: 'Customer' },
    { key: 'amount', label: 'Amount' },
  ],
  sortable: true,
  size: { col: 1, row: 4, width: 12, height: 4 },
};

const DATA = [
  { date: '2026-03-26', customer: 'Acme Corp', amount: 12400 },
  { date: '2026-03-25', customer: 'Globex', amount: 8200 },
];

describe('renderTableWidget', () => {
  it('contains a <table> element', () => {
    const html = renderTableWidget(TABLE, DATA);
    expect(html).toContain('<table');
    expect(html).toContain('class="widget-table"');
  });

  it('renders column headers', () => {
    const html = renderTableWidget(TABLE, DATA);
    expect(html).toContain('Date');
    expect(html).toContain('Customer');
    expect(html).toContain('Amount');
  });

  it('renders row data', () => {
    const html = renderTableWidget(TABLE, DATA);
    expect(html).toContain('Acme Corp');
    expect(html).toContain('8200');
  });

  it('escapes HTML in cell values', () => {
    const xssData = [{ date: '2026-01-01', customer: '<img onerror="alert(1)">', amount: 0 }];
    const html = renderTableWidget(TABLE, xssData);
    // Table cell content should be escaped
    expect(html).toContain('<td>&lt;img onerror');
  });

  it('handles empty rows array', () => {
    const html = renderTableWidget(TABLE, []);
    expect(html).toContain('<table');
    expect(html).toContain('0 rows');
  });

  it('includes sortable class when sortable is true', () => {
    const html = renderTableWidget(TABLE, DATA);
    expect(html).toContain('sortable');
    expect(html).toContain('__sortTable');
  });

  it('omits sortable class when sortable is false', () => {
    const nonSortable = { ...TABLE, sortable: false };
    const html = renderTableWidget(nonSortable, DATA);
    // Headers should not have sortable class
    expect(html).not.toContain('class=" sortable"');
    expect(html).not.toContain('__sortTable');
  });

  it('shows pagination when rows exceed pageSize', () => {
    const smallPage = { ...TABLE, pageSize: 1 };
    const html = renderTableWidget(smallPage, DATA);
    expect(html).toContain('Showing 1-1 of 2');
  });
});
