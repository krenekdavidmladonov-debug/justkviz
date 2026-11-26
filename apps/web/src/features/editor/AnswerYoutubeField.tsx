import { useContext, useEffect, useRef, useState } from 'react';
import { answerYoutubeVideoId, parseAnswerYoutubeClip, answerYoutubeMatchesPublicMedia, type EditorSlide } from '@filmovy-kviz/quiz-domain';

import { MediaAuthoringContext } from '../media/MediaUploadField';

function clipTime(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(text)) return Number(text);
  const match = /^(\d+):([0-5]\d(?:\.\d+)?)$/u.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

export function AnswerYoutubeField({ slide, disabled: disabledProp, onChange }: {
  readonly slide: EditorSlide;
  readonly disabled: boolean;
  readonly onChange: (slide: EditorSlide) => void;
}) {
  const mediaContext = useContext(MediaAuthoringContext);
  const disabled = disabledProp || mediaContext?.canAttach === false;
  const clip = slide.answerYoutubeClip;
  const [url, setUrl] = useState(clip ? 'https://youtu.be/' + clip.videoId : '');
  const [start, setStart] = useState(clip?.startSeconds === undefined ? '' : String(clip.startSeconds));
  const [end, setEnd] = useState(clip?.endSeconds === undefined ? '' : String(clip.endSeconds));
  const localClip = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (localClip.current === JSON.stringify(clip)) return;
    localClip.current = undefined;
    setUrl(clip ? 'https://youtu.be/' + clip.videoId : '');
    setStart(clip?.startSeconds === undefined ? '' : String(clip.startSeconds));
    setEnd(clip?.endSeconds === undefined ? '' : String(clip.endSeconds));
  }, [clip]);
  const sameAsPrompt = clip !== undefined && clip.videoId !== '' && answerYoutubeMatchesPublicMedia(clip, slide);
  const invalid = clip !== undefined && !parseAnswerYoutubeClip(clip);
  function update(nextUrl: string, nextStart: string, nextEnd: string) {
    if (nextUrl.trim() === '') {
      setUrl(''); setStart(''); setEnd('');
      const { answerYoutubeClip, ...rest } = slide;
      void answerYoutubeClip;
      localClip.current = JSON.stringify(undefined);
      onChange(rest);
      return;
    }
    const startSeconds = clipTime(nextStart), endSeconds = clipTime(nextEnd);
    const nextClip = {
      videoId: answerYoutubeVideoId(nextUrl) ?? '',
      ...(startSeconds === undefined ? {} : { startSeconds }),
      ...(endSeconds === undefined ? {} : { endSeconds }),
    };
    localClip.current = JSON.stringify(nextClip);
    onChange({ ...slide, answerYoutubeClip: nextClip });
  }
  return <fieldset className="editor-fieldset private-field" disabled={disabled} data-preflight-field="answerYoutubeClip">
    <legend>Ukázka odpovědi (YouTube)</legend>
    <label className="form-field">Odkaz na ukázku odpovědi<input type="url" value={url} onChange={event => {
      setUrl(event.target.value); update(event.target.value, start, end);
    }} /></label>
    {url.trim() !== '' && <div className="media-time-grid">
      <label className="form-field">Začátek ukázky odpovědi<input inputMode="decimal" placeholder="s nebo mm:ss" value={start} onChange={event => {
        setStart(event.target.value); update(url, event.target.value, end);
      }} /></label>
      <label className="form-field">Konec ukázky odpovědi<input inputMode="decimal" placeholder="s nebo mm:ss" value={end} onChange={event => {
        setEnd(event.target.value); update(url, start, event.target.value);
      }} /></label>
    </div>}
    {sameAsPrompt && <p className="field-validation error" role="alert">Ukázka odpovědi musí používat jiné YouTube video než zadání otázky.</p>}
    {invalid && <p className="field-validation error" role="alert">Zadejte platný odkaz YouTube a časování. Konec musí být po začátku.</p>}
    {clip && <button type="button" className="text-button" onClick={() => update('', '', '')}>Odebrat ukázku odpovědi</button>}
    <p className="field-help">Moderátor ji může spustit až po odhalení odpovědi. Časy jsou volitelné.</p>
  </fieldset>;
}
