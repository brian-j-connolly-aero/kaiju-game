/** Bitsets stored in a Uint8Array (used for the live-props set and for wire encoding). */

export function createBitset(count: number, allSet = false): Uint8Array {
  const bits = new Uint8Array(Math.ceil(count / 8));
  if (allSet) {
    bits.fill(0xff);
    const extra = bits.length * 8 - count;
    if (extra > 0) bits[bits.length - 1] = 0xff >>> extra;
  }
  return bits;
}

export function bitGet(bits: Uint8Array, i: number): boolean {
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}

export function bitSet(bits: Uint8Array, i: number): void {
  bits[i >> 3] |= 1 << (i & 7);
}

export function bitClear(bits: Uint8Array, i: number): void {
  bits[i >> 3] &= ~(1 << (i & 7));
}

/** Number of set bits. */
export function bitCount(bits: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bits.length; i++) {
    let b = bits[i];
    while (b) {
      b &= b - 1;
      n++;
    }
  }
  return n;
}
