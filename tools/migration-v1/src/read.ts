import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { MigrationInputError } from './errors.js';
import type { JsonObject, JsonValue, V1LibrarySnapshot } from './types.js';

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return typeof value !== 'number' || Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return typeof value === 'object'
    && Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isJsonValue(value) && value !== null && !Array.isArray(value) && typeof value === 'object';
}

function parseSnapshot(value: unknown): V1LibrarySnapshot {
  if (!isJsonObject(value)) {
    throw new MigrationInputError('library.json must contain a JSON object.');
  }

  if (value.schemaVersion !== 1 || value.collection !== 'library' || !Array.isArray(value.documents)) {
    throw new MigrationInputError(
      'library.json must use { schemaVersion: 1, collection: "library", documents: [...] }.',
    );
  }

  const seenIds = new Set<string>();
  const documents = value.documents.map((document, index) => {
    if (!isJsonObject(document) || typeof document.id !== 'string' || !isJsonObject(document.data)) {
      throw new MigrationInputError(`Invalid library document at index ${index}.`);
    }
    if (document.id.length === 0 || document.id.includes('/')) {
      throw new MigrationInputError(`Library document at index ${index} has an invalid id.`);
    }
    if (seenIds.has(document.id)) {
      throw new MigrationInputError(`Duplicate library document id: ${document.id}`);
    }
    seenIds.add(document.id);
    return { id: document.id, data: document.data };
  });

  return { schemaVersion: 1, collection: 'library', documents };
}

async function resolveInputFile(inputPath: string): Promise<string> {
  let inputStat;
  try {
    inputStat = await stat(inputPath);
  } catch {
    throw new MigrationInputError(`Migration input does not exist: ${inputPath}`);
  }

  if (inputStat.isFile()) {
    if (inputPath.endsWith('.overall_export_metadata') || inputPath.endsWith('.export_metadata')) {
      throw new MigrationInputError(
        'Managed Firestore exports use LevelDB logs and protobuf metadata. They are not parsed directly; follow docs/archive/MIGRATION_V1.md.',
      );
    }
    return inputPath;
  }

  if (!inputStat.isDirectory()) {
    throw new MigrationInputError(`Migration input is neither a file nor a directory: ${inputPath}`);
  }

  const entries = await readdir(inputPath);
  if (entries.some((entry) => entry.endsWith('.overall_export_metadata') || entry.endsWith('.export_metadata'))) {
    throw new MigrationInputError(
      'A managed Firestore export was detected. Do not invent a parser; use the documented emulator conversion workflow first.',
    );
  }

  const libraryFile = path.join(inputPath, 'library.json');
  try {
    if ((await stat(libraryFile)).isFile()) {
      return libraryFile;
    }
  } catch {
    // The actionable error below is safer than exposing directory contents.
  }
  throw new MigrationInputError(`Expected ${libraryFile}.`);
}

export async function readV1Library(inputPath: string): Promise<V1LibrarySnapshot> {
  const filePath = await resolveInputFile(inputPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown JSON error';
    throw new MigrationInputError(`Cannot parse library snapshot: ${reason}`);
  }
  return parseSnapshot(parsed);
}
