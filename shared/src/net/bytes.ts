/**
 * Little binary helpers for the wire formats: a growing writer, a bounds-checked reader, and
 * base64 for transports that can only carry text. No DOM or Node APIs.
 */

export interface ByteWriter {
  buf: Uint8Array;
  view: DataView;
  pos: number;
}

export function createWriter(initialSize = 1024): ByteWriter {
  const buf = new Uint8Array(initialSize);
  return { buf, view: new DataView(buf.buffer), pos: 0 };
}

function ensure(w: ByteWriter, extra: number): void {
  if (w.pos + extra <= w.buf.length) return;
  let size = w.buf.length * 2;
  while (size < w.pos + extra) size *= 2;
  const next = new Uint8Array(size);
  next.set(w.buf);
  w.buf = next;
  w.view = new DataView(next.buffer);
}

export function writeU8(w: ByteWriter, v: number): void {
  ensure(w, 1);
  w.view.setUint8(w.pos, v);
  w.pos += 1;
}

export function writeU16(w: ByteWriter, v: number): void {
  ensure(w, 2);
  w.view.setUint16(w.pos, v, true);
  w.pos += 2;
}

export function writeI16(w: ByteWriter, v: number): void {
  ensure(w, 2);
  w.view.setInt16(w.pos, v, true);
  w.pos += 2;
}

export function writeU32(w: ByteWriter, v: number): void {
  ensure(w, 4);
  w.view.setUint32(w.pos, v, true);
  w.pos += 4;
}

export function writeF32(w: ByteWriter, v: number): void {
  ensure(w, 4);
  w.view.setFloat32(w.pos, v, true);
  w.pos += 4;
}

export function writeBytes(w: ByteWriter, bytes: Uint8Array): void {
  ensure(w, bytes.length);
  w.buf.set(bytes, w.pos);
  w.pos += bytes.length;
}

/** The bytes written so far, as a copy of exactly the right length. */
export function finishWriter(w: ByteWriter): Uint8Array {
  return w.buf.slice(0, w.pos);
}

export interface ByteReader {
  view: DataView;
  bytes: Uint8Array;
  pos: number;
}

export function createReader(bytes: Uint8Array): ByteReader {
  return { view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes, pos: 0 };
}

function need(r: ByteReader, n: number): void {
  if (r.pos + n > r.bytes.length) throw new Error('message is truncated');
}

export function readU8(r: ByteReader): number {
  need(r, 1);
  const v = r.view.getUint8(r.pos);
  r.pos += 1;
  return v;
}

export function readU16(r: ByteReader): number {
  need(r, 2);
  const v = r.view.getUint16(r.pos, true);
  r.pos += 2;
  return v;
}

export function readI16(r: ByteReader): number {
  need(r, 2);
  const v = r.view.getInt16(r.pos, true);
  r.pos += 2;
  return v;
}

export function readU32(r: ByteReader): number {
  need(r, 4);
  const v = r.view.getUint32(r.pos, true);
  r.pos += 4;
  return v;
}

export function readF32(r: ByteReader): number {
  need(r, 4);
  const v = r.view.getFloat32(r.pos, true);
  r.pos += 4;
  return v;
}

export function readBytes(r: ByteReader, n: number): Uint8Array {
  need(r, n);
  const out = r.bytes.slice(r.pos, r.pos + n);
  r.pos += n;
  return out;
}

/** Rounds and clamps a number into an unsigned integer range [0, max]. NaN becomes 0. */
export function quantize(v: number, scale: number, max: number): number {
  const q = Math.round(v * scale);
  return q > 0 ? (q < max ? q : max) : 0;
}

/** Rounds and clamps a number into a signed 16-bit integer. NaN becomes 0. */
export function quantizeI16(v: number, scale: number): number {
  const q = Math.round(v * scale);
  return q > 32767 ? 32767 : q < -32768 ? -32768 : q || 0;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64.indexOf(clean[i]);
    if (v < 0) throw new Error('invalid base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
