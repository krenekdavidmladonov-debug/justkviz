import { describe, expect, test } from 'vitest';
import { mapEditorSlide, mapEditorQuiz, runQuizPreflight, validateQuestion, parseAnswerYoutubeClip, answerYoutubeVideoId, directMediaKind, youtubeVideoId } from '../packages/quiz-domain/src/index';
import { applyKnownSlideUpdate } from '../functions/src/editor/model';
import { validateSlideInput } from '../functions/src/editor/validation';
import { publicMediaAllowed } from '../functions/src/media/model';
const stored = {
  kind: 'image', position: 1, isQuestion: true, title: '', text: 'Syntetické zadání', correctAnswer: 'Soukromá odpověď', options: [],
  media: [{ role: 'prompt', kind: 'image', value: 'https://example.test/prompt.png', vendor: 12 }, { role: 'answer', kind: 'image', value: 'https://example.test/answer.png' }, { role: 'background', kind: 'image', value: 'https://example.test/background.png' }],
  presentation: { unknownControl: { retained: true } }, legacy: { raw: { keep: true } }, unknownTop: { keep: true },
};
describe('media authoring boundaries', () => {
  test('unchanged roles preserve exact absent keys and legacy; empty is explicit removal after reload', () => {
    const view = mapEditorSlide('slide', stored);
    const input = validateSlideInput({ ...view, text: 'Upravený text' });
    const saved = applyKnownSlideUpdate(stored, input);
    for (const key of ['media', 'legacy', 'unknownTop', 'correctAnswer']) expect(saved[key]).toEqual(stored[key as keyof typeof stored]);
    for (const key of ['questionImage', 'answerImage', 'backgroundImage']) expect(saved).not.toHaveProperty(key);
    const removed = applyKnownSlideUpdate(stored, validateSlideInput({ ...view, answerImage: '', backgroundImage: '' }));
    const reloaded = mapEditorSlide('slide', removed);
    expect(reloaded.answerImage).toBe(''); expect(reloaded.backgroundImage).toBe(''); expect(reloaded.questionImage).toBe(view.questionImage);
    expect(removed.media).toEqual(stored.media); expect(removed.legacy).toEqual(stored.legacy);
  });
  test('source replacement requires valid new interval; unchanged imported sentinel survives text save', () => {
    const old = { ...stored, kind: 'audio', mediaSource: 'abcdefghijk', clipStartSeconds: 0, presentation: { videoStart: 0, videoEnd: 0 } };
    const view = mapEditorSlide('slide', old);
    const saved = applyKnownSlideUpdate(old, validateSlideInput({ ...view, text: 'Nové zadání' }));
    expect(saved.clipStartSeconds).toBe(0); expect(saved).not.toHaveProperty('clipEndSeconds');
    expect(() => applyKnownSlideUpdate(old, validateSlideInput({ ...view, mediaSource: 'https://example.test/new.wav' }))).toThrow(/začátek/);
    expect(() => applyKnownSlideUpdate(old, validateSlideInput({ ...view, mediaSource: 'https://example.test/page.html', clipStartSeconds: 0, clipEndSeconds: 2 }))).toThrow(/zdroj/);
  });
  test('URL adapters recognize supported files and YouTube variants, never active schemes or credentials', () => {
    expect(directMediaKind('https://example.test/sound.wav?version=2')).toBe('audio');
    expect(directMediaKind('https://example.test/movie.mp4')).toBe('video');
    for (const path of ['https://youtu.be/abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk', 'https://youtube.com/shorts/abcdefghijk']) expect(youtubeVideoId(path)).toBe('abcdefghijk');
    for (const path of ['javascript:alert(1)', 'blob:local', 'file:///sound.wav', 'https://user:secret@example.test/a.wav', 'https://example.test/frame.html']) expect(directMediaKind(path)).toBeUndefined();
    expect(youtubeVideoId('javascript://youtube.com/watch?v=abcdefghijk')).toBeUndefined();
  });
  test('background can be public while answer stays private until explicit reveal; navigation revokes both', () => {
    const bg = 'quiz-asset:quiz/' + 'a'.repeat(64), answer = 'quiz-asset:quiz/' + 'b'.repeat(64);
    const state = { status: 'active', slideKind: 'image', backgroundImage: bg, answerImage: answer, answerRevealed: false };
    expect(publicMediaAllowed(state, bg, 'image')).toBe(true); expect(publicMediaAllowed(state, answer, 'image')).toBe(false);
    expect(publicMediaAllowed({ ...state, answerRevealed: true }, answer, 'image')).toBe(true);
    expect(publicMediaAllowed({ ...state, status: 'ended' }, bg, 'image')).toBe(false);
    expect(publicMediaAllowed({ ...state, backgroundImage: undefined }, bg, 'image')).toBe(false);
  });
});


describe('independent answer YouTube clips', () => {
  const clip = { videoId: 'answer12345', startSeconds: 6, endSeconds: 12 };
  const question = { ...stored, kind: 'free', media: [], answerYoutubeClip: clip };
  test('supported links normalize on the server to ID and optional times only', () => {
    for (const url of ['https://youtube.com/watch?v=answer12345', 'https://youtu.be/answer12345?t=4', 'https://www.youtube.com/shorts/answer12345']) {
      expect(answerYoutubeVideoId(url)).toBe(clip.videoId);
      const input = validateSlideInput({ ...mapEditorSlide('q', question), answerYoutubeClip: { url, startSeconds: 6, endSeconds: 12 } });
      const saved = applyKnownSlideUpdate(question, input);
      expect(saved.answerYoutubeClip).toEqual(clip);
      expect(JSON.stringify(saved.answerYoutubeClip)).not.toContain('https');
    }
    expect(parseAnswerYoutubeClip({ videoId: clip.videoId })).toEqual({ videoId: clip.videoId });
  });
  test('untrusted links, ancillary keys and invalid timing fail shared and server validation', () => {
    for (const url of ['https://youtube.com.evil.test/watch?v=answer12345', 'https://user:secret@youtube.com/watch?v=answer12345', 'javascript:alert(1)', 'https://youtu.be/answer12345/extra']) {
      expect(answerYoutubeVideoId(url)).toBeUndefined();
      expect(() => validateSlideInput({ ...mapEditorSlide('q', question), answerYoutubeClip: { url } })).toThrow();
    }
    for (const invalid of [{ videoId: 'bad' }, { ...clip, endSeconds: 6 }, { ...clip, startSeconds: -1 }, { ...clip, endSeconds: Infinity }, { ...clip, raw: 'secret' }]) {
      expect(parseAnswerYoutubeClip(invalid)).toBeUndefined();
      expect(() => validateSlideInput({ ...mapEditorSlide('q', question), answerYoutubeClip: invalid })).toThrow();
      expect(validateQuestion({ ...mapEditorSlide('q', question), answerYoutubeClip: invalid })).toContainEqual(expect.objectContaining({ code: 'ANSWER_YOUTUBE_INVALID' }));
    }
  });
  test('changing and removing a clip preserve the separate prompt and old questions stay absent', () => {
    const withPrompt = { ...question, kind: 'video', mediaSource: 'prompt12345', clipStartSeconds: 1, clipEndSeconds: 3 };
    const changed = applyKnownSlideUpdate(withPrompt, validateSlideInput({ ...mapEditorSlide('q', withPrompt), answerYoutubeClip: { videoId: 'changed1234' } }));
    expect(changed.answerYoutubeClip).toEqual({ videoId: 'changed1234' });
    expect(changed.mediaSource).toBe('prompt12345');
    const removed = applyKnownSlideUpdate(changed, validateSlideInput({ ...mapEditorSlide('q', changed), answerYoutubeClip: null }));
    expect(removed).not.toHaveProperty('answerYoutubeClip');
    expect(mapEditorSlide('q', removed)).not.toHaveProperty('answerYoutubeClip');
    expect(applyKnownSlideUpdate(stored, validateSlideInput(mapEditorSlide('q', stored)))).not.toHaveProperty('answerYoutubeClip');
    expect(() => applyKnownSlideUpdate({ ...question, kind: 'info', isQuestion: false }, validateSlideInput({ ...mapEditorSlide('q', question), kind: 'info' }))).toThrow();
  });
  test('preflight warns that the answer clip needs internet', () => {
    const q = mapEditorSlide('q', { ...question, roundId: 'r' });
    const round = mapEditorSlide('r', { kind: 'round', position: 2, title: 'Kolo', roundId: 'r' });
    const quiz = mapEditorQuiz('quiz', { title: 'Kvíz', description: '', slideCount: 2, questionCount: 1, roundCount: 1 }, [q, round]);
    expect(runQuizPreflight(quiz).issues).toContainEqual(expect.objectContaining({
      code: 'ANSWER_YOUTUBE_ONLINE_ONLY', message: 'Ukázka odpovědi z YouTube potřebuje internet – offline se nepřehraje.',
    }));
  });
});


test('answer and prompt clips cannot share a video ID through YouTube URL aliases', () => {
  const clip = { videoId: 'answer12345' };
  for (const mediaSource of ['answer12345', 'https://youtube.com/watch?v=answer12345', 'https://youtu.be/answer12345', 'https://youtube.com/shorts/answer12345']) {
    const source = { ...stored, kind: 'video', mediaSource, clipStartSeconds: 0, clipEndSeconds: 5, answerYoutubeClip: clip };
    const mapped = mapEditorSlide('q', source);
    expect(validateQuestion(mapped)).toContainEqual(expect.objectContaining({ code: 'ANSWER_YOUTUBE_INVALID' }));
    expect(() => applyKnownSlideUpdate(source, validateSlideInput(mapped))).toThrow(/jiné YouTube video/);
  }
});
