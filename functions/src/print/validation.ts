import { PrintCenterError } from './errors.js';
import { PRINT_LIMITS } from './limits.js';
import type {
  PrintArtifactType,
  PrintDisposition,
  PrintOptions,
  PrintRequestOptions,
  PrintTeam,
  PrintPresentationOptions,
  TeamSheetMode,
} from './types.js';

const TEAM_NAME_MAX_LENGTH = 80;
function hasUnsafeText(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PRESENTATION_KEYS = ['layout', 'colorMode', 'showLogo', 'showInstructions'] as const;

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], presentation = false): void {
  const allowedSet = new Set([...allowed, ...(presentation ? PRESENTATION_KEYS : [])]);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new PrintCenterError(400, 'invalid-request', 'Požadavek obsahuje nepovolená pole.');
  }
}

function presentationOptions(value: Record<string, unknown>): PrintPresentationOptions {
  if (value.layout !== undefined && value.layout !== 'compact' && value.layout !== 'spacious') {
    throw new PrintCenterError(400, 'invalid-layout', 'Vyberte úsporné nebo prostorné archy.');
  }
  if (value.colorMode !== undefined && value.colorMode !== 'color' && value.colorMode !== 'grayscale') {
    throw new PrintCenterError(400, 'invalid-presentation', 'Vyberte barevný nebo černobílý tisk.');
  }
  for (const key of ['showLogo', 'showInstructions'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') {
      throw new PrintCenterError(400, 'invalid-presentation', 'Nastavení tisku není platné.');
    }
  }
  return {
    ...(value.layout === undefined ? {} : { layout: value.layout }),
    ...(value.colorMode === undefined ? {} : { colorMode: value.colorMode }),
    ...(value.showLogo === undefined ? {} : { showLogo: value.showLogo as boolean }),
    ...(value.showInstructions === undefined ? {} : { showInstructions: value.showInstructions as boolean }),
  };
}

function parseDisposition(value: unknown): PrintDisposition {
  if (value === 'inline' || value === 'attachment') return value;
  throw new PrintCenterError(400, 'invalid-disposition', 'Neplatný způsob doručení PDF.');
}

function parseArtifactType(value: unknown): PrintArtifactType {
  if (value === 'team-sheets' || value === 'organizer-sheets' || value === 'answer-key' || value === 'score-table') return value;
  throw new PrintCenterError(400, 'invalid-artifact', 'Neplatný typ dokumentu.');
}

function parseMode(value: unknown): TeamSheetMode {
  if (value === 'generic' || value === 'single' || value === 'all') return value;
  throw new PrintCenterError(400, 'invalid-mode', 'Neplatný režim hracích archů.');
}

function parseTeams(value: unknown): PrintTeam[] {
  if (!Array.isArray(value) || value.length > PRINT_LIMITS.teams) {
    throw new PrintCenterError(400, 'invalid-teams', `Počet týmů musí být nejvýše ${PRINT_LIMITS.teams}.`);
  }

  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new PrintCenterError(400, 'invalid-team', 'Neplatný tým.');
    }
    assertExactKeys(entry, ['id', 'name']);
    if (typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(entry.id)
      || typeof entry.name !== 'string') {
      throw new PrintCenterError(400, 'invalid-team-name', 'Název týmu musí být text.');
    }
    const name = entry.name.trim().normalize('NFC');
    if (!name || name.length > TEAM_NAME_MAX_LENGTH || hasUnsafeText(name)) {
      throw new PrintCenterError(400, 'invalid-team-name', 'Název týmu není platný.');
    }
    const key = name.toLocaleLowerCase('cs-CZ');
    if (seen.has(key)) {
      throw new PrintCenterError(400, 'duplicate-team', 'Názvy týmů se nesmí opakovat.');
    }
    seen.add(key);
    return { id: entry.id, name };
  });
}

export function parsePrintRequestOptions(value: unknown): PrintRequestOptions {
  if (!isRecord(value)) throw new PrintCenterError(400, 'invalid-request', 'Neplatný požadavek na PDF.');
  const artifactType = parseArtifactType(value.artifactType);
  const disposition = parseDisposition(value.disposition);
  const presentation = presentationOptions(value);
  if (artifactType === 'answer-key' || artifactType === 'organizer-sheets' || artifactType === 'score-table') {
    assertExactKeys(value, ['artifactType', 'disposition'], true);
    return { artifactType, disposition, ...presentation };
  }
  const mode = parseMode(value.mode);
  if (mode === 'single') {
    assertExactKeys(value, ['artifactType', 'disposition', 'mode', 'teamId'], true);
    if (typeof value.teamId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.teamId)) {
      throw new PrintCenterError(400, 'invalid-team', 'Neplatný tým.');
    }
    return { artifactType, disposition, mode, teamId: value.teamId, ...presentation };
  }
  assertExactKeys(value, ['artifactType', 'disposition', 'mode'], true);
  return { artifactType, disposition, mode, ...presentation };
}

export function parsePrintOptions(value: unknown): PrintOptions {
  if (!isRecord(value)) {
    throw new PrintCenterError(400, 'invalid-request', 'Neplatný požadavek na PDF.');
  }
  const artifactType = parseArtifactType(value.artifactType);
  const disposition = parseDisposition(value.disposition);
  const presentation = presentationOptions(value);

  if (artifactType === 'answer-key' || artifactType === 'organizer-sheets') {
    assertExactKeys(value, ['artifactType', 'disposition'], true);
    return { artifactType, disposition, ...presentation };
  }

  if (artifactType === 'score-table') {
    assertExactKeys(value, ['artifactType', 'disposition', 'teams'], true);
    const teams = parseTeams(value.teams);
    if (teams.length === 0) {
      throw new PrintCenterError(400, 'missing-teams', 'Bodovací tabulka vyžaduje alespoň jeden tým.');
    }
    return { artifactType, disposition, teams, ...presentation };
  }

  assertExactKeys(value, ['artifactType', 'disposition', 'mode', 'teams'], true);
  const mode = parseMode(value.mode);
  const teams = parseTeams(value.teams);
  if (mode === 'generic' && teams.length !== 0) {
    throw new PrintCenterError(400, 'unexpected-teams', 'Obecný arch nesmí obsahovat tým.');
  }
  if (mode === 'single' && teams.length !== 1) {
    throw new PrintCenterError(400, 'missing-team', 'Arch jednoho týmu vyžaduje právě jeden tým.');
  }
  if (mode === 'all' && teams.length === 0) {
    throw new PrintCenterError(400, 'missing-teams', 'Společné PDF vyžaduje alespoň jeden tým.');
  }
  return { artifactType, disposition, mode, teams, ...presentation };
}

export function authorizePrintArtifact(role: unknown, artifactType: PrintArtifactType): void {
  if (role === 'admin') return;
  if (role === 'moderator' && (artifactType === 'team-sheets' || artifactType === 'score-table')) return;
  throw new PrintCenterError(403, 'permission-denied', 'Pro tento dokument nemáte oprávnění.');
}
