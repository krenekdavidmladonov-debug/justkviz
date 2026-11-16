import type { LocalMediaTiming, PlayerTiming } from '../presentation/mediaTiming';

const captureWindowMs = 90_000;
const stageNames = ['snapshot', 'frame', 'asset-request', 'asset-headers', 'asset-body', 'image-ready', 'image-error',
  'player-mounted', 'player-cued', 'player-ready', 'player-can-play', 'player-playing', 'player-error'] as const;
const targets = ['question-image', 'background-image', 'logo-image', 'answer-image', 'audio', 'video'] as const;
type Stage = 'snapshot' | 'frame' | LocalMediaTiming;
type Target = typeof targets[number];
export type LatencyAction = 'next' | 'previous' | 'jump' | 'recap' | 'play' | 'replay';

interface TimingMark {
  readonly stage: Stage;
  readonly at: number;
  readonly target?: Target;
}

interface ProjectorMark extends TimingMark {
  readonly observer: string;
  readonly revision: number;
  readonly generation: number;
}

export interface LatencyTrace {
  readonly id: number;
  readonly action: LatencyAction;
  readonly start: number;
  readonly dispatched?: number;
  readonly settled?: number;
  readonly revision?: number;
  readonly failed?: boolean;
  readonly marks: readonly TimingMark[];
}

// Only compare this clock between windows of the same browser on this device.
export const latencyNow = () => performance.timeOrigin + performance.now();

export function latencyEnabled(search: string): boolean {
  return new URLSearchParams(search).get('latency') === '1';
}

export function openLatencyChannel(sessionId: string): BroadcastChannel | undefined {
  try { return new BroadcastChannel(`justkviz-live-latency-v1:${sessionId}`); }
  catch { return undefined; }
}

function parseMark(value: unknown, now: number): ProjectorMark | undefined {
  if (typeof value !== 'object' || value === null) return;
  const { observer, revision, generation, stage, at, target } = value as Partial<ProjectorMark>;
  if (typeof observer !== 'string' || !/^[a-z0-9-]{1,48}$/u.test(observer)
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
    || typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 0
    || typeof at !== 'number' || !Number.isFinite(at) || at < now - captureWindowMs || at > now + 2
    || !stage || !stageNames.includes(stage)
    || (stage === 'snapshot' || stage === 'frame' ? target !== undefined : !target || !targets.includes(target))) return;
  return { observer, revision, generation, stage, at, ...(target ? { target } : {}) };
}

// Diagnostics only. Channel data never changes the displayed slide or issues a command.
export class LiveLatencyCapture {
  private sequence = 0;
  private trace?: LatencyTrace;
  private pending: ProjectorMark[] = [];
  private projector?: string;
  private generation?: number;
  private localMedia: (TimingMark & { generation: number })[] = [];

  constructor(private readonly onChange: (trace: LatencyTrace | undefined) => void,
    private readonly now: () => number = latencyNow) {}

  clear() {
    this.trace = undefined; this.projector = undefined; this.generation = undefined;
    this.pending = []; this.localMedia = [];
    this.onChange(undefined);
  }

  begin(action: LatencyAction, acceptedAt = this.now()): number {
    this.projector = undefined; this.generation = undefined; this.pending = []; this.localMedia = [];
    const id = ++this.sequence;
    this.set({ id, action, start: acceptedAt, marks: [] });
    return id;
  }

  dispatch(id: number) {
    if (this.trace?.id === id) this.set({ ...this.trace, dispatched: this.now() });
  }

  settle(id: number, response?: { revision: number; mediaGeneration: number }) {
    if (this.trace?.id !== id) return;
    this.generation = response?.mediaGeneration;
    this.set({ ...this.trace, settled: this.now(), ...(response ? { revision: response.revision } : { failed: true }) });
    for (const mark of this.pending) this.accept(mark);
    for (const mark of this.localMedia) if (mark.generation === this.generation) this.append(mark);
    this.pending = []; this.localMedia = [];
  }

  receive(value: unknown) {
    const trace = this.trace;
    if (!trace || trace.failed) return;
    const mark = parseMark(value, this.now());
    if (!mark || !this.inWindow(trace, mark.at)) return;
    if (trace.revision === undefined) {
      // The snapshot and frame can precede the Callable response.
      this.pending = [...this.pending, mark].slice(-64);
    } else this.accept(mark);
  }

  audio(generation: number, stage: PlayerTiming) {
    const trace = this.trace;
    if (trace?.action !== 'play' && trace?.action !== 'replay') return;
    const mark = { generation, stage, target: 'audio' as const, at: this.now() };
    if (!this.inWindow(trace, mark.at) || trace.failed) return;
    if (trace.revision === undefined) this.localMedia = [...this.localMedia, mark].slice(-16);
    else if (generation === this.generation) this.append(mark);
  }

  private inWindow(trace: LatencyTrace, at: number) {
    return trace.dispatched !== undefined && at >= trace.dispatched && at <= trace.start + captureWindowMs;
  }

  private accept(mark: ProjectorMark) {
    const trace = this.trace;
    if (!trace || trace.revision === undefined || mark.generation !== this.generation) return;
    if (mark.revision === trace.revision && mark.stage === 'snapshot') this.projector ??= mark.observer;
    if (mark.observer !== this.projector) return;
    // A playback lifecycle report may advance the revision of the same player.
    const playback = (trace.action === 'play' || trace.action === 'replay') && (mark.target === 'audio' || mark.target === 'video');
    if (mark.revision === trace.revision || (playback && mark.revision > trace.revision)) this.append(mark);
  }

  private append({ stage, target, at }: TimingMark) {
    const trace = this.trace;
    if (!trace || trace.marks.some(mark => mark.stage === stage && mark.target === target)) return;
    this.set({ ...trace, marks: [...trace.marks, { stage, at, ...(target ? { target } : {}) }] });
  }

  private set(trace: LatencyTrace) {
    this.trace = trace;
    this.onChange(trace);
  }
}
