import { describe, expect, test } from 'vitest';

import { PrintCenterError } from '../functions/src/print/errors';
import { authorizePrintArtifact, parsePrintOptions, parsePrintRequestOptions } from '../functions/src/print/validation';

describe('legacy Print Center role compatibility helper', () => {
  // The HTTPS endpoint authorizes current membership permissions and event scope,
  // independently of this legacy role-only helper.
  test.each(['team-sheets', 'organizer-sheets', 'answer-key', 'score-table'] as const)('allows admin to generate %s', (artifact) => {
    expect(() => authorizePrintArtifact('admin', artifact)).not.toThrow();
  });

  test('allows moderator only non-answer documents', () => {
    expect(() => authorizePrintArtifact('moderator', 'team-sheets')).not.toThrow();
    expect(() => authorizePrintArtifact('moderator', 'score-table')).not.toThrow();
    expect(() => authorizePrintArtifact('moderator', 'answer-key')).toThrowError(PrintCenterError);
    expect(() => authorizePrintArtifact('moderator', 'organizer-sheets')).toThrowError(PrintCenterError);
  });

  test.each([undefined, null, 'ordinary', 'projector'])('denies non-staff role %s', (role) => {
    for (const artifactType of ['team-sheets', 'organizer-sheets', 'answer-key', 'score-table'] as const) {
      expect(() => authorizePrintArtifact(role, artifactType)).toThrowError(PrintCenterError);
    }
  });
});

describe('Print Center request allowlist', () => {
  test('accepts bounded typed team abstractions', () => {
    expect(parsePrintOptions({ artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] })).toEqual({ artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] });
    expect(parsePrintOptions({ artifactType: 'score-table', disposition: 'attachment', teams: [{ id: 'team-1', name: ' Žluťoučký tým ' }] })).toEqual({ artifactType: 'score-table', disposition: 'attachment', teams: [{ id: 'team-1', name: 'Žluťoučký tým' }] });
    expect(parsePrintRequestOptions({ artifactType: 'team-sheets', disposition: 'inline', mode: 'single', teamId: 'team-1' })).toEqual({ artifactType: 'team-sheets', disposition: 'inline', mode: 'single', teamId: 'team-1' });
  });

  test('accepts only transient presentation fields without supplying snapshot or roster data', () => {
    const request = { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', layout: 'compact', showLogo: false, showInstructions: true };
    expect(parsePrintRequestOptions(request)).toEqual(request);
    expect(parsePrintRequestOptions({ artifactType: 'answer-key', disposition: 'inline' })).toEqual({ artifactType: 'answer-key', disposition: 'inline' });
    for (const patch of [{ layout: 'screen' }, { layout: null }, { showLogo: 'false' }, { showInstructions: 1 }, { printTemplate: { title: 'Injected' } }, { teams: [{ id: 'fake', name: 'Injected' }] }]) {
      expect(() => parsePrintRequestOptions({ ...request, ...patch })).toThrowError(PrintCenterError);
    }
  });

  test.each(['answer-key', 'organizer-sheets'] as const)('accepts %s with the same presentation options and no roster', artifactType => {
    const request = { artifactType, disposition: 'attachment', layout: 'compact', colorMode: 'grayscale', showLogo: false, showInstructions: true };
    expect(parsePrintRequestOptions(request)).toEqual(request);
    expect(parsePrintOptions(request)).toEqual(request);
  });

  test.each(['answer-key', 'organizer-sheets'] as const)('rejects supplied answers, source and team fields on %s', artifactType => {
    for (const patch of [
      { answer: 'Soukromá odpověď' }, { correctAnswer: 'Soukromá odpověď' }, { correctAnswers: ['Soukromá odpověď'] },
      { answers: ['Soukromá odpověď'] }, { questions: [] }, { rounds: [] }, { quiz: {} }, { snapshotId: 'snapshot-1' },
      { mediaUrl: 'https://example.test/private' }, { printTemplate: { title: 'Injected' } },
      { mode: 'generic' }, { mode: 'all' }, { teamId: 'team-1' }, { teams: [] },
      { teams: [{ id: 'team-1', name: 'Injected', contactEmail: 'private@example.test' }] },
      { contact: 'private@example.test' },
    ]) {
      const payload = { artifactType, disposition: 'inline', ...patch };
      expect(() => parsePrintRequestOptions(payload)).toThrowError(PrintCenterError);
      expect(() => parsePrintOptions(payload)).toThrowError(PrintCenterError);
    }
  });

  test.each([undefined, null, false, 1, '', 'organizer', 'organizer-sheet', 'ORGANIZER-SHEETS', {}, []])('rejects invalid artifact type %j', artifactType => {
    const payload = { artifactType, disposition: 'inline' };
    expect(() => parsePrintRequestOptions(payload)).toThrowError(PrintCenterError);
    expect(() => parsePrintOptions(payload)).toThrowError(PrintCenterError);
  });

  test.each([
    { artifactType: 'answer-key', disposition: 'inline', correctAnswers: ['tajné'] },
    { artifactType: 'answer-key', disposition: 'inline', mediaUrl: 'https://example.test/private' },
    { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [], contact: 'private@example.test' },
  ])('rejects browser payload fields outside the allowlist', (payload) => {
    expect(() => parsePrintOptions(payload)).toThrowError(PrintCenterError);
  });

  test('enforces team count, uniqueness, and safe names', () => {
    const teams = Array.from({ length: 31 }, (_, index) => ({ id: `team-${index}`, name: `Tým ${index}` }));
    expect(() => parsePrintOptions({ artifactType: 'score-table', disposition: 'inline', teams })).toThrowError(PrintCenterError);
    expect(() => parsePrintOptions({ artifactType: 'score-table', disposition: 'inline', teams: [{ id: 'team-1', name: 'Tým' }, { id: 'team-2', name: 'tým' }] })).toThrowError(PrintCenterError);
    expect(() => parsePrintOptions({ artifactType: 'score-table', disposition: 'inline', teams: [{ id: 'team-1', name: 'Tým\u0000' }] })).toThrowError(PrintCenterError);
  });
});
