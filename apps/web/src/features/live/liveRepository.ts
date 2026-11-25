import { doc, getDocFromServer, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { watchPrivate } from '../access/api';
import type { EditorSlide } from '@filmovy-kviz/quiz-domain';

import { getFirebaseFirestore } from '../../services/firebase/firestore';
import { mapLiveControlSlide, mapLiveControlState, mapPublicLiveState } from './liveMappers';
import type { LiveControlSlide, LiveControlState, PublicLiveState } from './types';

type ValueHandler<T> = (value: T | null) => void;
type ErrorHandler = (error: Error) => void;

export function subscribeLiveControl(sessionId: string, onValue: ValueHandler<LiveControlState>, onError: ErrorHandler): Unsubscribe {
  return onSnapshot(doc(getFirebaseFirestore(), 'sessions', sessionId), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return;
    onValue(snapshot.exists() ? mapLiveControlState(snapshot.id, snapshot.data()) : null);
  }, onError);
}

export function subscribeLiveControlSlide(
  quizId: string,
  slideId: string,
  onValue: ValueHandler<LiveControlSlide>,
  onError: ErrorHandler,
): Unsubscribe {
  return watchPrivate<EditorSlide[]>('quizSlides', { quizId }, slides => {
    const slide = slides.find(item => item.id === slideId);
    onValue(slide ? mapLiveControlSlide(slide.id, { ...slide }) : null);
  }, onError);
}

export function subscribeLiveControlSlides(
  quizId: string,
  onValue: (value: readonly LiveControlSlide[]) => void,
  onError: ErrorHandler,
  snapshotId?: string,
  sessionId?: string,
): Unsubscribe {
  let version: string | undefined;
  const clear = () => { version = undefined; onValue([]); };
  const fail = (error: Error) => { version = undefined; onError(error); };
  const invalidated = () => fail(new Error('Přihlášení nebo oprávnění se změnilo.'));
  const mapSlides = (slides: EditorSlide[]) => slides.map(item => mapLiveControlSlide(item.id, { ...item }));
  const stop = snapshotId === undefined
    ? watchPrivate<EditorSlide[]>('quizSlides', { quizId }, slides => onValue(mapSlides(slides)), fail, 2000, invalidated)
    : watchPrivate<EditorSlide[] | { version: string; slides?: EditorSlide[] }>('snapshotSlides', () => ({
      snapshotId, ...(sessionId === undefined ? {} : { sessionId }), ...(version === undefined ? {} : { knownVersion: version }),
    }), result => {
      if (Array.isArray(result)) {
        version = undefined;
        onValue(mapSlides(result));
        return;
      }
      if (typeof result.version !== 'string' || !result.version) throw new Error('Chybí potvrzená verze obsahu kvízu.');
      if (result.slides === undefined) {
        if (version !== result.version) throw new Error('Aktuální obsah kvízu je potřeba znovu načíst.');
        return;
      }
      if (!Array.isArray(result.slides)) throw new Error('Obsah kvízu má neplatný formát.');
      const slides = mapSlides(result.slides);
      version = result.version;
      onValue(slides);
    }, fail, 2000, invalidated);
  return () => { stop(); clear(); };
}

export function subscribePublicLiveState(
  sessionId: string,
  onValue: ValueHandler<PublicLiveState>,
  onError: ErrorHandler,
): Unsubscribe {
  return onSnapshot(
    doc(getFirebaseFirestore(), 'publicSessions', sessionId),
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.metadata.fromCache) {
        onError(new Error('Refusing cached projector state.'));
        return;
      }
      onValue(snapshot.exists() ? mapPublicLiveState(snapshot.id, snapshot.data()) : null);
    },
    onError,
  );
}

export async function readPublicLiveStateFromServer(sessionId: string): Promise<PublicLiveState | null> {
  const snapshot = await getDocFromServer(doc(getFirebaseFirestore(), 'publicSessions', sessionId));
  return snapshot.exists() ? mapPublicLiveState(snapshot.id, snapshot.data()) : null;
}
