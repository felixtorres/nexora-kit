import { createHash } from 'node:crypto';
import type { Socket } from 'node:net';

export const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB9B6FF85B5';

export function computeAcceptKey(clientKey: string): string {
  return createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

export interface DecodedFrame {
  opcode: number;
  payload: Buffer;
  /** Total bytes consumed from the input buffer (header + mask + payload). */
  bytesConsumed: number;
}

export function decodeFrame(data: Buffer): DecodedFrame | null {
  if (data.length < 2) return null;

  const opcode = data[0] & 0x0F;
  const masked = (data[1] & 0x80) !== 0;
  let payloadLength = data[1] & 0x7F;
  let offset = 2;

  if (payloadLength === 126) {
    if (data.length < 4) return null;
    payloadLength = data.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (data.length < 10) return null;
    payloadLength = Number(data.readBigUInt64BE(2));
    offset = 10;
  }

  let maskKey: Buffer | null = null;
  if (masked) {
    if (data.length < offset + 4) return null;
    maskKey = data.subarray(offset, offset + 4);
    offset += 4;
  }

  if (data.length < offset + payloadLength) return null;

  // Copy payload so unmasking doesn't corrupt the shared buffer
  const payload = Buffer.from(data.subarray(offset, offset + payloadLength));

  if (maskKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskKey[i % 4];
    }
  }

  return { opcode, payload, bytesConsumed: offset + payloadLength };
}

export function encodeFrame(payload: Buffer, opcode: number): Buffer {
  const len = payload.length;
  let header: Buffer;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN + opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

export function sendJsonFrame(socket: Socket, data: unknown): void {
  if (socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(data));
  const frame = encodeFrame(payload, 0x1); // Text frame
  socket.write(frame);
}
