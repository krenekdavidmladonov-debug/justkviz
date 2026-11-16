import type { DocumentData } from 'firebase/firestore';

import type {
  QuestionType,
  QuizQuestion,
  QuizRound,
  QuizStatus,
  QuizSummary,
  RoundType,
} from './types';

function requireString(data: DocumentData, field: string): string {
  const value: unknown = data[field];
  if (typeof value !== 'string') {
    throw new Error(`Invalid Firestore field: ${field}`);
  }
  return value;
}

function requireNumber(data: DocumentData, field: string): number {
  const value: unknown = data[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid Firestore field: ${field}`);
  }
  return value;
}

function isTimestampValue(value: unknown): value is { toDate(): Date } {
  return typeof value === 'object'
    && value !== null
    && 'toDate' in value
    && typeof value.toDate === 'function';
}

function requireDate(data: DocumentData, field: string): Date {
  const value: unknown = data[field];
  if (!isTimestampValue(value)) {
    throw new Error(`Invalid Firestore timestamp: ${field}`);
  }
  return value.toDate();
}

function requireQuizStatus(data: DocumentData): QuizStatus {
  const status = requireString(data, 'status');
  if (status !== 'draft' && status !== 'ready' && status !== 'archived') {
    throw new Error('Invalid Firestore field: status');
  }
  return status;
}

function requireQuestionType(data: DocumentData): QuestionType {
  const type = requireString(data, 'type');
  if (type !== 'text' && type !== 'image' && type !== 'audio' && type !== 'video' && type !== 'legacy') {
    throw new Error('Invalid Firestore field: type');
  }
  return type;
}

function requireRoundType(data: DocumentData): RoundType {
  const type = requireString(data, 'type');
  if (type !== 'classic' && type !== 'picture' && type !== 'audio') {
    throw new Error('Invalid Firestore field: type');
  }
  return type;
}

export function mapQuizSummary(id: string, data: DocumentData): QuizSummary {
  const disposition: unknown = data.disposition;
  const revision: unknown = data.revision;
  if (disposition !== undefined && disposition !== 'active' && disposition !== 'trash') {
    throw new Error('Invalid Firestore field: disposition');
  }
  if (revision !== undefined && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)) {
    throw new Error('Invalid Firestore field: revision');
  }
  return {
    id,
    revision: revision ?? 0,
    disposition: disposition ?? 'active',
    title: requireString(data, 'title'),
    description: requireString(data, 'description'),
    status: requireQuizStatus(data),
    createdAt: requireDate(data, 'createdAt'),
    updatedAt: requireDate(data, 'updatedAt'),
    createdBy: requireString(data, 'createdBy'),
    updatedBy: requireString(data, 'updatedBy'),
    roundCount: requireNumber(data, 'roundCount'),
    questionCount: requireNumber(data, 'questionCount'),
  };
}

export function mapQuizQuestion(id: string, data: DocumentData): QuizQuestion {
  return {
    id,
    type: requireQuestionType(data),
    prompt: requireString(data, 'prompt'),
    position: requireNumber(data, 'position'),
  };
}

export function mapQuizRound(
  id: string,
  data: DocumentData,
  questions: readonly QuizQuestion[],
): QuizRound {
  return {
    id,
    title: requireString(data, 'title'),
    type: requireRoundType(data),
    position: requireNumber(data, 'position'),
    questionCount: requireNumber(data, 'questionCount'),
    questions,
  };
}
