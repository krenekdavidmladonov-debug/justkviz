import { pragueInstant } from '@filmovy-kviz/quiz-domain';
import type { EventFormValues } from './types';

export function eventFormInstant(values: Pick<EventFormValues, 'startsAt' | 'utcOffset'>): string {
  // New ambiguous autumn times use their earlier occurrence. Existing offsets retain the stored instant.
  return pragueInstant(values.startsAt, values.utcOffset || '+02:00');
}
