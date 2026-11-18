import { httpsCallable } from 'firebase/functions';
import { emulatorEndpoint } from '../../services/firebase/emulatorEndpoint';
import { getFirebaseAppContext } from '../../services/firebase/app';
import { getFirebaseServices } from '../../services/firebase/client';

const callableNames = ['createEventLiveSession', 'previewInterimResults', 'readRefereeEvent', 'revealAnswer', 'saveEventScore'] as const;
export type WarmupFunction = typeof callableNames[number] | 'generatePrintArtifact';
export interface WarmupResult { ready: WarmupFunction[]; failed: WarmupFunction[] }
const timeoutMs = 15000;

function assertPing(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 1 || (value as Record<string, unknown>).warmup !== true) {
    throw new Error('Služba nepotvrdila přípravu.');
  }
}
async function pingPrint(): Promise<void> {
  const { config } = getFirebaseAppContext();
  const projectId = config.options.projectId;
  if (!projectId) throw new Error('Chybí Firebase project ID.');
  const endpoint = config.useEmulators
    ? `${emulatorEndpoint(projectId, 'FUNCTIONS').origin}/${projectId}/europe-west1/generatePrintArtifact`
    : `https://europe-west1-${projectId}.cloudfunctions.net/generatePrintArtifact`;
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ warmup: true }), signal: AbortSignal.timeout(timeoutMs), cache: 'no-store',
  });
  if (!response.ok) throw new Error('Služba tisku není dostupná.');
  assertPing(await response.json());
}
/** An explicit retry may repeat these constant pings; no event identifier is sent. */
export async function warmEventFunctions(): Promise<WarmupResult> {
  const names: WarmupFunction[] = [...callableNames, 'generatePrintArtifact'];
  const attempts = await Promise.allSettled(names.map(async name => {
    if (name === 'generatePrintArtifact') return pingPrint();
    const response = await httpsCallable<{ warmup: true }, unknown>(getFirebaseServices().functions, name, { timeout: timeoutMs })({ warmup: true });
    assertPing(response.data);
  }));
  return {
    ready: names.filter((_, index) => attempts[index]?.status === 'fulfilled'),
    failed: names.filter((_, index) => attempts[index]?.status === 'rejected'),
  };
}
let automaticWarmup: Promise<WarmupResult> | undefined;
/** Deduplicate StrictMode effects and later moderation mounts for this page lifetime. */
export function warmEventFunctionsOnce(): Promise<WarmupResult> {
  return automaticWarmup ??= warmEventFunctions();
}
