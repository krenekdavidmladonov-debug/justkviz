import { useCallback, useEffect, useRef, useState } from 'react';
import { youtubeVideoId } from '@filmovy-kviz/quiz-domain';
import type { EditorSlide } from '../editor/types';
import { readDriveConnection, type DriveConnectionStatus } from './api';
import { driveImportFields, readDriveMediaImport, requestDriveMediaImport, type DriveImportField, type DriveImportResult, type DriveImportTarget } from './importsApi';

export interface DriveMediaImportEntry extends DriveImportTarget {
  readonly fingerprint: string;
  readonly status: DriveImportResult['status'];
  readonly jobId?: string;
  readonly reference?: string;
  readonly execution?: DriveImportResult['execution'];
  readonly pollingPaused?: boolean;
}
export function driveImportFingerprint(slide: EditorSlide, field: DriveImportField): string {
  return JSON.stringify(field === 'mediaSource' ? [slide[field], slide.kind, slide.clipStartSeconds, slide.clipEndSeconds] : [slide[field]]);
}
export function driveImportCandidates(slide: EditorSlide): readonly DriveImportField[] {
  return driveImportFields.filter(field => {
    if (field !== 'mediaSource') return false;
    return ['audio', 'music', 'video', 'youtube'].includes(slide.kind) && youtubeVideoId(slide.mediaSource) !== undefined
      && slide.clipStartSeconds !== null && Number.isFinite(slide.clipStartSeconds) && slide.clipStartSeconds >= 0
      && slide.clipEndSeconds !== null && Number.isFinite(slide.clipEndSeconds) && slide.clipEndSeconds > slide.clipStartSeconds;
  });
}
interface ImportRun { stopped: boolean; timer?: ReturnType<typeof setTimeout> }

/** Only acknowledged editor saves call queueSavedSlides; drafts never request imports. */
export function useDriveMediaImports(identity: string, quizId: string | undefined, enabled: boolean, onReady: () => void) {
  const [entries, setEntries] = useState<Readonly<Record<string, DriveMediaImportEntry>>>({});
  const runs = useRef(new Map<string, ImportRun>()), connection = useRef<Promise<DriveConnectionStatus | null> | null>(null);
  const latestEntries = useRef(entries); latestEntries.current = entries;
  const readyCallback = useRef(onReady), current = useRef({ identity, quizId, enabled });
  readyCallback.current = onReady; current.current = { identity, quizId, enabled };
  useEffect(() => {
    connection.current = null; setEntries({});
    return () => { runs.current.forEach(run => { run.stopped = true; clearTimeout(run.timer); }); runs.current.clear(); };
  }, [identity, quizId, enabled]);
  const start = useCallback(async (slide: EditorSlide, field: DriveImportField, resume?: DriveMediaImportEntry) => {
    if (!enabled || !quizId) return;
    const key = `${slide.id}:${field}`, previous = runs.current.get(key);
    if (previous) { previous.stopped = true; clearTimeout(previous.timer); }
    const run: ImportRun = { stopped: false }; runs.current.set(key, run);
    const active = () => !run.stopped && current.current.identity === identity && current.current.quizId === quizId && current.current.enabled;
    connection.current ??= readDriveConnection().catch(() => null);
    const drive = await connection.current;
    if (!drive?.mediaImportEnabled || drive.status !== 'connected' || !drive.folder || !active()) return;
    const target: DriveImportTarget = { quizId, slideId: slide.id, field }, fingerprint = driveImportFingerprint(slide, field);
    const execution = resume?.execution ?? (field === 'mediaSource' ? drive.mediaImportMode : undefined);
    const update = (value: DriveImportResult, pollingPaused = false) => {
      if (!active()) return;
      setEntries(old => ({ ...old, [key]: { ...target, fingerprint, status: value.status, jobId: value.jobId, execution: value.execution ?? execution,
        ...(pollingPaused ? { pollingPaused: true } : {}), ...(value.reference === undefined ? {} : { reference: value.reference }) } }));
      if (value.status === 'ready') readyCallback.current();
    };
    setEntries(old => ({ ...old, [key]: { ...target, fingerprint, status: resume?.status ?? 'queued', execution } }));
    let attempts = 0;
    const observe = (value: DriveImportResult) => {
      if (!active()) return;
      update(value);
      if (value.status !== 'queued' && value.status !== 'processing') return;
      const local = (value.execution ?? execution) === 'local';
      if (++attempts > 360) { update(local ? value : { ...value, status: 'failed' }, local); return; }
      run.timer = setTimeout(() => { void readDriveMediaImport(target, value.jobId).then(observe).catch(() => update(local ? value : { ...value, status: 'failed' }, local)); }, 2500);
    };
    try { observe(resume?.jobId ? await readDriveMediaImport(target, resume.jobId) : await requestDriveMediaImport(target)); }
    catch {
      if (resume?.execution === 'local') update({ jobId: resume.jobId!, status: resume.status, execution: 'local' }, true);
      else if (active()) setEntries(old => ({ ...old, [key]: { ...target, fingerprint, status: 'failed' } }));
    }
  }, [enabled, identity, quizId]);
  const queueSavedSlides = useCallback((slides: readonly EditorSlide[]) => {
    if (!enabled) return;
    for (const slide of slides) {
      // Superseding saves invalidate every old field, including one now empty.
      for (const field of driveImportFields) {
        const key = `${slide.id}:${field}`, old = runs.current.get(key);
        if (old) { old.stopped = true; clearTimeout(old.timer); runs.current.delete(key); }
      }
      setEntries(old => Object.fromEntries(Object.entries(old).filter(([, entry]) => entry.slideId !== slide.id)));
      for (const field of driveImportCandidates(slide)) void start(slide, field);
    }
  }, [enabled, quizId, start]);
  const retry = useCallback((slide: EditorSlide, field: DriveImportField) => {
    const entry = latestEntries.current[`${slide.id}:${field}`];
    if (driveImportCandidates(slide).includes(field)) void start(slide, field,
      entry?.pollingPaused && entry.fingerprint === driveImportFingerprint(slide, field) ? entry : undefined);
  }, [quizId, start]);
  return { entries: Object.values(entries), queueSavedSlides, retry };
}
