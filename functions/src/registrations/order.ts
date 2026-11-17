import { Timestamp } from 'firebase-admin/firestore';

export function registrationOrder<T extends { id: string; data(): Record<string, unknown> }>(documents: readonly T[]): T[] {
  return documents.map(document => ({ document, createdAt: document.data().createdAt })).sort((a, b) => {
    if (a.createdAt instanceof Timestamp && b.createdAt instanceof Timestamp) {
      const difference = a.createdAt.seconds - b.createdAt.seconds || a.createdAt.nanoseconds - b.createdAt.nanoseconds;
      if (difference) return difference;
    } else if (a.createdAt instanceof Timestamp) return -1;
    else if (b.createdAt instanceof Timestamp) return 1;
    return a.document.id < b.document.id ? -1 : a.document.id > b.document.id ? 1 : 0;
  }).map(({ document }) => document);
}
