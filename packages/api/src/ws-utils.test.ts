import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { encodeFrame, decodeFrame, sendJsonFrame, computeAcceptKey, WS_MAGIC } from './ws-utils.js';
import { createHash } from 'node:crypto';

describe('ws-utils', () => {
  it('encodeFrame/decodeFrame roundtrip', () => {
    const payload = Buffer.from('hello world');
    const frame = encodeFrame(payload, 0x1); // Text frame
    const decoded = decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded!.opcode).toBe(0x1);
    expect(decoded!.payload.toString()).toBe('hello world');
  });

  it('decodes masked frames', () => {
    // Build a masked frame manually
    const text = 'test';
    const payload = Buffer.from(text);
    const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      masked[i] = payload[i] ^ mask[i % 4];
    }

    const header = Buffer.alloc(6 + payload.length);
    header[0] = 0x81; // FIN + text
    header[1] = 0x80 | payload.length; // masked + length
    mask.copy(header, 2);
    masked.copy(header, 6);

    const decoded = decodeFrame(header);
    expect(decoded).not.toBeNull();
    expect(decoded!.payload.toString()).toBe('test');
  });

  it('sendJsonFrame writes JSON text frame to socket', () => {
    const socket = new EventEmitter() as any;
    socket.write = vi.fn();
    socket.destroyed = false;

    sendJsonFrame(socket, { type: 'pong' });

    expect(socket.write).toHaveBeenCalledOnce();
    const written = socket.write.mock.calls[0][0] as Buffer;
    // Decode the frame
    const decoded = decodeFrame(written);
    expect(decoded).not.toBeNull();
    expect(JSON.parse(decoded!.payload.toString())).toEqual({ type: 'pong' });
  });

  it('sendJsonFrame does not write to destroyed socket', () => {
    const socket = new EventEmitter() as any;
    socket.write = vi.fn();
    socket.destroyed = true;

    sendJsonFrame(socket, { type: 'test' });
    expect(socket.write).not.toHaveBeenCalled();
  });

  it('computeAcceptKey produces correct value', () => {
    const key = 'dGhlIHNhbXBsZSBub25jZQ==';
    const expected = createHash('sha1').update(key + WS_MAGIC).digest('base64');
    expect(computeAcceptKey(key)).toBe(expected);
  });
});
