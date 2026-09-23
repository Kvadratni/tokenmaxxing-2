/**
 * A minimal, inspectable stand-in for WebAudio.
 *
 * happy-dom (and Node) have no WebAudio at all, so the unit tests inject this
 * instead. Every node records the calls made against it, and every `AudioParam`
 * eagerly folds ramp targets into `.value` so assertions can read the settled
 * gain without simulating the audio clock.
 *
 * This module is never imported by the game — it is intentionally left out of
 * `src/audio/index.ts` so bundlers drop it.
 */

export interface ParamCall {
  readonly method: string;
  readonly args: readonly number[];
}

export class MockAudioParam {
  value: number;
  readonly calls: ParamCall[] = [];

  constructor(value = 0) {
    this.value = value;
  }

  private record(method: string, args: number[], settled?: number): this {
    this.calls.push({ method, args });
    if (settled !== undefined) this.value = settled;
    return this;
  }

  setValueAtTime(v: number, t: number): this {
    return this.record('setValueAtTime', [v, t], v);
  }
  linearRampToValueAtTime(v: number, t: number): this {
    return this.record('linearRampToValueAtTime', [v, t], v);
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    return this.record('exponentialRampToValueAtTime', [v, t], v);
  }
  setTargetAtTime(v: number, t: number, c: number): this {
    return this.record('setTargetAtTime', [v, t, c], v);
  }
  cancelScheduledValues(t: number): this {
    return this.record('cancelScheduledValues', [t]);
  }
  cancelAndHoldAtTime(t: number): this {
    return this.record('cancelAndHoldAtTime', [t]);
  }

  /** Every value this param was ever ramped/set to, in order. */
  targets(): number[] {
    return this.calls.filter((c) => c.method !== 'cancelScheduledValues').map((c) => c.args[0] ?? 0);
  }
}

export class MockAudioNode {
  readonly kind: string;
  readonly outputs: MockAudioNode[] = [];
  disconnectCount = 0;

  constructor(kind: string) {
    this.kind = kind;
  }

  connect<T extends MockAudioNode>(dest: T): T {
    this.outputs.push(dest);
    return dest;
  }

  disconnect(): void {
    this.disconnectCount++;
    this.outputs.length = 0;
  }
}

export class MockScheduledSource extends MockAudioNode {
  readonly startCalls: number[] = [];
  readonly stopCalls: number[] = [];
  onended: (() => void) | null = null;

  start(t = 0): void {
    this.startCalls.push(t);
  }

  stop(t = 0): void {
    this.stopCalls.push(t);
  }

  /** Manually fire the `ended` callback, as the browser would. */
  fireEnded(): void {
    this.onended?.();
  }
}

export class MockOscillator extends MockScheduledSource {
  type: OscillatorType = 'sine';
  periodicWave: unknown = null;
  readonly frequency = new MockAudioParam(440);
  readonly detune = new MockAudioParam(0);

  constructor() {
    super('oscillator');
  }

  setPeriodicWave(w: unknown): void {
    this.periodicWave = w;
    this.type = 'custom';
  }
}

export class MockBufferSource extends MockScheduledSource {
  buffer: unknown = null;
  loop = false;
  readonly playbackRate = new MockAudioParam(1);
  readonly detune = new MockAudioParam(0);

  constructor() {
    super('bufferSource');
  }
}

export class MockGain extends MockAudioNode {
  readonly gain = new MockAudioParam(1);
  constructor() {
    super('gain');
  }
}

export class MockBiquad extends MockAudioNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new MockAudioParam(350);
  readonly Q = new MockAudioParam(1);
  readonly gain = new MockAudioParam(0);
  readonly detune = new MockAudioParam(0);
  constructor() {
    super('biquad');
  }
}

export class MockPanner extends MockAudioNode {
  readonly pan = new MockAudioParam(0);
  constructor() {
    super('panner');
  }
}

export class MockCompressor extends MockAudioNode {
  readonly threshold = new MockAudioParam(-24);
  readonly knee = new MockAudioParam(30);
  readonly ratio = new MockAudioParam(12);
  readonly attack = new MockAudioParam(0.003);
  readonly release = new MockAudioParam(0.25);
  readonly reduction = 0;
  constructor() {
    super('compressor');
  }
}

export class MockAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = [];
    for (let i = 0; i < numberOfChannels; i++) this.channels.push(new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(i: number): Float32Array {
    const ch = this.channels[i];
    if (!ch) throw new RangeError(`no channel ${i}`);
    return ch;
  }
}

export interface MockCreated {
  readonly oscillators: MockOscillator[];
  readonly bufferSources: MockBufferSource[];
  readonly gains: MockGain[];
  readonly filters: MockBiquad[];
  readonly panners: MockPanner[];
  readonly compressors: MockCompressor[];
  readonly buffers: MockAudioBuffer[];
  readonly periodicWaves: unknown[];
}

export class MockAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state: AudioContextState = 'suspended';
  readonly destination = new MockAudioNode('destination');
  readonly baseLatency = 0.01;

  resumeCount = 0;
  closeCount = 0;

  readonly created: MockCreated = {
    oscillators: [],
    bufferSources: [],
    gains: [],
    filters: [],
    panners: [],
    compressors: [],
    buffers: [],
    periodicWaves: [],
  };

  createOscillator(): MockOscillator {
    const n = new MockOscillator();
    this.created.oscillators.push(n);
    return n;
  }

  createBufferSource(): MockBufferSource {
    const n = new MockBufferSource();
    this.created.bufferSources.push(n);
    return n;
  }

  createGain(): MockGain {
    const n = new MockGain();
    this.created.gains.push(n);
    return n;
  }

  createBiquadFilter(): MockBiquad {
    const n = new MockBiquad();
    this.created.filters.push(n);
    return n;
  }

  createStereoPanner(): MockPanner {
    const n = new MockPanner();
    this.created.panners.push(n);
    return n;
  }

  createDynamicsCompressor(): MockCompressor {
    const n = new MockCompressor();
    this.created.compressors.push(n);
    return n;
  }

  createBuffer(channels: number, length: number, sampleRate: number): MockAudioBuffer {
    const b = new MockAudioBuffer(channels, length, sampleRate);
    this.created.buffers.push(b);
    return b;
  }

  createPeriodicWave(real: Float32Array, imag: Float32Array): { real: Float32Array; imag: Float32Array } {
    const w = { real, imag };
    this.created.periodicWaves.push(w);
    return w;
  }

  resume(): Promise<void> {
    this.resumeCount++;
    this.state = 'running';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCount++;
    this.state = 'closed';
    return Promise.resolve();
  }

  // -- test helpers ---------------------------------------------------------

  /** Move the audio clock forward, as the browser would. */
  advance(seconds: number): void {
    this.currentTime += seconds;
  }

  /** Every scheduled source ever created, oscillators and noise alike. */
  sources(): MockScheduledSource[] {
    return [...this.created.oscillators, ...this.created.bufferSources];
  }

  /** Fire `onended` on every source whose stop time has passed. */
  flushEnded(): void {
    for (const s of this.sources()) {
      const stop = s.stopCalls[s.stopCalls.length - 1];
      if (stop !== undefined && stop <= this.currentTime) s.fireEnded();
    }
  }
}

export function asAudioContext(m: MockAudioContext): AudioContext {
  return m as unknown as AudioContext;
}

/**
 * Shadow prototype methods with `undefined` so feature detection sees them as
 * absent. Used to prove the synth degrades on lean platforms.
 */
export function stripFeatures(m: MockAudioContext, ...methods: string[]): MockAudioContext {
  for (const name of methods) {
    Object.defineProperty(m, name, { value: undefined, configurable: true, writable: true });
  }
  return m;
}

export interface MockFactory {
  /** Pass to `createAudioEngine({ contextFactory })`. */
  readonly factory: () => AudioContext;
  /** Every context the factory has minted. */
  readonly contexts: MockAudioContext[];
  /** Most recently minted context. Throws if none exist yet. */
  latest(): MockAudioContext;
  readonly count: number;
}

export function createMockFactory(): MockFactory {
  const contexts: MockAudioContext[] = [];
  return {
    factory: () => {
      const c = new MockAudioContext();
      contexts.push(c);
      return asAudioContext(c);
    },
    contexts,
    latest() {
      const c = contexts[contexts.length - 1];
      if (!c) throw new Error('no MockAudioContext has been created yet');
      return c;
    },
    get count() {
      return contexts.length;
    },
  };
}
