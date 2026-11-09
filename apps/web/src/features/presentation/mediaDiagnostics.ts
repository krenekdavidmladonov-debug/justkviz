export const mediaDiagnosticTargets = ['question-image', 'answer-image', 'background-image', 'logo-image', 'audio', 'video'] as const;
export type MediaDiagnosticTarget = typeof mediaDiagnosticTargets[number];

export const mediaDiagnosticReasons = [
  'slow-load', 'buffering', 'timeout', 'load-failed', 'network-error', 'access-denied', 'not-found',
  'offline', 'gateway-throttled', 'gateway-error', 'gateway-unavailable',
  'source-unavailable', 'invalid-media', 'decode-failed', 'invalid-timing',
  'youtube-unavailable', 'youtube-embedding-disabled', 'youtube-configuration', 'autoplay-blocked',
] as const;
export type MediaDiagnosticReason = typeof mediaDiagnosticReasons[number];
export type MediaDiagnosticSignal = MediaDiagnosticReason | 'recovered';

export const mediaDiagnosticDelayMs = 6_000;
