import { describe, expect, it } from 'vitest';
import { LiveLatencyCapture, type LatencyTrace } from '../apps/web/src/features/live/liveLatency';

function harness() {
  let now = 10_000;
  let trace: LatencyTrace | undefined;
  const capture = new LiveLatencyCapture(value => { trace = value; }, () => now);
  const time = (ms: number) => { now += ms; };
  const report = (stage: string, extra = {}) => capture.receive({ observer: 'primary', revision: 7, generation: 3, at: now, stage, ...extra });
  return { capture, time, report, latest: () => trace };
}

describe('live navigation measurement', () => {
  it('correlates snapshot and frame even when the server response arrives later', () => {
    const { capture, time, report, latest } = harness();
    const id = capture.begin('next');
    time(10); capture.dispatch(id);
    time(30); report('snapshot');
    time(16); report('frame');
    time(50); capture.settle(id, { revision: 7, mediaGeneration: 3 });
    time(100); report('image-ready', { target: 'question-image' });
    expect(latest()).toMatchObject({ revision: 7, dispatched: 10_010, settled: 10_106, marks: [
      { stage: 'snapshot', at: 10_040 }, { stage: 'frame', at: 10_056 },
      { stage: 'image-ready', at: 10_206, target: 'question-image' },
    ] });
  });

  it('keeps mismatched, pre-dispatch, duplicate, and malformed observations out of the trace', () => {
    const { capture, time, report, latest } = harness();
    const id = capture.begin('jump');
    report('snapshot');
    time(1); capture.dispatch(id);
    report('snapshot', { revision: 6 });
    report('snapshot', { generation: 2 });
    report('snapshot', { observer: 'invalid observer' });
    report('snapshot', { target: 'question-image' });
    report('frame', { at: Infinity });
    capture.settle(id, { revision: 7, mediaGeneration: 3 });
    expect(latest()?.marks).toEqual([]);
    report('snapshot');
    report('frame', { observer: 'other' });
    report('frame');
    time(5); report('frame');
    time(91_000); report('image-ready', { target: 'question-image' });
    expect(latest()?.marks.map(mark => mark.stage)).toEqual(['snapshot', 'frame']);
  });

  it('does not label a rejected callable or an obsolete command as projected', () => {
    const { capture, report, latest } = harness();
    const old = capture.begin('next');
    capture.dispatch(old);
    const current = capture.begin('previous');
    capture.dispatch(current);
    capture.settle(old, { revision: 7, mediaGeneration: 3 });
    report('snapshot');
    capture.settle(current);
    expect(latest()).toMatchObject({ action: 'previous', failed: true, marks: [] });
    expect(latest()?.revision).toBeUndefined();
    capture.clear();
    capture.settle(current, { revision: 7, mediaGeneration: 3 });
    expect(latest()).toBeUndefined();
  });

  it('accepts audio from the matching Play generation and later video playback revisions only', () => {
    const { capture, report, latest } = harness();
    const id = capture.begin('play');
    capture.dispatch(id);
    capture.audio(2, 'player-error');
    capture.audio(3, 'player-ready');
    capture.settle(id, { revision: 7, mediaGeneration: 3 });
    report('snapshot');
    report('frame', { revision: 8 });
    report('player-playing', { revision: 8, generation: 2, target: 'video' });
    report('player-playing', { revision: 8, target: 'video' });
    expect(latest()?.marks.map(mark => [mark.stage, mark.target])).toEqual([
      ['player-ready', 'audio'], ['snapshot', undefined], ['player-playing', 'video'],
    ]);
  });
});
