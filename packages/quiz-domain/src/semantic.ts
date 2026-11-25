import type {
  CreatableQuestionType,
  EditorQuiz,
  EditorSlide,
  SemanticQuestionType,
} from './types.js';

export const creatableQuestionTypes: readonly CreatableQuestionType[] = [
  'choice', 'free', 'image', 'audio', 'video',
];

export const questionTypeLabels: Record<SemanticQuestionType, string> = {
  choice: 'Výběr z možností',
  free: 'Volná odpověď',
  image: 'Obrázek',
  audio: 'Audio',
  video: 'Video',
  'legacy-pl': 'Legacy: Pravda / Lež',
  legacy: 'Starší typ otázky',
};

const roundKinds = new Set(['round', 'roundheader', 'round-header', 'section']);
const imageKinds = new Set(['image', 'picture', 'photo']);
const audioKinds = new Set(['audio', 'music']);
const videoKinds = new Set(['video', 'youtube']);

export function semanticQuestionType(slide: EditorSlide): SemanticQuestionType {
  const kind = slide.kind.toLowerCase();
  if (kind === 'pl') return 'legacy-pl';
  if (slide.kind === 'legacy') return 'legacy';
  if (imageKinds.has(kind)) return 'image';
  if (audioKinds.has(kind)) return 'audio';
  if (videoKinds.has(kind)) return 'video';
  if (kind === 'free') return 'free';
  return slide.options.length >= 2 ? 'choice' : 'free';
}

export function questionPrompt(slide: EditorSlide): string {
  return slide.text.trim() === '' ? slide.title : slide.text;
}

export function questionSummary(slide: EditorSlide): string {
  const prompt = questionPrompt(slide).trim().replaceAll(/\s+/gu, ' ');
  if (prompt === '') return 'Bez zadání';
  return prompt.length > 56 ? `${prompt.slice(0, 53)}…` : prompt;
}

export interface SemanticQuestion {
  readonly slide: EditorSlide;
  readonly number: number;
  readonly type: SemanticQuestionType;
}

export interface SemanticRound {
  readonly id: string;
  readonly position: number;
  readonly title: string;
  readonly slides: readonly EditorSlide[];
  readonly settingsSlide?: EditorSlide;
  readonly questions: readonly SemanticQuestion[];
  readonly recaps: readonly EditorSlide[];
  readonly otherSystemSlides: readonly EditorSlide[];
  readonly firstPosition: number;
  readonly lastPosition: number;
}

export interface SemanticSystemSection {
  readonly key: 'opening' | 'agenda' | 'rules';
  readonly label: string;
  readonly slide?: EditorSlide;
  readonly generated: boolean;
}

export interface SemanticQuizModel {
  readonly introduction: readonly SemanticSystemSection[];
  readonly rounds: readonly SemanticRound[];
  readonly thankYou?: EditorSlide;
  readonly closing: readonly EditorSlide[];
  readonly legacy: readonly EditorSlide[];
  readonly slideById: ReadonlyMap<string, EditorSlide>;
  readonly questionBySlideId: ReadonlyMap<string, SemanticQuestion>;
}

function roundTitle(slides: readonly EditorSlide[], position: number): string {
  const explicit = slides.find((slide) => (
    roundKinds.has(slide.storedKind.toLowerCase()) && slide.title.trim() !== ''
  ));
  const stored = slides.find((slide) => slide.roundTitle?.trim())?.roundTitle;
  if (explicit && !explicit.customRoundHeading) return explicit.title.trim();
  return stored?.trim() || explicit?.title.trim() || `${position}. kolo`;
}

/** A gap before a question or recap belongs to its round. Else use the preceding round, or the first upcoming one. */
export function questionRoundAtGap(roundIds: readonly (string | undefined)[], index: number, beforeQuestionOrRecap = false): string | undefined {
  if (beforeQuestionOrRecap && roundIds[index]) return roundIds[index];
  return roundIds.slice(0, index).reverse().find(id => id !== undefined)
    ?? roundIds.slice(index).find(id => id !== undefined);
}

export function buildSemanticQuizModel(quiz: EditorQuiz): SemanticQuizModel {
  const slideById = new Map(quiz.slides.map((slide) => [slide.id, slide]));
  const grouped = new Map<string, EditorSlide[]>();
  const roundlessQuestions: EditorSlide[] = [];
  for (const slide of quiz.slides) {
    if (slide.roundId !== undefined) {
      const group = grouped.get(slide.roundId) ?? [];
      group.push(slide);
      grouped.set(slide.roundId, group);
    } else if (slide.isQuestion) {
      roundlessQuestions.push(slide);
    }
  }
  if (roundlessQuestions.length > 0) grouped.set('roundless', roundlessQuestions);

  const questionBySlideId = new Map<string, SemanticQuestion>();
  const rounds = [...grouped.entries()]
    .sort((left, right) => left[1][0]!.position - right[1][0]!.position)
    .map(([id, sourceSlides], index): SemanticRound => {
      const slides = [...sourceSlides].sort((left, right) => left.position - right.position);
      const questionSlides = slides.filter((slide) => slide.isQuestion);
      const questions = questionSlides.map((slide, questionIndex): SemanticQuestion => {
        const question = { slide, number: questionIndex + 1, type: semanticQuestionType(slide) };
        questionBySlideId.set(slide.id, question);
        return question;
      });
      const recaps = slides.filter((slide) => slide.kind === 'recap');
      const settingsSlide = slides.find((slide) => roundKinds.has(slide.storedKind.toLowerCase()))
        ?? slides.find((slide) => slide.kind === 'intro' && !slide.isQuestion);
      const systemIds = new Set([settingsSlide?.id, ...recaps.map((slide) => slide.id)]);
      return {
        id,
        position: index + 1,
        title: roundTitle(slides, index + 1),
        slides,
        ...(settingsSlide === undefined ? {} : { settingsSlide }),
        questions,
        recaps,
        otherSystemSlides: slides.filter((slide) => !slide.isQuestion && !systemIds.has(slide.id)),
        firstPosition: slides[0]!.position,
        lastPosition: slides.at(-1)!.position,
      };
    });

  const outsideRounds = quiz.slides.filter((slide) => slide.roundId === undefined && !slide.isQuestion);
  const first = (kind: string) => outsideRounds.find((slide) => slide.kind === kind);
  const thankYou = first('thank-you');
  const used = new Set([first('intro')?.id, first('agenda')?.id, first('rules')?.id, thankYou?.id]);
  const closing = outsideRounds.filter((slide) => slide.kind === 'end');
  closing.forEach((slide) => used.add(slide.id));
  return {
    introduction: [
      { key: 'opening', label: 'Úvodní obrazovka', slide: first('intro'), generated: first('intro') === undefined },
      { key: 'agenda', label: 'Harmonogram', slide: first('agenda'), generated: true },
      { key: 'rules', label: 'Pravidla', slide: first('rules'), generated: first('rules') === undefined },
    ],
    rounds,
    ...(thankYou ? { thankYou } : {}),
    closing,
    legacy: outsideRounds.filter((slide) => !used.has(slide.id)),
    slideById,
    questionBySlideId,
  };
}

export function storageKindForQuestion(type: CreatableQuestionType): EditorSlide['kind'] {
  return type === 'choice' ? 'question' : type;
}

export function insertionPositionForRound(round: SemanticRound): number {
  return round.recaps[0]?.position ?? round.lastPosition + 1;
}
