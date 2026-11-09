import type { EditorSlide } from './types.js';
import { canHideInfoSlide, type ResultTemplates } from './design.js';
import { parseQuizAsset, validOwnedMedia } from './media-assets.js';
export const offlineEventLimits = {
    assets: 256, payloadBytes: 512 * 1024 * 1024, imageBytes: 10 * 1024 * 1024,
    mediaBytes: 25 * 1024 * 1024, slides: 400, rounds: 20, teams: 100,
    scoreCells: 200, scoreMutations: 250, operations: 2000, journalBytes: 512 * 1024,
    manifestBytes: 4 * 1024 * 1024, chunkBytes: 4 * 1024 * 1024, ttlMs: 72 * 60 * 60 * 1000,
} as const;
export const offlineResultsPageSize = 6;
export type OfflineMediaKind = 'image' | 'audio' | 'video';
export interface OfflineMediaAsset {
    readonly reference: string;
    readonly generation: string;
    readonly kind: OfflineMediaKind;
    readonly contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'audio/mpeg' | 'audio/wav' | 'video/mp4';
    readonly size: number;
    readonly sha256: string;
    readonly etag: string;
    readonly width?: number;
    readonly height?: number;
}
export interface OfflineRound {
    readonly id: string;
    readonly title: string;
    readonly position: number;
}
export interface OfflineTeam {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
}
export interface OfflineScore {
    readonly teamId: string;
    readonly roundId: string;
    readonly revision: number;
    readonly halfPoints: number | null;
}
export interface OfflineEventManifest {
    readonly schemaVersion: 1;
    readonly exportId: string;
    readonly sessionId: string;
    readonly environment: string;
    readonly audience: string;
    readonly event: {
        readonly id: string;
        readonly title: string;
        readonly startsAtMs: number;
        readonly revision: number;
    };
    readonly snapshot: {
        readonly id: string;
        readonly quizId: string;
        readonly quizRevision: number;
    };
    readonly actorId: string;
    readonly membershipVersion: number;
    readonly issuedAtMs: number;
    readonly expiresAtMs: number;
    readonly rounds: readonly OfflineRound[];
    readonly teams: readonly OfflineTeam[];
    readonly baseScores: readonly OfflineScore[];
    readonly slides: readonly EditorSlide[];
    readonly assets: readonly OfflineMediaAsset[];
    readonly scoring: {
        readonly unitScale: 2;
        readonly rankingMode: 'dense';
    };
    readonly resultTemplates?: ResultTemplates;
}
export interface OfflineGrantPayload {
    readonly schemaVersion: 1;
    readonly exportId: string;
    readonly sessionId: string;
    readonly eventId: string;
    readonly snapshotId: string;
    readonly manifestDigest: string;
    readonly issuedAtMs: number;
    readonly expiresAtMs: number;
    readonly audience: string;
    readonly environment: string;
}
export interface OfflineGrant {
    readonly payload: OfflineGrantPayload;
    readonly digest: string;
    readonly signature: string;
    readonly keyId: string;
}
export interface OfflineTrust {
    readonly schemaVersion: 1;
    readonly keyId: string;
    readonly publicJwk: Record<string, unknown>;
    readonly environment: string;
    readonly audience: string;
}
export interface OfflineIssue {
    readonly slidePosition: number;
    readonly field: string;
    readonly message: string;
}
export type PrepareOfflineEventResponse = {
    readonly ok: true;
    readonly manifest: OfflineEventManifest;
    readonly grant: OfflineGrant;
} | {
    readonly ok: false;
    readonly issues: readonly OfflineIssue[];
};
export interface OfflineScoreChange {
    readonly teamId: string;
    readonly expectedRevision: number;
    readonly halfPoints: number | null;
    readonly reason: string;
}
export type OfflineCommand = {
    readonly type: 'start';
    readonly payload: Record<string, never>;
} | {
    readonly type: 'navigate';
    readonly payload: {
        readonly position: number;
    };
} | {
    readonly type: 'reveal';
    readonly payload: {
        readonly position: number;
    };
} | {
    readonly type: 'hide';
    readonly payload: Record<string, never>;
} | {
    readonly type: 'recap';
    readonly payload: {
        readonly position: number;
    };
} | {
    readonly type: 'media';
    readonly payload: {
        readonly command: 'play' | 'replay' | 'stop' | 'finished' | 'error';
    };
} | {
    readonly type: 'round-scores';
    readonly payload: {
        readonly roundId: string;
        readonly changes: readonly OfflineScoreChange[];
    };
} | {
    readonly type: 'results';
    readonly payload: {
        readonly throughRoundId: string;
        readonly final: boolean;
        readonly page: number;
    };
} | {
    readonly type: 'results-hide';
    readonly payload: Record<string, never>;
} | {
    readonly type: 'end';
    readonly payload: Record<string, never>;
};
export type OfflineOperation = OfflineCommand & {
    readonly operationId: string;
    readonly sequence: number;
    readonly previousHash: string;
    readonly hash: string;
    readonly observedAtMs: number;
};
export interface OfflineResultRow {
    readonly rank: number;
    readonly teamName: string;
    readonly halfPoints: number;
}
export interface OfflineState {
    readonly sequence: number;
    readonly headHash: string;
    readonly status: 'waiting' | 'active' | 'ended';
    readonly slidePosition: number;
    readonly revealPosition: number | null;
    readonly recap: boolean;
    readonly mediaGeneration: number;
    readonly mediaCommand: 'idle' | 'play' | 'replay' | 'stop' | 'finished' | 'error';
    readonly scores: readonly OfflineScore[];
    readonly scoreMutations: number;
    readonly results: {
        readonly throughRoundId: string;
        readonly final: boolean;
        readonly page: number;
        readonly rows: readonly OfflineResultRow[];
    } | null;
}
export interface OfflineSyncConflict {
    readonly teamId?: string;
    readonly roundId?: string;
    readonly reason: string;
    readonly base?: OfflineScore;
    readonly online?: OfflineScore;
    readonly local?: OfflineScore;
}
export interface OfflineSyncSummary {
    readonly scoreChanges: number;
    readonly operationCount: number;
    readonly rows: readonly OfflineResultRow[];
    readonly complete: boolean;
}
export interface OfflineSyncResolution {
    readonly teamId: string;
    readonly roundId: string;
    readonly choice: 'online' | 'offline';
    readonly reason: string;
}
export interface OfflineSyncPreview {
    readonly exportId: string;
    readonly previewDigest: string;
    readonly conflicts: readonly OfflineSyncConflict[];
    readonly server: OfflineSyncSummary;
    readonly local: OfflineSyncSummary;
    readonly resolutionAllowed?: boolean;
    readonly resolutions?: readonly OfflineSyncResolution[];
    readonly merged?: OfflineSyncSummary;
}
export interface OfflineSyncReceipt {
    readonly exportId: string;
    readonly sessionId: string;
    readonly receiptId: string;
    readonly headHash: string;
    readonly operationCount: number;
    readonly rows: readonly OfflineResultRow[];
    readonly replayed: boolean;
    readonly completedFromRecovery?: true;
}
export function canonicalOfflineJson(value: unknown): string {
    const normalize = (item: unknown): unknown => {
        if (item === null || typeof item === 'string' || typeof item === 'boolean') {
            return item;
        }
        if (typeof item === 'number' && Number.isFinite(item)) {
            return item;
        }
        if (Array.isArray(item)) {
            return item.map(normalize);
        }
        if (item && typeof item === 'object') {
            return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, normalize(v)]));
        }
        throw new Error('Neplatná offline data.');
    };
    return JSON.stringify(normalize(value));
}
function fail(message = 'Offline balíček má neplatný obsah.'): never {
    throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
}
function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    const data = record(value);
    if (keys.some(key => !Object.hasOwn(data, key)) || Object.keys(data).some(key => !keys.includes(key) && !optional.includes(key))) {
        fail();
    }
    return data;
}
function text(value: unknown, maximum = 20000): string {
    return typeof value === 'string' && value.length <= maximum ? value : fail();
}
function id(value: unknown): string {
    const result = text(value, 150);
    return /^[A-Za-z0-9_-]{1,150}$/u.test(result) ? result : fail();
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail();
}
function array(value: unknown, max: number): unknown[] {
    return Array.isArray(value) && value.length <= max ? value : fail();
}
function digest(value: unknown): string {
    const result = text(value, 64);
    return /^[a-f0-9]{64}$/u.test(result) ? result : fail();
}
export function parseOfflineScore(value: unknown): OfflineScore {
    const data = exact(value, ['teamId', 'roundId', 'revision', 'halfPoints']);
    return { teamId: id(data.teamId), roundId: id(data.roundId), revision: integer(data.revision), halfPoints: data.halfPoints === null ? null : integer(data.halfPoints) };
}
export function parseOfflineManifest(value: unknown): OfflineEventManifest {
    const data = exact(value, ['schemaVersion', 'exportId', 'sessionId', 'environment', 'audience', 'event', 'snapshot', 'actorId', 'membershipVersion', 'issuedAtMs', 'expiresAtMs', 'rounds', 'teams', 'baseScores', 'slides', 'assets', 'scoring'], ['resultTemplates']);
    if (data.schemaVersion !== 1) {
        fail('Tato verze offline kvízu není podporovaná.');
    }
    const event = exact(data.event, ['id', 'title', 'startsAtMs', 'revision']), snapshot = exact(data.snapshot, ['id', 'quizId', 'quizRevision']);
    const issuedAtMs = integer(data.issuedAtMs), expiresAtMs = integer(data.expiresAtMs);
    if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > offlineEventLimits.ttlMs) {
        fail();
    }
    const rounds = array(data.rounds, offlineEventLimits.rounds).map(value => {
        const r = exact(value, ['id', 'title', 'position']);
        return { id: id(r.id), title: text(r.title), position: integer(r.position, 400, 1) };
    });
    const teams = array(data.teams, offlineEventLimits.teams).map(value => {
        const t = exact(value, ['id', 'name', 'revision']);
        return { id: id(t.id), name: text(t.name, 200), revision: integer(t.revision) };
    });
    if (!rounds.length || !teams.length || rounds.length * teams.length > offlineEventLimits.scoreCells || new Set(rounds.map(r => r.id)).size !== rounds.length || new Set(teams.map(t => t.id)).size !== teams.length) {
        fail();
    }
    if ([...rounds].sort((a, b) => a.position - b.position).some((round, index) => round.position !== index + 1)) {
        fail('Pořadí kol není jednoznačné.');
    }
    const baseScores = array(data.baseScores, offlineEventLimits.scoreCells).map(parseOfflineScore);
    const seen = new Set<string>();
    for (const score of baseScores) {
        const key = JSON.stringify([score.teamId, score.roundId]);
        if (seen.has(key) || !teams.some(t => t.id === score.teamId) || !rounds.some(r => r.id === score.roundId)) {
            fail();
        }
        seen.add(key);
    }
    const slides = array(data.slides, offlineEventLimits.slides).map(value => {
        const slide = record(value);
        const allowed = ['id', 'position', 'storedKind', 'kind', 'isQuestion', 'roundId', 'roundTitle', 'title', 'text', 'moderatorNote', 'options', 'correctAnswer', 'media', 'presentation', 'questionNumber', 'questionCount', 'backgroundImage', 'questionImage', 'answerImage', 'mediaSource', 'originalMediaSource', 'backgroundOverlay', 'clipStartSeconds', 'clipEndSeconds', 'hasLegacyData', 'hidden', 'design', 'answerDesign', 'automaticAgenda', 'authoringStatus', 'answerMode', 'imageLayout', 'answerExplanation'];
        if (Object.keys(slide).some(key => !allowed.includes(key))) {
            fail();
        }
        id(slide.id);
        integer(slide.position, 400, 1);
        text(slide.kind, 50);
        for (const key of ['title', 'text', 'moderatorNote', 'correctAnswer']) {
            text(slide[key]);
        }
        if (typeof slide.isQuestion !== 'boolean' || array(slide.options, 200).some(value => typeof value !== 'string' || value.length > 20000)) {
            fail();
        }
        for (const item of array(slide.media, 20)) {
            const media = record(item);
            if (typeof media.source !== 'string' || !['prompt', 'background', 'answer', 'unknown'].includes(String(media.role))) {
                fail();
            }
        }
        return slide as unknown as EditorSlide;
    });
    if (!slides.length || new Set(slides.map(slide => slide.position)).size !== slides.length || new Set(slides.map(slide => slide.id)).size !== slides.length) {
        fail();
    }
    const assets = array(data.assets, offlineEventLimits.assets).map(value => {
        const a = exact(value, ['reference', 'generation', 'kind', 'contentType', 'size', 'sha256', 'etag'], ['width', 'height']);
        if (!parseQuizAsset(a.reference) || !validOwnedMedia(a.kind, a.contentType, a.size)) {
            fail();
        }
        return { reference: text(a.reference, 500), generation: text(a.generation, 100), kind: a.kind, contentType: a.contentType as OfflineMediaAsset['contentType'], size: integer(a.size, a.kind === 'image' ? offlineEventLimits.imageBytes : offlineEventLimits.mediaBytes, 1), sha256: digest(a.sha256), etag: text(a.etag, 200), ...(a.width === undefined ? {} : { width: integer(a.width, 8192, 1) }), ...(a.height === undefined ? {} : { height: integer(a.height, 8192, 1) }) };
    });
    if (new Set(assets.map(a => a.reference)).size !== assets.length || assets.reduce((sum, a) => sum + a.size, 0) > offlineEventLimits.payloadBytes) {
        fail();
    }
    const scoring = exact(data.scoring, ['unitScale', 'rankingMode']);
    if (scoring.unitScale !== 2 || scoring.rankingMode !== 'dense') {
        fail();
    }
    const manifest: OfflineEventManifest = { schemaVersion: 1, exportId: id(data.exportId), sessionId: id(data.sessionId), environment: id(data.environment), audience: text(data.audience, 200), event: { id: id(event.id), title: text(event.title), startsAtMs: integer(event.startsAtMs), revision: integer(event.revision) }, snapshot: { id: id(snapshot.id), quizId: id(snapshot.quizId), quizRevision: integer(snapshot.quizRevision) }, actorId: id(data.actorId), membershipVersion: integer(data.membershipVersion), issuedAtMs, expiresAtMs, rounds, teams, baseScores, slides, assets, scoring: { unitScale: 2, rankingMode: 'dense' }, ...(data.resultTemplates === undefined ? {} : { resultTemplates: data.resultTemplates as ResultTemplates }) };
    if (new TextEncoder().encode(canonicalOfflineJson(manifest)).length > offlineEventLimits.manifestBytes) {
        fail();
    }
    return manifest;
}
export function initialOfflineState(manifest: OfflineEventManifest): OfflineState {
    return { sequence: 0, headHash: '0'.repeat(64), status: 'waiting', slidePosition: 0, revealPosition: null, recap: false, mediaGeneration: 0, mediaCommand: 'idle', scores: manifest.baseScores, scoreMutations: 0, results: null };
}
export function offlineOperationContent(operation: Omit<OfflineOperation, 'hash'>): string {
    return canonicalOfflineJson(operation);
}
export function parseOfflineOperation(value: unknown): OfflineOperation {
    const op = exact(value, ['operationId', 'sequence', 'previousHash', 'hash', 'observedAtMs', 'type', 'payload']);
    id(op.operationId);
    integer(op.sequence, offlineEventLimits.operations, 1);
    digest(op.previousHash);
    digest(op.hash);
    integer(op.observedAtMs);
    const payload = record(op.payload);
    if (['start', 'hide', 'results-hide', 'end'].includes(String(op.type))) {
        exact(payload, []);
    }
    else if (['navigate', 'reveal', 'recap'].includes(String(op.type))) {
        integer(exact(payload, ['position']).position, 400, 1);
    }
    else if (op.type === 'media') {
        const command = exact(payload, ['command']).command;
        if (!['play', 'replay', 'stop', 'finished', 'error'].includes(String(command))) {
            fail();
        }
    }
    else if (op.type === 'results') {
        exact(payload, ['throughRoundId', 'final', 'page']);
        id(payload.throughRoundId);
        integer(payload.page, 1000);
        if (typeof payload.final !== 'boolean') {
            fail();
        }
    }
    else if (op.type === 'round-scores') {
        exact(payload, ['roundId', 'changes']);
        id(payload.roundId);
        const changes = array(payload.changes, 100);
        if (!changes.length) {
            fail();
        }
        for (const value of changes) {
            const c = exact(value, ['teamId', 'expectedRevision', 'halfPoints', 'reason']);
            id(c.teamId);
            integer(c.expectedRevision);
            if (c.halfPoints !== null) {
                integer(c.halfPoints);
            }
            const reason = text(c.reason, 300);
            if (/[\p{Cc}\p{Cf}]/u.test(reason)) {
                fail();
            }
        }
    }
    else {
        fail();
    }
    return op as unknown as OfflineOperation;
}
export function calculateOfflineResults(manifest: OfflineEventManifest, scores: readonly OfflineScore[], throughRoundId: string): {
    rows: OfflineResultRow[];
    complete: boolean;
    missing: {
        teamId: string;
        roundId: string;
    }[];
} {
    const rounds = [...manifest.rounds].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const end = rounds.findIndex(r => r.id === throughRoundId);
    if (end < 0) {
        fail();
    }
    const missing: {
        teamId: string;
        roundId: string;
    }[] = [];
    const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    const totals = manifest.teams.map(team => {
        let total = 0;
        for (const round of rounds.slice(0, end + 1)) {
            const score = scores.find(score => score.teamId === team.id && score.roundId === round.id);
            if (!score || score.halfPoints === null) {
                missing.push({ teamId: team.id, roundId: round.id });
            }
            else {
                total += score.halfPoints;
                if (!Number.isSafeInteger(total)) {
                    fail();
                }
            }
        }
        return { id: team.id, teamName: team.name, halfPoints: total };
    }).sort((a, b) => b.halfPoints - a.halfPoints || compare(a.teamName.normalize('NFC'), b.teamName.normalize('NFC')) || compare(a.id, b.id));
    let rank = 0;
    const rows = totals.map((team, index) => {
        if (index === 0 || totals[index - 1]!.halfPoints !== team.halfPoints) {
            rank++;
        }
        return { rank, teamName: team.teamName, halfPoints: team.halfPoints };
    });
    return { rows, complete: missing.length === 0 && rows.length > 0, missing };
}
export function reduceOfflineCommand(manifest: OfflineEventManifest, state: OfflineState, command: OfflineCommand): OfflineState {
    if (state.status === 'ended') {
        fail('Kvíz byl ukončen.');
    }
    const clear = { ...state, revealPosition: null, recap: false, mediaGeneration: state.mediaGeneration + 1, mediaCommand: 'idle' as const, results: null };
    if (command.type === 'start') {
        if (state.status !== 'waiting') {
            fail();
        }
        const first = manifest.slides.find(slide => !slide.hidden || !canHideInfoSlide(slide));
        if (!first) {
            fail();
        }
        return { ...clear, status: 'active', slidePosition: first.position };
    }
    if (command.type === 'round-scores') {
        if (!manifest.rounds.some(round => round.id === command.payload.roundId)) {
            fail();
        }
        if (state.scoreMutations + command.payload.changes.length > offlineEventLimits.scoreMutations) {
            fail('Byl dosažen limit oprav bodování.');
        }
        const changed = new Set<string>();
        const scores = [...state.scores];
        for (const change of command.payload.changes) {
            if (changed.has(change.teamId) || !manifest.teams.some(t => t.id === change.teamId)) {
                fail();
            }
            changed.add(change.teamId);
            const index = scores.findIndex(s => s.teamId === change.teamId && s.roundId === command.payload.roundId);
            const previous = index < 0 ? { revision: 0, halfPoints: null } : scores[index]!;
            if (previous.revision !== change.expectedRevision) {
                fail('Body byly mezitím změněny.');
            }
            if (previous.halfPoints === change.halfPoints) {
                fail('Body se nezměnily.');
            }
            if (previous.revision >= Number.MAX_SAFE_INTEGER) {
                fail('Revize bodů překročila bezpečný rozsah.');
            }
            if ((previous.halfPoints !== null || change.halfPoints === null) && !change.reason.trim()) {
                fail('Doplňte důvod opravy bodů.');
            }
            const score = { teamId: change.teamId, roundId: command.payload.roundId, revision: previous.revision + 1, halfPoints: change.halfPoints };
            if (index < 0) {
                scores.push(score);
            }
            else {
                scores[index] = score;
            }
        }
        return { ...state, scores, scoreMutations: state.scoreMutations + changed.size };
    }
    if (state.status !== 'active') {
        fail('Nejprve zahajte kvíz.');
    }
    if (command.type === 'navigate' || command.type === 'reveal' || command.type === 'recap') {
        const slide = manifest.slides.find(slide => slide.position === command.payload.position);
        if (!slide || (slide.hidden && canHideInfoSlide(slide))) {
            fail('Snímek není dostupný.');
        }
        if (command.type === 'navigate') {
            return { ...clear, slidePosition: slide.position };
        }
        if (!slide.isQuestion || !slide.correctAnswer.trim()) {
            fail('Otázka nemá připravenou odpověď.');
        }
        if (command.type === 'reveal' && slide.position !== state.slidePosition) {
            fail();
        }
        return { ...clear, revealPosition: slide.position, recap: command.type === 'recap' };
    }
    if (command.type === 'hide' || command.type === 'results-hide') {
        return clear;
    }
    if (command.type === 'media') {
        return { ...state, mediaGeneration: state.mediaGeneration + 1, mediaCommand: command.payload.command };
    }
    if (command.type === 'results') {
        const result = calculateOfflineResults(manifest, state.scores, command.payload.throughRoundId);
        if (!result.complete) {
            fail('Doplňte chybějící body všech týmů.');
        }
        const ordered = [...manifest.rounds].sort((a, b) => a.position - b.position), last = ordered.at(-1)!;
        if (command.payload.final && last.id !== command.payload.throughRoundId) {
            fail();
        }
        if (!command.payload.final && last.id === command.payload.throughRoundId) {
            fail('Poslední kolo patří konečným výsledkům.');
        }
        if (command.payload.page >= Math.ceil(result.rows.length / offlineResultsPageSize)) {
            fail();
        }
        return { ...clear, results: { ...command.payload, rows: result.rows } };
    }
    if (command.type === 'end') {
        return { ...clear, status: 'ended' };
    }
    return fail();
}
export function parseOfflineOperations(value: unknown): OfflineOperation[] {
    const operations = array(value, offlineEventLimits.operations).map(parseOfflineOperation);
    if (new TextEncoder().encode(canonicalOfflineJson(operations)).length > offlineEventLimits.journalBytes) {
        fail('Historie překračuje limit offline relace.');
    }
    if (new Set(operations.map(op => op.operationId)).size !== operations.length) {
        fail('Historie obsahuje duplicitní operaci.');
    }
    return operations;
}
export function applyOfflineOperation(manifest: OfflineEventManifest, state: OfflineState, operation: OfflineOperation): OfflineState {
    if (operation.sequence !== state.sequence + 1 || operation.previousHash !== state.headHash) {
        fail('Pořadí historie bylo změněno.');
    }
    return { ...reduceOfflineCommand(manifest, state, operation), sequence: operation.sequence, headHash: operation.hash };
}
