import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { directMediaKind, originalYoutubeSource, parseQuizAsset, visibleSlidePosition } from '@filmovy-kviz/quiz-domain';

import { SlideRenderer } from '../presentation/SlideRenderer';
import { ShowModeRenderer } from '../show-mode/ShowModeRenderer';
import '../events/event-navigation.css';
import { MediaPlayer } from '../presentation/MediaPlayer';
import { HumanError, type HumanErrorValue } from '../../ui/HumanError';
import { TechnicalDetails } from '../../ui/TechnicalDetails';
import {
  currentQuestionLabel,
  currentRoundLabel,
  humanSlideLabel,
  isAudioSlide,
  isMediaSlide,
  liveMediaSource,
  liveStatusLabel,
  type RecapQuestionChoice,
} from './livePresentation';
import type { LiveControlSlide, LiveControlState, PublicLiveState } from './types';
import { liveNavigationDirection } from './navigationKeys';
import { entersFinale } from './eventNightFlow';
import { nextPrivateLiveMediaReferences, usePrivateMediaReferencesPrefetch } from '../media/usePrivateMediaPrefetch';
import { LiveQuestionNavigator } from './LiveQuestionNavigator';

export type LivePendingAction = 'previous' | 'next' | 'jump' | 'recap' | 'reveal' | 'hide' | 'play' | 'stop' | 'replay' | 'end' | 'show';

interface LiveModeratorViewProps {
  readonly session: LiveControlState;
  readonly publicState?: PublicLiveState | null;
  readonly slides: readonly LiveControlSlide[];
  readonly currentSlide?: LiveControlSlide;
  readonly presentedSlide?: LiveControlSlide;
  readonly recapChoices: readonly RecapQuestionChoice[];
  readonly pendingAction: LivePendingAction | null;
  readonly error: HumanErrorValue | null;
  readonly projectorOpened: boolean;
  readonly audioSuppressed?: boolean;
  readonly eventControls?: ReactNode;
  readonly onOpenProjector: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onReveal?: () => void;
  readonly onHide?: () => void;
  readonly onGoToSlide: (position: number) => void;
  readonly onFinale?: () => void;
  readonly onSelectRecap: (position: number) => void;
  readonly onPlay: () => void;
  readonly onPlayOriginal?: () => void;
  readonly onStop: () => void;
  readonly onReplay: () => void;
  readonly onEnd: () => void;
  readonly onMediaFinished: (generation: number) => void;
  readonly onMediaError: (generation: number, message: string) => void;
  readonly onMediaPlayback: (generation: number, state: 'ready' | 'playing') => void;
}

function pendingLabel(action: LivePendingAction | null, key: LivePendingAction, idle: string): string {
  if (action !== key) return idle;
  if (key === 'play' || key === 'replay') return 'Spouštím…';
  if (key === 'stop') return 'Zastavuji…';
  if (key === 'end') return 'Ukončuji…';
  if (key === 'reveal') return 'Odhaluji…';
  if (key === 'hide') return 'Skrývám…';
  return idle;
}

export function LiveModeratorView({
  session,
  publicState,
  slides,
  currentSlide,
  presentedSlide,
  recapChoices,
  pendingAction,
  error,
  projectorOpened,
  audioSuppressed = false,
  eventControls,
  onOpenProjector,
  onPrevious,
  onNext,
  onReveal,
  onHide,
  onGoToSlide,
  onFinale,
  onSelectRecap,
  onPlay,
  onPlayOriginal,
  onStop,
  onReplay,
  onEnd,
  onMediaFinished,
  onMediaError,
  onMediaPlayback,
}: LiveModeratorViewProps) {
  const pending = pendingAction !== null || session.interimResults !== undefined || (session.finalReveal?.visible === true && !eventControls);
  const finalActive = session.finalReveal?.visible === true;
  const nextBlocked = finalActive && session.finalReveal?.mode !== 'table';
  const ended = session.status === 'ended';
  usePrivateMediaReferencesPrefetch(
    currentSlide ? nextPrivateLiveMediaReferences(session.quizId, slides, currentSlide.id) : [],
    !ended && !session.interimResults && !finalActive,
    session.sessionId,
  );
  const source = session.interimResults || session.finalReveal?.visible ? undefined : liveMediaSource(presentedSlide);
  const roundLabel = currentRoundLabel(currentSlide);
  const questionLabel = currentQuestionLabel(session, currentSlide, presentedSlide, slides);
  const recapTitle = currentSlide?.roundTitle?.trim() || 'Aktuální kolo';
  const navigationSourceAvailable = slides.length > 0 && (session.currentSlidePosition === 0
    || slides.some(slide => slide.position === session.currentSlidePosition));
  const nextPosition = visibleSlidePosition(slides, session.currentSlidePosition, 1);
  const canNext = navigationSourceAvailable && (nextPosition !== undefined || (Boolean(eventControls) && (currentSlide?.kind.toLowerCase() !== 'end' || finalActive)));
  const previousPosition = visibleSlidePosition(slides, session.currentSlidePosition, -1);
  const canPrevious = navigationSourceAvailable && (previousPosition !== undefined || (Boolean(eventControls) && finalActive));
  const nextSlide = slides.find(slide => slide.position === nextPosition);
  const finaleNext = Boolean(eventControls) && !finalActive && entersFinale(slides, session.currentSlidePosition, 1);
  const nextRecap = recapChoices.find(choice => choice.slide.position > (session.recapQuestionPosition ?? 0));
  const mediaLabels = { idle: 'Připraveno ke spuštění', preparing: 'Načítá se', ready: 'Připraveno', playing: 'Přehrává se', finished: 'Dohrálo', error: 'Přehrávání se nezdařilo' };
  const navigationRequested = useRef(false);

  useEffect(() => {
    navigationRequested.current = false;
  }, [pendingAction, session.revision, session.sessionId]);

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      const direction = liveNavigationDirection(event);
      if (direction === undefined) return;
      event.preventDefault();
      if (pending || ended || navigationRequested.current || (direction === 1 && nextBlocked)
        || (direction === -1 ? !canPrevious : !canNext)) return;
      // Block a second key event before React has rendered the pending state.
      navigationRequested.current = true;
      if (direction === -1) onPrevious();
      else onNext();
    };
    document.addEventListener('keydown', navigate);
    return () => document.removeEventListener('keydown', navigate);
  }, [pending, ended, canPrevious, canNext, nextBlocked, onPrevious, onNext]);

  return (
    <article
      className="live-control focused-live-shell"
      data-current-position={session.currentSlidePosition}
      data-presentation-mode={session.presentationMode}
    >
      <header className="focused-live-header">
        <Link className="live-back-link" to={session.eventId ? `/admin/events/${encodeURIComponent(session.eventId)}` : `/admin/quizzes/${encodeURIComponent(session.quizId)}`}>← Zpět na detail</Link>
        <div className="live-title-context">
          <span>{roundLabel}</span>
          <h1>{session.quizTitle}</h1>
        </div>
        <div className="live-progress" aria-label="Aktuální stav kvízu">
          <span>{liveStatusLabel(session.status)}</span>
          <strong>{questionLabel}</strong>
        </div>
      </header>

      {error && <HumanError error={error} />}

      <section className="live-workspace">
        <section className="moderator-info-panel" aria-labelledby="moderator-info-title">
          <p className="panel-label" id="moderator-info-title">Soukromé · pouze pro moderátora</p>
          {presentedSlide?.isQuestion ? (
            <div className="moderator-answer" data-private-answer="true">
              <span>Správná odpověď</span>
              <strong>{presentedSlide.correctAnswer || 'Odpověď není textově dostupná'}</strong>
            </div>
          ) : (
            <p className="moderator-empty">Správná odpověď se zobrazí u otázky.</p>
          )}
          <details className="moderator-context-details" open={eventControls ? undefined : true}>
          <summary>Poznámky a další obsah</summary>
          {presentedSlide?.moderatorNote && (
            <div className="moderator-note"><span>Poznámka moderátora</span><p>{presentedSlide.moderatorNote}</p></div>
          )}
          <div className="live-next-step"><span className="panel-label">Následuje</span><strong>{finaleNext ? 'Finální vyhlášení' : nextSlide ? humanSlideLabel(nextSlide) : 'Konec prezentace'}</strong><p>{finaleNext ? 'Automatické odhalení pořadí a vítězů.' : nextSlide?.title || nextSlide?.text || 'Konec kvízu.'}</p></div>
          {session.eventId && <p><Link className="secondary-link" to={`/admin/events/${session.eventId}/scoring`} target="_blank" rel="noreferrer">Týmy a bodování ↗</Link></p>}
          </details>
        </section>

        <aside className="live-actions" aria-label="Ovládání kvízu">
          <button className="secondary-button live-wide-action" type="button" onClick={onOpenProjector}>
            {projectorOpened ? 'Aktivovat okno' : 'Otevřít projektor'}
          </button>

          <div className="live-button-row primary-live-controls">
            <button className="secondary-button" type="button" title="Předchozí (←)" disabled={pending || ended || !canPrevious} onClick={onPrevious}>
              ← Předchozí
            </button>
            <button className="primary-button" type="button" title="Další (→ nebo mezerník)" disabled={pending || ended || nextBlocked || !canNext} onClick={onNext}>
              Další →
            </button>
          </div>

          <LiveQuestionNavigator slides={slides} currentPosition={session.currentSlidePosition} disabled={pendingAction !== null || ended} onSelect={onGoToSlide} onFinale={onFinale} />

          {!finalActive && session.presentationMode === 'slide' && presentedSlide?.isQuestion && onReveal && onHide && (
            <button className="primary-button live-wide-action" type="button" disabled={pending || ended || !presentedSlide.correctAnswer} onClick={session.answerRevealed ? onHide : onReveal}>
              {session.answerRevealed ? pendingLabel(pendingAction, 'hide', 'Skrýt odpověď') : pendingLabel(pendingAction, 'reveal', 'Odhalit odpověď')}
            </button>
          )}

          {!finalActive && !session.interimResults && session.presentationMode === 'recap' && (
            <section className="recap-controls" aria-labelledby="recap-controls-title">
              <div><span className="panel-label">Rekapitulace</span><strong id="recap-controls-title">{recapTitle}</strong></div>
              <button className="primary-button live-wide-action" type="button" disabled={pending || ended || !nextRecap?.slide.correctAnswer} onClick={() => { if (nextRecap) onSelectRecap(nextRecap.slide.position); }}>Odhalit další odpověď</button>
              <div className="recap-question-buttons" aria-label="Otázky aktuálního kola">
                {recapChoices.map(({ localNumber, slide }) => (
                  <button
                    key={slide.id}
                    type="button"
                    className={slide.id === session.recapQuestionId ? 'selected' : ''}
                    aria-label={`Zobrazit odpověď na otázku ${localNumber}`}
                    aria-pressed={slide.id === session.recapQuestionId}
                    disabled={pending || !slide.correctAnswer}
                    onClick={() => onSelectRecap(slide.position)}
                  >{localNumber}</button>
                ))}
              </div>
              {recapChoices.length === 0 && <p className="field-help">Pro toto kolo nejsou dostupné otázky k rekapitulaci.</p>}
            </section>
          )}

          {isMediaSlide(presentedSlide) && presentedSlide && source && (
            <section className="media-controls" aria-labelledby="media-controls-title">
              <div>
                <span className="panel-label">Médium</span>
                <strong id="media-controls-title">{isAudioSlide(presentedSlide) && session.presentationMode === 'slide' ? 'Audio na tomto zařízení' : 'Ovládání přehrávání'}</strong>
                <p role="status">{mediaLabels[session.mediaPlaybackState]}</p>
              </div>
              <div className="media-button-row">
                <button className="primary-button" type="button" disabled={pending || ended} onClick={onPlay}>{pendingLabel(pendingAction, 'play', 'Play')}</button>
                <button className="secondary-button" type="button" disabled={pending || ended} onClick={onStop}>{pendingLabel(pendingAction, 'stop', 'Stop')}</button>
                <button className="secondary-button" type="button" disabled={pending || ended} onClick={onReplay}>{pendingLabel(pendingAction, 'replay', 'Pustit znovu')}</button>
              </div>
              {session.answerRevealed && originalYoutubeSource(presentedSlide) && onPlayOriginal && <button type="button" className="secondary-button" disabled={pending || ended} onClick={onPlayOriginal}>Přehrát celé původní video z YouTube</button>}
              {session.mediaPlaybackMode === 'original' && <p className="field-help">Celé původní video · přetáčení je dostupné přímo v přehrávači projektoru. Play spustí znovu připravenou ukázku.</p>}
              {isAudioSlide(presentedSlide) && session.presentationMode === 'slide' && session.mediaPlaybackMode !== 'original' && !audioSuppressed && (
                <MediaPlayer
                  source={source}
                  command={session.mediaCommand}
                  generation={session.mediaGeneration}
                  startSeconds={presentedSlide.clipStartSeconds ?? presentedSlide.presentation.videoStart ?? 0}
                  endSeconds={presentedSlide.clipEndSeconds ?? presentedSlide.presentation.videoEnd ?? undefined}
                  className={`youtube-player-shell moderator-audio-player${parseQuizAsset(source) || directMediaKind(source) ? ' moderator-native-audio' : ''}`}
                  onFinished={onMediaFinished}
                  onError={onMediaError}
                  onPlaybackState={onMediaPlayback}
                />
              )}
            </section>
          )}
          {isMediaSlide(presentedSlide) && !source && !finalActive && !session.interimResults && (
            <p className="media-warning" role="status">Médium nemá zdroj. Otázka zůstává zobrazená bez přehrávání.</p>
          )}

          {eventControls}

          <details className="live-danger-area">
            <summary>Další možnosti</summary>
            <button className="danger-button" type="button" disabled={pendingAction !== null || ended} onClick={onEnd}>
              {pendingLabel(pendingAction, 'end', 'Ukončit kvíz')}
            </button>
          </details>

          <TechnicalDetails>
            <dl className="technical-data-list">
              <div><dt>Verze stavu</dt><dd>{session.revision}</dd></div>
              <div><dt>Interní pozice</dt><dd>{session.currentSlidePosition} / {session.slideCount}</dd></div>
              <div><dt>Typ obsahu</dt><dd>{humanSlideLabel(currentSlide)}</dd></div>
              <div><dt>Identifikátor relace</dt><dd>{session.sessionId}</dd></div>
            </dl>
          </TechnicalDetails>
        </aside>

        <details className="live-preview-panel" open>
          <summary>Co vidí projektor</summary>
          <div className="live-preview-stage">
            {session.status === 'waiting' ? (
              <div className="live-preview-message"><h2>Projektor čeká</h2><p>Tlačítkem Další zobrazíte první obsah.</p></div>
            ) : ended ? (
              <div className="live-preview-message"><h2>Kvíz byl ukončen</h2><p>Projektor zobrazuje závěrečný stav.</p></div>
            ) : publicState ? (
              <ShowModeRenderer state={publicState}>
              <SlideRenderer
                compact
                mediaSessionId={session.sessionId}
                quizTitle={publicState.quizTitle}
                mode={publicState.renderMode}
                mediaCommand="idle"
                slide={{
                  ...publicState,
                  kind: publicState.slideKind ?? 'info',
                  title: publicState.title ?? '',
                  text: publicState.text ?? '',
                }}
              />
              </ShowModeRenderer>
            ) : (
              <div className="live-preview-message" aria-live="polite"><p>Načítám obsah…</p></div>
            )}
          </div>
        </details>
      </section>
    </article>
  );
}
