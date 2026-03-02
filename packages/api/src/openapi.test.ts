import { describe, it, expect } from 'vitest';
import { buildOpenApiSpec } from './openapi.js';

describe('buildOpenApiSpec', () => {
  it('returns valid OpenAPI 3.1 structure', () => {
    const spec = buildOpenApiSpec();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeDefined();
    expect((spec.info as any).title).toBe('NexoraKit API');
  });

  it('includes all expected paths', () => {
    const spec = buildOpenApiSpec('/v1');
    const paths = spec.paths as Record<string, unknown>;

    expect(paths['/v1/health']).toBeDefined();
    expect(paths['/v1/metrics']).toBeDefined();
    expect(paths['/v1/chat']).toBeDefined();
    expect(paths['/v1/plugins']).toBeDefined();
    expect(paths['/v1/plugins/{name}']).toBeDefined();
    expect(paths['/v1/admin/audit-log']).toBeDefined();
    expect(paths['/v1/admin/usage']).toBeDefined();
  });

  it('uses custom prefix', () => {
    const spec = buildOpenApiSpec('/api/v2');
    const paths = Object.keys(spec.paths as object);
    expect(paths.every((p) => p.startsWith('/api/v2'))).toBe(true);
  });

  it('includes security schemes', () => {
    const spec = buildOpenApiSpec();
    const components = spec.components as any;
    expect(components.securitySchemes.bearerAuth).toBeDefined();
    expect(components.securitySchemes.bearerAuth.type).toBe('http');
  });

  it('includes component schemas', () => {
    const spec = buildOpenApiSpec();
    const schemas = (spec.components as any).schemas;
    expect(schemas.ChatRequest).toBeDefined();
    expect(schemas.ChatResponse).toBeDefined();
    expect(schemas.HealthResponse).toBeDefined();
    expect(schemas.Error).toBeDefined();
  });
});
