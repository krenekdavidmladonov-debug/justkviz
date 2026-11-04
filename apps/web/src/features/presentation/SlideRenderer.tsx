import { Brand } from '../../ui/Brand';
import { parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { AssetImage } from '../media/AssetImage';
import { useMemo, useState } from 'react';

import { productConfig } from '../../config/product';
import { buildSlideRenderModel, defaultRules, isSafeHttpUrl, projectorMediaPlan, recapAnswer } from './model';
import type { MediaPlaybackCommand, MediaPlaybackState, SlideRenderInput, SlideRenderMode } from './types';
import { MediaPlayer } from './MediaPlayer';
import { slideDesignStyle } from './design';
import './presentation.css';

function QuestionHeader({ number, count, legacyPl }: { readonly number?: number; readonly count?: number; readonly legacyPl: boolean }) {
  return (
    <div className="slide-question-label">
      <span>{number !== undefined && count !== undefined ? `OTÁZKA ${number} / ${count}` : 'OTÁZKA'}</span>
      {legacyPl && <span className="legacy-pl-badge">PRAVDA / LEŽ</span>}
    </div>
  );
}

function Options({ options }: { readonly options: readonly string[] }) {
  if (options.length === 0) return null;
  return (
    <ol className={`slide-options options-${Math.min(options.length, 6)}`}>
      {options.map((option, index) => (
        <li key={`${index}-${option}`}><span>{String.fromCharCode(65 + index)}</span><strong>{option}</strong></li>
      ))}
    </ol>
  );
}

function AgendaItems({ items }: { readonly items: readonly string[] }) {
  return (
    <ol className="agenda-items">
      {items.map((item, index) => <li key={`${index}-${item}`}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong></li>)}
    </ol>
  );
}

function QuestionImage({ source, overlay, sessionId }: { readonly source: string; readonly overlay: number; readonly sessionId?: string | undefined }) {
  return (
    <div className="question-image-frame">
      <AssetImage source={source} alt="Obrázek k otázce" sessionId={sessionId} />
      <span className="question-image-overlay" style={{ opacity: overlay / 100 }} aria-hidden="true" />
    </div>
  );
}

function QuestionCopy({ title, text }: { readonly title: string; readonly text: string }) {
  return (
    <div className="slide-copy">
      {title && <h1>{title}</h1>}
      {text && <p>{text}</p>}
    </div>
  );
}

export function SlideRenderer({
  slide,
  mediaSessionId,
  quizTitle,
  mode,
  mediaCommand = 'idle',
  mediaPlaybackState = 'idle',
  mediaGeneration = 0,
  introGeneration = 0,
  compact = false,
  mediaEnabled = true,
  playPrivateAudio = false,
  onMediaFinished,
  onMediaPlaybackState,
}: {
  readonly slide: SlideRenderInput;
  readonly mediaSessionId?: string;
  readonly quizTitle: string;
  readonly mode?: SlideRenderMode;
  readonly mediaCommand?: MediaPlaybackCommand;
  readonly mediaPlaybackState?: MediaPlaybackState;
  readonly mediaGeneration?: number;
  readonly introGeneration?: number;
  readonly compact?: boolean;
  readonly mediaEnabled?: boolean;
  readonly playPrivateAudio?: boolean;
  readonly onMediaFinished?: (generation: number) => void;
  readonly onMediaPlaybackState?: (
    generation: number,
    state: Extract<MediaPlaybackState, 'ready' | 'playing' | 'error'>,
    message?: string,
  ) => void;
}) {
  const model = useMemo(() => buildSlideRenderModel(slide, mode), [mode, slide]);
  const [locallyFinishedGeneration, setLocallyFinishedGeneration] = useState<number>();
  const [locallyFailed, setLocallyFailed] = useState<{ readonly generation: number; readonly source?: string }>();
  const mediaFinished = mediaCommand === 'finished' || locallyFinishedGeneration === mediaGeneration;
  const mediaFailed = mediaCommand === 'error'
    || (locallyFailed?.generation === mediaGeneration && locallyFailed.source === model.mediaSource);
  const mediaPlan = projectorMediaPlan(model, mediaCommand, mediaPlaybackState, mediaFinished, mediaFailed);
  const showMediaError = !mediaFinished && (mediaCommand === 'play' || mediaCommand === 'replay' || mediaCommand === 'error')
    && (mediaFailed || mediaPlaybackState === 'error');
  const showAnswer = model.renderMode === 'recap' && model.revealedAnswer !== undefined;
  const displayedAnswer = showAnswer ? recapAnswer(model) : undefined;
  const visibleMode = model.renderMode === 'editorPreview' ? 'editorPreview' : model.renderMode;
  const questionHeader = model.design.showQuestionNumber === false ? null
    : <QuestionHeader number={model.questionNumber} count={model.questionCount} legacyPl={model.isLegacyPl} />;
  const layout = model.design.layout ?? (slide.imageLayout === 'full' ? 'image-first' : model.contentKind === 'image' || model.contentKind === 'audio' ? 'split' : 'classic');
  const textLength = model.title.length + model.text.length + model.options.join('').length;
  const density = textLength > 650 || model.options.length > 6 ? 'dense' : textLength > 350 ? 'medium' : 'normal';
  const finish = (generation: number) => {
    if (generation !== mediaGeneration) return;
    setLocallyFinishedGeneration(generation);
    onMediaFinished?.(generation);
  };
  const fail = (generation: number, message: string) => {
    if (generation !== mediaGeneration) return;
    setLocallyFailed({ generation, ...(model.mediaSource === undefined ? {} : { source: model.mediaSource }) });
    onMediaPlaybackState?.(generation, 'error', message);
  };
  const playback = (generation: number, state: Extract<MediaPlaybackState, 'ready' | 'playing'>) => {
    if (generation !== mediaGeneration) return;
    onMediaPlaybackState?.(generation, state);
  };
  const answerContent = displayedAnswer && (
    <section className="slide-answer">
      <span>SPRÁVNÁ ODPOVĚĎ</span>
      <div className="slide-answer-value">
        {displayedAnswer.optionLetter && <span className="slide-answer-letter">{displayedAnswer.optionLetter}</span>}
        <strong>{displayedAnswer.text}</strong>
      </div>
      {slide.answerExplanation && <p>{slide.answerExplanation}</p>}
      {model.answerImage && <AssetImage source={model.answerImage} alt="Obrázek odpovědi" sessionId={mediaSessionId} />}
    </section>
  );
  const vinyl = <div className={`vinyl-visual ${mediaPlan.vinylPlaying ? 'is-playing' : ''}`} aria-label={mediaPlan.vinylPlaying ? 'Audio se přehrává' : 'Audio je připravené'}>
    <div className="vinyl-disc"><div className="vinyl-label">{productConfig.shortName}</div></div><div className="vinyl-arm" />
    <span>{mediaPlan.vinylPlaying ? 'PŘEHRÁVÁ SE AUDIO' : mediaFinished ? 'AUDIO DOHRÁLO' : 'AUDIO OTÁZKA'}</span>
  </div>;

  let content;
  if (model.renderMode === 'recap' && model.contentKind === 'recap') {
    content = <div className="slide-centered"><p className="slide-kicker">REKAPITULACE KOLA</p><h1>{model.title || 'Vyberte otázku'}</h1><p>{model.text || 'Moderátor postupně zobrazí vybrané odpovědi.'}</p></div>;
  } else if (model.mediaSource && (model.contentKind === 'video' || (model.contentKind === 'audio' && (playPrivateAudio || model.renderMode === 'recap')))) {
    const recap = model.renderMode === 'recap';
    const showFrame = recap || (model.contentKind === 'video' && !mediaPlan.showQuestion);
    const mountPlayer = mediaPlan.mountPlayer || (playPrivateAudio && model.contentKind === 'audio' && !mediaFailed);
    const sharedLayout = recap ? `recap-layout recap-${model.contentKind} shared-media-recap`
      : model.contentKind === 'audio' ? 'audio-layout'
        : `video-layout ${mediaPlan.showQuestion ? 'question-layout question-video' : 'video-presentation'}`;
    content = (
      <div className={`slide-layout shared-media-layout ${sharedLayout}`}>
        <div className="video-question-copy">{questionHeader}<QuestionCopy title={model.title} text={model.text} />{!recap && <Options options={model.options} />}</div>
        <div className={`shared-media-frame ${recap ? 'recap-media-frame' : 'video-media-frame'}${showFrame ? '' : ' is-hidden'}`} aria-hidden={!showFrame} inert={!showFrame}>
          {mediaEnabled && mountPlayer && <MediaPlayer
            sessionId={mediaSessionId}
            allowManualAutoplay={model.contentKind === 'video' || model.mediaPlaybackMode === 'original'}
            source={model.mediaSource}
            command={mediaCommand}
            generation={mediaGeneration}
            startSeconds={mediaPlan.startSeconds}
            endSeconds={mediaPlan.endSeconds}
            className={`youtube-player-shell ${recap ? 'recap-player' : 'projector-video-player'}`}
            onFinished={finish}
            onError={fail}
            onPlaybackState={playback}
          />}
        </div>
        {recap ? answerContent : model.contentKind === 'audio' ? vinyl : null}
      </div>
    );
  } else if (model.renderMode === 'recap') {
    content = (
      <div className={`slide-layout recap-layout recap-${model.contentKind}`}>
        {questionHeader}
        <QuestionCopy title={model.title} text={model.text} />
        {model.contentKind === 'image' && model.questionImage && (isSafeHttpUrl(model.questionImage) || Boolean(parseQuizAsset(model.questionImage))) && (
          <QuestionImage sessionId={mediaSessionId} source={model.questionImage} overlay={0} />
        )}
        {answerContent}
      </div>
    );
  } else if (model.contentKind === 'agenda') {
    content = <div className="slide-centered slide-list"><p className="slide-kicker">PROGRAM VEČERA</p><h1>{model.title || 'Dnešní kola'}</h1>{model.text && <p>{model.text}</p>}<AgendaItems items={model.options} /></div>;
  } else if (model.contentKind === 'rules') {
    content = <div className="slide-centered slide-list"><p className="slide-kicker">PRAVIDLA</p><h1>{model.title || 'Hrajeme fér'}</h1>{model.text && <p>{model.text}</p>}<AgendaItems items={model.options.length > 0 ? model.options : defaultRules} /></div>;
  } else if (model.contentKind === 'intro' || model.contentKind === 'roundIntro') {
    content = <div key={introGeneration} className={`slide-centered round-intro-content ${introGeneration > 0 ? 'intro-running' : ''}`}><p className="slide-kicker">{model.contentKind === 'intro' ? 'VÍTEJTE NA KVÍZU' : 'NOVÉ KOLO'}</p><h1>{model.title || quizTitle}</h1>{model.text && <p>{model.text}</p>}</div>;
  } else if (model.contentKind === 'end') {
    content = <div className="slide-centered"><p className="slide-kicker">DĚKUJEME</p><h1>{model.title || 'To je pro dnešek vše'}</h1>{model.text && <p>{model.text}</p>}</div>;
  } else if (model.contentKind === 'audio') {
    content = (
      <div className="slide-layout audio-layout">
        {questionHeader}
        <QuestionCopy title={model.title} text={model.text} />
        <Options options={model.options} />{vinyl}
      </div>
    );
  } else {
    content = (
      <div className={`slide-layout question-layout question-${model.contentKind}`}>
        {model.isQuestionLike && questionHeader}
        {!model.isQuestionLike && <p className="slide-kicker">{model.contentKind === 'info' ? 'DNEŠNÍ VEČER' : 'JUSTKVÍZ'}</p>}
        <QuestionCopy title={model.title || (model.contentKind === 'legacy' ? 'Legacy slide' : '')} text={model.text} />
        {model.contentKind === 'image' && model.questionImage && (isSafeHttpUrl(model.questionImage) || Boolean(parseQuizAsset(model.questionImage))) && (
          <QuestionImage sessionId={mediaSessionId} source={model.questionImage} overlay={0} />
        )}
        <Options options={model.contentKind === 'free' ? [] : model.options} />
      </div>
    );
  }

  return (
    <article data-media-playback-mode={model.mediaPlaybackMode} style={slideDesignStyle(model.design)} className={`slide-renderer mode-${visibleMode} kind-${model.contentKind} layout-${layout} align-${model.design.textAlign ?? 'left'} density-${density}${model.design.backgroundColor ? ' has-custom-background' : ''} image-layout-${slide.imageLayout ?? 'split'}${compact ? ' is-compact' : ''}`}>
      <div className="slide-background" aria-hidden="true">{model.backgroundImage && <AssetImage source={model.backgroundImage} alt="" sessionId={mediaSessionId} />}</div>
      <div className="slide-background-overlay" style={{ opacity: model.backgroundOverlay / 100 }} aria-hidden="true" />
      <div className="slide-safe-area">
        <header className="slide-brand"><span>{quizTitle}</span>{model.design.showLogo !== false && (model.design.logoImage ? <span className="slide-custom-logo"><AssetImage source={model.design.logoImage} alt="Logo pořadatele" sessionId={mediaSessionId} /></span> : <Brand />)}</header>
        {content}
        {model.design.showRoundTitle !== false && model.roundTitle && model.isQuestionLike && <footer className="slide-round-title">{model.roundTitle}</footer>}
        {showMediaError && <p className="projector-media-error" role="status">Médium se nepodařilo přehrát. Moderátor může použít Pustit znovu nebo pokračovat otázkou.</p>}
      </div>
    </article>
  );
}
