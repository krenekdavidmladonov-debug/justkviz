import { assertEventReadable } from '../events/guards.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import { authorize, freshIdentity } from '../access/authorization.js';
import { PrintCenterError } from './errors.js';
import { PRINT_LIMITS } from './limits.js';
import { renderPrintArtifact } from './renderer.js';
import { mapSnapshotToPrintEvent } from './snapshot-mapper.js';
import { registrationToPrintTeam } from '../registrations/print-adapter.js';
import type { PrintLogMetadata, PrintOptions, PrintRequestOptions, PrintTeam } from './types.js';
import { parsePrintRequestOptions } from './validation.js';
import { parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { assetPath, mediaSignature } from '../media/model.js';
import { mediaBucket } from '../media/storage.js';
import { printLogoAsset } from './logo.js';
import { assertCurrentPrintSource } from './source-guard.js';

if (getApps().length === 0) initializeApp();

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PrintCenterError(422, 'malformed-data', 'Data pro tisk nejsou platná.');
  }
  return value as Record<string, unknown>;
}

function bearerToken(header: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/u.exec(header ?? '');
  if (!match?.[1]) throw new PrintCenterError(401, 'unauthenticated', 'Přihlášení je vyžadováno.');
  return match[1];
}

function eventIdFromBody(body: unknown): string {
  const data = record(body);
  if (typeof data.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(data.eventId)) {
    throw new PrintCenterError(400, 'invalid-event', 'Neplatná akce.');
  }
  return data.eventId;
}

function optionsFromBody(body: unknown): unknown {
  const data = record(body);
  const keys = Object.keys(data);
  if (keys.some((key) => key !== 'eventId' && key !== 'options')) {
    throw new PrintCenterError(400, 'invalid-request', 'Požadavek obsahuje nepovolená pole.');
  }
  return data.options;
}

async function acceptedTeams(eventId: string): Promise<PrintTeam[]> {
  const snapshot = await getFirestore().collection('events').doc(eventId)
    .collection('registrations').orderBy('createdAt').limit(501).get();
  const teams = snapshot.docs.flatMap((document) => {
    const team = registrationToPrintTeam(document.id, record(document.data()));
    return team === undefined ? [] : [team];
  });
  if (teams.length > PRINT_LIMITS.teams) {
    throw new PrintCenterError(409, 'team-limit', `PDF podporuje nejvýše ${PRINT_LIMITS.teams} přijatých týmů.`);
  }
  return teams;
}

async function resolvePrintOptions(eventId: string, request: PrintRequestOptions): Promise<PrintOptions> {
  if (request.artifactType === 'answer-key' || request.artifactType === 'organizer-sheets') return request;
  if (request.artifactType === 'team-sheets' && request.mode === 'generic') {
    return { ...request, teams: [] };
  }
  if (request.artifactType === 'team-sheets' && request.mode === 'single') {
    const snapshot = await getFirestore().collection('events').doc(eventId)
      .collection('registrations').doc(request.teamId).get();
    const team = snapshot.exists ? registrationToPrintTeam(snapshot.id, record(snapshot.data())) : undefined;
    if (team === undefined) throw new PrintCenterError(404, 'team-not-found', 'Přijatý tým nebyl nalezen.');
    return { ...request, teams: [team] };
  }
  const teams = await acceptedTeams(eventId);
  if (teams.length === 0) throw new PrintCenterError(409, 'missing-teams', 'Akce zatím nemá žádné přijaté týmy.');
  return { ...request, teams };
}

export const generatePrintArtifact = onRequest(
  {
    region: 'europe-west1',
    cors: true,
    timeoutSeconds: 30,
    memory: '512MiB',
    maxInstances: 10,
  },
  async (request, response) => {
    const startedAt = Date.now();
    try {
      if (request.method !== 'POST') {
        response.set('Allow', 'POST').status(405).json({ code: 'method-not-allowed', message: 'Použijte POST.' });
        return;
      }
      if (!request.is('application/json')) {
        throw new PrintCenterError(415, 'unsupported-media-type', 'Požadavek musí být JSON.');
      }
      if (request.rawBody.byteLength > PRINT_LIMITS.requestBytes) {
        throw new PrintCenterError(413, 'request-limit', 'Požadavek je příliš velký.');
      }

      const eventId = eventIdFromBody(request.body);
      const requestedOptions = parsePrintRequestOptions(optionsFromBody(request.body));
      const token = await getAuth().verifyIdToken(bearerToken(request.header('authorization')), true);
      const auth = { uid: token.uid, token };
      await freshIdentity(auth);
      const assertAccess = async () => {
        const includesAnswers = requestedOptions.artifactType === 'answer-key' || requestedOptions.artifactType === 'organizer-sheets';
        const member = await authorize(auth, includesAnswers
          ? ['event.export', 'event.answers.read', 'event.answers.export']
          : ['event.export'], { kind: 'event', id: eventId });
        const current = (await getFirestore().doc(`events/${eventId}`).get()).data();
        assertEventReadable(current, member);
        return current;
      };
      await assertAccess();
      const options = await resolvePrintOptions(eventId, requestedOptions);

      const db = getFirestore();
      const eventSnapshot = await db.collection('events').doc(eventId).get();
      if (!eventSnapshot.exists) throw new PrintCenterError(404, 'event-not-found', 'Akce nebyla nalezena.');
      const eventData = record(eventSnapshot.data());
      const assignmentValue = eventData.quizAssignment;
      if (typeof assignmentValue !== 'object' || assignmentValue === null || Array.isArray(assignmentValue)) {
        throw new PrintCenterError(409, 'event-not-locked', 'Nejdříve na detailu akce vyberte kvíz a použijte „Zkontrolovat a připravit“. Potom budou tiskové materiály dostupné.');
      }
      const assignment = assignmentValue as Record<string, unknown>;
      if (typeof assignment.snapshotId !== 'string' || assignment.snapshotId.length === 0) {
        throw new PrintCenterError(409, 'event-not-locked', 'Nejdříve na detailu akce vyberte kvíz a použijte „Zkontrolovat a připravit“. Potom budou tiskové materiály dostupné.');
      }

      const snapshotRef = db.collection('quizSnapshots').doc(assignment.snapshotId);
      const [snapshot, rounds, slides] = await Promise.all([
        snapshotRef.get(),
        snapshotRef.collection('rounds').orderBy('position').limit(PRINT_LIMITS.rounds + 1).get(),
        snapshotRef.collection('slides').orderBy('position').limit(PRINT_LIMITS.slides + 1).get(),
      ]);
      if (!snapshot.exists) throw new PrintCenterError(409, 'snapshot-missing', 'Připravená verze kvízu nebyla nalezena. Zkontrolujte přípravu kvízu na detailu akce.');
      assertCurrentPrintSource(assignment, assignment, snapshot.data(), eventId);

      const printEvent = mapSnapshotToPrintEvent(
        eventData,
        record(snapshot.data()),
        rounds.docs.map((document) => ({ id: document.id, data: record(document.data()) })),
        slides.docs.map((document) => ({ id: document.id, data: record(document.data()) })),
      );
      // Grayscale uses the vector wordmark, so it needs no raster asset read.
      const showLogo = requestedOptions.colorMode !== 'grayscale'
        && (requestedOptions.showLogo ?? printEvent.quiz.printTemplate?.showLogo ?? true);
      const logoReference = showLogo ? printEvent.quiz.printTemplate?.logoImage : undefined;
      if (logoReference) {
        const parsed = parseQuizAsset(logoReference);
        const snapshotQuizId = record(snapshot.data()).quizId;
        // Validate ownership before reading metadata, then validate the exact immutable generation.
        if (parsed && parsed.quizId !== snapshotQuizId) throw new PrintCenterError(422, 'invalid-logo', 'Logo nepatří do připraveného kvízu.');
        const asset = parsed ? (await db.doc(`quizzes/${parsed.quizId}/mediaAssets/${parsed.assetId}`).get()).data() : undefined;
        const descriptor = printLogoAsset(logoReference, snapshotQuizId, asset);
        const [bytes] = await mediaBucket().file(assetPath(descriptor.quizId, descriptor.assetId), { generation: descriptor.generation }).download();
        if (bytes.length !== descriptor.size || !mediaSignature(bytes, descriptor.contentType)) throw new PrintCenterError(422, 'invalid-logo', 'Soubor loga neodpovídá ověřenému médiu.');
        printEvent.logo = { bytes, contentType: descriptor.contentType };
      }
      const artifact = await renderPrintArtifact(printEvent, options);
      const currentEvent = await assertAccess();
      assertCurrentPrintSource(assignment, currentEvent?.quizAssignment, (await snapshotRef.get()).data(), eventId);
      const questionCount = printEvent.quiz.rounds.reduce((total, round) => total + round.questions.length, 0);
      const metadata: PrintLogMetadata = {
        artifactType: options.artifactType,
        roundCount: printEvent.quiz.rounds.length,
        questionCount,
        teamCount: 'teams' in options ? options.teams.length : 0,
        pageCount: artifact.pageCount,
        generationDurationMs: Date.now() - startedAt,
      };
      logger.info('print_artifact_generated', metadata);

      response.set({
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store',
        'Content-Disposition': `${options.disposition}; filename="${artifact.filename}"`,
        'Content-Length': artifact.bytes.byteLength.toString(),
        'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
        'X-Content-Type-Options': 'nosniff',
      });
      response.status(200).send(Buffer.from(artifact.bytes));
    } catch (error: unknown) {
      if (error instanceof HttpsError) { response.status(error.code === 'unauthenticated' ? 401 : 403).json({ code: error.code, message: error.message }); return; }
      if (error instanceof PrintCenterError) {
        response.status(error.status).json({ code: error.code, message: error.message });
        return;
      }
      logger.error('print_artifact_failed', {
        generationDurationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      response.status(500).json({ code: 'internal', message: 'PDF se nepodařilo vytvořit. Zkuste to znovu.' });
    }
  },
);
