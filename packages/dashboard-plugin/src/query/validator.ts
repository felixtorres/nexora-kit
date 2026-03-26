/**
 * SQL query validator.
 *
 * Validates LLM-generated SQL before execution:
 * - Rejects write statements (INSERT, UPDATE, DELETE, DROP, etc.)
 * - Rejects multi-statement queries
 * - Validates against table allowlist and column blocklist
 */

import type { QueryConstraints } from '../data-sources/types.js';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// Statements that modify data or schema
const WRITE_PATTERNS = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bDROP\b/i,
  /\bALTER\b/i,
  /\bTRUNCATE\b/i,
  /\bCREATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bEXECUTE\b/i,
  /\bCALL\b/i,
  /\bCOPY\b/i,
  /\bSET\s+(?!TRANSACTION\s+READ\s+ONLY)/i,
];

// Dangerous constructs
const DANGEROUS_PATTERNS = [
  /;\s*\S/,  // Multi-statement (semicolon followed by non-whitespace)
  /\bpg_sleep\b/i,
  /\bdblink\b/i,
  /\bLO_IMPORT\b/i,
  /\bLO_EXPORT\b/i,
];

export function validateQuery(sql: string, constraints: QueryConstraints): ValidationResult {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { valid: false, error: 'Query is empty' };
  }

  // Check for write statements
  for (const pattern of WRITE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: `Write operations are not allowed: ${pattern.source}` };
    }
  }

  // Check for dangerous constructs
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: `Dangerous SQL construct detected: ${pattern.source}` };
    }
  }

  // Must start with SELECT, WITH, or VALUES
  if (!/^\s*(SELECT|WITH|VALUES)\b/i.test(trimmed)) {
    return { valid: false, error: 'Query must start with SELECT, WITH, or VALUES' };
  }

  // Check blocked columns (simple pattern matching — not a full SQL parser)
  if (constraints.blockedColumns && constraints.blockedColumns.length > 0) {
    for (const col of constraints.blockedColumns) {
      // Check if blocked column appears in SELECT (not in WHERE/JOIN conditions)
      // This is a heuristic — a full SQL parser would be more accurate
      const selectMatch = trimmed.match(/SELECT\s+(.+?)\s+FROM/is);
      if (selectMatch) {
        const selectClause = selectMatch[1];
        if (selectClause === '*') {
          return { valid: false, error: `SELECT * is not allowed when blocked columns are configured. Specify columns explicitly.` };
        }
        // Check if blocked column name appears in select clause
        const colPattern = new RegExp(`\\b${escapeRegex(col)}\\b`, 'i');
        if (colPattern.test(selectClause)) {
          return { valid: false, error: `Column '${col}' is blocked and cannot be selected` };
        }
      }
    }
  }

  // Check allowed tables
  if (constraints.allowedTables && constraints.allowedTables.length > 0) {
    const referencedTables = extractTableReferences(trimmed);
    for (const table of referencedTables) {
      if (!constraints.allowedTables.includes(table)) {
        return { valid: false, error: `Table '${table}' is not in the allowed tables list` };
      }
    }
  }

  return { valid: true };
}

/**
 * Extract table names referenced in a SQL query.
 * This is a heuristic — handles common patterns but not all SQL syntax.
 */
function extractTableReferences(sql: string): string[] {
  const tables = new Set<string>();

  // FROM clause: FROM table_name, FROM "table_name"
  const fromPattern = /\bFROM\s+(?:"([^"]+)"|([a-zA-Z_]\w*))/gi;
  let match;
  while ((match = fromPattern.exec(sql)) !== null) {
    tables.add(match[1] ?? match[2]);
  }

  // JOIN clause: JOIN table_name
  const joinPattern = /\bJOIN\s+(?:"([^"]+)"|([a-zA-Z_]\w*))/gi;
  while ((match = joinPattern.exec(sql)) !== null) {
    tables.add(match[1] ?? match[2]);
  }

  return [...tables];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
