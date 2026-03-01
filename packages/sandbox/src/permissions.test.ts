import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionGate } from './permissions.js';

describe('PermissionGate', () => {
  let gate: PermissionGate;

  beforeEach(() => {
    gate = new PermissionGate();
  });

  it('denies by default when no permissions granted', () => {
    const result = gate.check('plugin-a', { type: 'fs', action: 'read', path: '/tmp' });
    expect(result.allowed).toBe(false);
  });

  it('allows after granting permission', () => {
    gate.grant('plugin-a', 'fs:read');
    const result = gate.check('plugin-a', { type: 'fs', action: 'read', path: '/tmp' });
    expect(result.allowed).toBe(true);
  });

  it('denies after revoking permission', () => {
    gate.grant('plugin-a', 'fs:read');
    gate.revoke('plugin-a', 'fs:read');
    const result = gate.check('plugin-a', { type: 'fs', action: 'read', path: '/tmp' });
    expect(result.allowed).toBe(false);
  });

  it('permissions are namespace-isolated', () => {
    gate.grant('plugin-a', 'fs:read');
    const result = gate.check('plugin-b', { type: 'fs', action: 'read', path: '/tmp' });
    expect(result.allowed).toBe(false);
  });

  it('checks code execution permission', () => {
    gate.grant('plugin-a', 'code:execute');
    const result = gate.check('plugin-a', { type: 'code', action: 'execute', language: 'javascript' });
    expect(result.allowed).toBe(true);
  });

  it('checks network permission', () => {
    const result = gate.check('plugin-a', { type: 'network', action: 'connect', host: 'example.com', port: 443 });
    expect(result.allowed).toBe(false);

    gate.grant('plugin-a', 'network:connect');
    const result2 = gate.check('plugin-a', { type: 'network', action: 'connect', host: 'example.com', port: 443 });
    expect(result2.allowed).toBe(true);
  });

  it('lists permissions for a plugin', () => {
    gate.grant('plugin-a', 'fs:read');
    gate.grant('plugin-a', 'code:execute');
    expect(gate.listPermissions('plugin-a')).toEqual(expect.arrayContaining(['fs:read', 'code:execute']));
  });

  it('clears all permissions for a plugin', () => {
    gate.grant('plugin-a', 'fs:read');
    gate.grant('plugin-a', 'code:execute');
    gate.clearAll('plugin-a');
    expect(gate.listPermissions('plugin-a')).toEqual([]);
  });

  it('provides useful error message on denial', () => {
    const result = gate.check('plugin-a', { type: 'fs', action: 'write', path: '/tmp/file' });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain('plugin-a');
      expect(result.reason).toContain('fs:write');
    }
  });
});
