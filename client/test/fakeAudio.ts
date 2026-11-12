/**
 * A stand-in for the browser's Web Audio, for tests of the audio engine in plain Node. It makes
 * no sound: every node records what was asked of it (connections, starts and stops with their
 * times, scheduled gain changes), so a test can count the sources that were started and read
 * what would be playing. Time only moves when the test moves it.
 */

export interface ParamEvent {
  kind: 'set' | 'target' | 'linear' | 'exponential' | 'cancel';
  value: number;
  time: number;
  timeConstant?: number;
}

export class FakeParam {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(value: number) {
    this.value = value;
  }

  /** The value the parameter is heading for: the last one scheduled, or the one set directly. */
  get target(): number {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].kind !== 'cancel') return this.events[i].value;
    return this.value;
  }

  /** The last scheduled change, or null. */
  get last(): ParamEvent | null {
    return this.events.length > 0 ? this.events[this.events.length - 1] : null;
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'set', value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    this.events.push({ kind: 'target', value, time, timeConstant });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'exponential', value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ kind: 'cancel', value: this.value, time });
    return this;
  }
}

export class FakeNode {
  readonly ctx: FakeAudioContext;
  readonly kind: string;
  outputs: FakeNode[] = [];
  disconnected = false;

  constructor(ctx: FakeAudioContext, kind: string) {
    this.ctx = ctx;
    this.kind = kind;
    ctx.nodes.push(this);
  }

  connect(node: FakeNode): FakeNode {
    this.outputs.push(node);
    return node;
  }

  disconnect(): void {
    this.outputs = [];
    this.disconnected = true;
  }

  /** True when a signal from this node can still reach the context's destination. */
  reaches(target: FakeNode, seen = new Set<FakeNode>()): boolean {
    if (this === target) return true;
    if (seen.has(this)) return false;
    seen.add(this);
    return this.outputs.some((o) => o.reaches(target, seen));
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);

  constructor(ctx: FakeAudioContext) {
    super(ctx, 'gain');
  }
}

export class FakePanner extends FakeNode {
  panningModel = '';
  distanceModel = '';
  refDistance = 1;
  rolloffFactor = 1;
  maxDistance = 10000;
  readonly positionX = new FakeParam(0);
  readonly positionY = new FakeParam(0);
  readonly positionZ = new FakeParam(0);

  constructor(ctx: FakeAudioContext) {
    super(ctx, 'panner');
  }
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);

  constructor(ctx: FakeAudioContext) {
    super(ctx, 'filter');
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);

  constructor(ctx: FakeAudioContext) {
    super(ctx, 'compressor');
  }
}

export class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';

  constructor(ctx: FakeAudioContext) {
    super(ctx, 'shaper');
  }
}

export class FakeBuffer {
  readonly duration: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  /** The address the bytes came from, when the buffer was decoded from a fetched file. */
  readonly url: string;
  private data: Float32Array | null = null;

  constructor(duration: number, sampleRate: number, channels = 2, url = '') {
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.numberOfChannels = channels;
    this.length = Math.round(duration * sampleRate);
    this.url = url;
  }

  getChannelData(): Float32Array {
    this.data ??= new Float32Array(this.length);
    return this.data;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  /** Set by start(): when, and from which offset into the buffer. */
  startedAt: number | null = null;
  offset = 0;
  /** Set by stop(): the time it stops (or stopped). */
  stoppedAt: number | null = null;
  ended = false;

  constructor(ctx: FakeAudioContext) {
    super(ctx, 'source');
  }

  start(when = 0, offset = 0): void {
    if (this.startedAt !== null) throw new Error('a source can only be started once');
    this.startedAt = Math.max(when, this.ctx.currentTime);
    this.offset = offset;
    this.ctx.started.push(this);
  }

  stop(when = 0): void {
    if (this.startedAt === null) throw new Error('stop() before start()');
    this.stoppedAt = Math.max(when, this.ctx.currentTime);
  }

  /** The time this source falls silent by itself or by stop(); Infinity for a loop left running. */
  get endsAt(): number {
    if (this.startedAt === null) return Infinity;
    const natural = this.loop || !this.buffer ? Infinity : this.startedAt + (this.buffer.duration - this.offset) / Math.max(0.01, this.playbackRate.value);
    return Math.min(natural, this.stoppedAt ?? Infinity);
  }

  /** True when it is sounding at the context's current time. */
  get playing(): boolean {
    return this.startedAt !== null && !this.ended && this.startedAt <= this.ctx.currentTime && this.ctx.currentTime < this.endsAt;
  }
}

export class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam(440);
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  constructor(ctx: FakeAudioContext) {
    super(ctx, 'oscillator');
  }

  start(when = 0): void {
    this.startedAt = Math.max(when, this.ctx.currentTime);
    this.ctx.oscillators.push(this);
  }

  stop(when = 0): void {
    this.stoppedAt = Math.max(when, this.ctx.currentTime);
  }
}

export class FakeAudioContext {
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'running';
  readonly sampleRate = 48000;
  readonly nodes: FakeNode[] = [];
  /** Every buffer source that was started, in order. */
  readonly started: FakeSource[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly destination: FakeNode;
  readonly listener = {
    positionX: new FakeParam(0),
    positionY: new FakeParam(0),
    positionZ: new FakeParam(0),
    forwardX: new FakeParam(0),
    forwardY: new FakeParam(0),
    forwardZ: new FakeParam(-1),
    upX: new FakeParam(0),
    upY: new FakeParam(1),
    upZ: new FakeParam(0),
  };
  /** Length in seconds of the file behind each address; anything not listed fails to decode. */
  readonly durations = new Map<string, number>();
  /** How many files were decoded, by address. */
  readonly decoded = new Map<string, number>();
  suspends = 0;
  resumes = 0;

  constructor() {
    this.destination = new FakeNode(this, 'destination');
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }

  createPanner(): FakePanner {
    return new FakePanner(this);
  }

  createBufferSource(): FakeSource {
    return new FakeSource(this);
  }

  createOscillator(): FakeOscillator {
    return new FakeOscillator(this);
  }

  createBiquadFilter(): FakeFilter {
    return new FakeFilter(this);
  }

  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }

  createWaveShaper(): FakeShaper {
    return new FakeShaper(this);
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(length / sampleRate, sampleRate, channels);
  }

  decodeAudioData(data: ArrayBuffer): Promise<FakeBuffer> {
    const url = urlOf(data);
    const duration = this.durations.get(url);
    if (duration === undefined) return Promise.reject(new Error(`cannot decode ${url}`));
    this.decoded.set(url, (this.decoded.get(url) ?? 0) + 1);
    return Promise.resolve(new FakeBuffer(duration, this.sampleRate, 2, url));
  }

  resume(): Promise<void> {
    this.resumes++;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }

  /** Moves the audio clock on and ends the one-shots whose time has come. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const src of this.started) {
      if (!src.ended && src.endsAt <= this.currentTime) {
        src.ended = true;
        src.onended?.();
      }
    }
  }

  /** Buffer sources sounding right now. */
  playing(): FakeSource[] {
    return this.started.filter((s) => s.playing);
  }

  /** Buffer sources that were started from a file whose address contains `part`. */
  startedFrom(part: string): FakeSource[] {
    return this.started.filter((s) => s.buffer !== null && s.buffer.url.includes(part));
  }

  /** The gain a signal picks up on its way from a node to the destination (targets, not ramps). */
  gainTo(node: FakeNode): number {
    const walk = (n: FakeNode, seen: Set<FakeNode>): number | null => {
      if (n === this.destination) return 1;
      if (seen.has(n)) return null;
      seen.add(n);
      for (const out of n.outputs) {
        const rest = walk(out, seen);
        if (rest !== null) return rest * (out instanceof FakeGain ? out.gain.target : 1);
      }
      return null;
    };
    const own = node instanceof FakeGain ? node.gain.target : 1;
    const rest = walk(node, new Set());
    return rest === null ? 0 : own * rest;
  }
}

const urls = new WeakMap<ArrayBuffer, string>();

function urlOf(data: ArrayBuffer): string {
  return urls.get(data) ?? '';
}

export interface FakeFetch {
  (url: string): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Every address asked for, in order. */
  requests: string[];
  /** Addresses that answer 404. */
  missing: Set<string>;
  /** Hold every answer back until release() is called (a slow connection). */
  hold: boolean;
  release(): void;
}

/** A `fetch` that answers with bytes tagged with their address, so the fake context can "decode" them. */
export function fakeFetch(): FakeFetch {
  const waiting: Array<() => void> = [];
  const f = ((url: string) => {
    f.requests.push(url);
    const answer = (): { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> } => {
      const ok = !f.missing.has(url);
      return {
        ok,
        status: ok ? 200 : 404,
        arrayBuffer: () => {
          const data = new ArrayBuffer(8);
          urls.set(data, url);
          return Promise.resolve(data);
        },
      };
    };
    if (!f.hold) return Promise.resolve(answer());
    return new Promise((resolve) => waiting.push(() => resolve(answer())));
  }) as FakeFetch;
  f.requests = [];
  f.missing = new Set();
  f.hold = false;
  f.release = () => {
    f.hold = false;
    for (const w of waiting.splice(0)) w();
  };
  return f;
}
