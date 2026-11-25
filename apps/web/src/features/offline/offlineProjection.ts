import { normalizeSlideDesign, resolveSlideDesign, offlineResultsPageSize, type OfflineEventManifest, type OfflineState } from '@filmovy-kviz/quiz-domain';
import type { PublicLiveState } from '../live/types';
import { validOfflineRecap } from './offlineRecap';
/** Creates a fresh public allowlist. The private slide, answer design and journal never cross the window boundary. */
export function buildOfflineProjection(manifest: OfflineEventManifest, state: OfflineState): PublicLiveState {
    const recapAllowed = !state.recap || validOfflineRecap(manifest, state.slidePosition, state.revealPosition);
    const position = recapAllowed ? state.revealPosition ?? state.slidePosition : state.slidePosition;
    const slide = manifest.slides.find(slide => slide.position === position);
    const revealed = recapAllowed && state.revealPosition !== null && Boolean(slide) && slide!.position === state.revealPosition;
    const base: PublicLiveState = { sessionId: manifest.sessionId, quizTitle: manifest.event.title, status: state.status, slidePosition: state.slidePosition,
        options: [], media: [], presentation: {}, presentationMode: 'slide', renderMode: 'question', mediaCommand: state.mediaCommand,
        mediaPlaybackState: ['play', 'replay'].includes(state.mediaCommand) ? 'preparing' : state.mediaCommand === 'finished' ? 'finished' : state.mediaCommand === 'error' ? 'error' : 'idle', mediaGeneration: state.mediaGeneration, introGeneration: 0, answerRevealed: revealed, revision: state.sequence };
    if (state.status !== 'active' || !slide || !recapAllowed) {
        return { ...base, answerRevealed: false, mediaCommand: 'idle', mediaPlaybackState: 'idle' };
    }
    const privateReferences = new Set(manifest.slides.flatMap(item => [item.answerImage, item.answerDesign?.backgroundImage, item.answerDesign?.logoImage,
        ...item.media.filter(media => media.role === 'answer' || media.role === 'unknown').map(media => media.source)]).filter((value): value is string => typeof value === 'string'));
    if (state.results) {
        const result = state.results, pageCount = Math.ceil(result.rows.length / offlineResultsPageSize);
        const rows = result.rows.slice(result.page * offlineResultsPageSize, (result.page + 1) * offlineResultsPageSize).map(row => ({ rank: row.rank, teamName: row.teamName, halfPoints: row.halfPoints }));
        const pagination = { versionId: state.headHash, page: result.page, pageCount, rows, presentationStyle: 'show' as const, pageSize: 6 as const };
        const template = manifest.resultTemplates?.[result.final ? 'final' : 'interim'];
        const publicImage = (value: unknown) => typeof value === 'string' && !privateReferences.has(value)
            && manifest.assets.some(asset => asset.reference === value && asset.kind === 'image') ? value : '';
        const design = template?.design ? normalizeSlideDesign({ ...template.design,
            backgroundImage: publicImage(template.design.backgroundImage), logoImage: publicImage(template.design.logoImage) }) : undefined;
        return { ...base, answerRevealed: false, mediaCommand: 'idle',
            ...(typeof template?.title === 'string' ? { title: template.title } : {}),
            ...(typeof template?.subtitle === 'string' ? { subtitle: template.subtitle } : {}),
            ...(design ? { design } : {}),
            ...(result.final ? { finalReveal: { ...pagination, mode: 'table' as const, rank: null, groupSize: 0 } } : { interimResults: { ...pagination, roundNumber: manifest.rounds.findIndex(round => round.id === result.throughRoundId) + 1 } }) };
    }
    const owned = (value: unknown) => typeof value === 'string' && manifest.assets.some(asset => asset.reference === value) && (revealed || !privateReferences.has(value)) ? value : undefined;
    const appearance = resolveSlideDesign(undefined, undefined, slide.design, revealed ? slide.answerDesign : undefined, revealed);
    const design = normalizeSlideDesign({ ...appearance, ...(appearance.backgroundImage ? { backgroundImage: owned(appearance.backgroundImage) ?? '' } : {}), ...(appearance.logoImage ? { logoImage: owned(appearance.logoImage) ?? '' } : {}) });
    const kind = slide.kind.toLowerCase(), image = ['image', 'picture', 'photo'].includes(kind), audio = ['audio', 'music'].includes(kind), video = ['video', 'youtube'].includes(kind);
    const legacy = (role: 'prompt' | 'background' | 'answer', kind: 'image' | 'audio' | 'video') => slide.media.find(item => item.role === role && item.kind === kind && owned(item.source))?.source;
    const questionImage = image ? owned(slide.questionImage) || legacy('prompt', 'image') : undefined;
    const backgroundImage = owned(slide.backgroundImage) || legacy('background', 'image');
    const mediaSource = video || (audio && revealed && state.recap) ? owned(slide.mediaSource) || legacy('prompt', video ? 'video' : 'audio') : undefined;
    const answerImage = revealed ? owned(slide.answerImage) || legacy('answer', 'image') : undefined;
    const roundNumber = manifest.rounds.find(round => round.id === slide.roundId)?.position;
    const renderMode = revealed || kind === 'recap' ? 'recap' : kind === 'intro' || ['round', 'roundheader', 'round-header', 'section'].includes(kind) ? 'roundIntro' : kind === 'agenda' ? 'agenda' : kind === 'rules' ? 'rules' : kind === 'end' ? 'end' : 'question';
    return { ...base, presentationMode: state.recap || kind === 'recap' ? 'recap' : 'slide', ...(Number.isSafeInteger(roundNumber) && (roundNumber ?? 0) > 0 ? { roundNumber } : {}), slideKind: slide.kind, title: typeof slide.title === 'string' ? slide.title : '', text: typeof slide.text === 'string' ? slide.text : '',
        options: slide.options.filter(option => typeof option === 'string'), media: [], presentation: {}, renderMode, design,
        ...(typeof slide.roundTitle === 'string' ? { roundTitle: slide.roundTitle } : {}), ...(slide.questionNumber === undefined ? {} : { questionNumber: slide.questionNumber }), ...(slide.questionCount === undefined ? {} : { questionCount: slide.questionCount }),
        ...(questionImage ? { questionImage } : {}), ...(backgroundImage ? { backgroundImage } : {}), ...(mediaSource ? { mediaSource } : {}),
        ...(slide.imageLayout ? { imageLayout: slide.imageLayout } : {}), ...(slide.backgroundOverlay === null ? {} : { backgroundOverlay: slide.backgroundOverlay }),
        ...(slide.clipStartSeconds === null ? {} : { clipStartSeconds: slide.clipStartSeconds }), ...(slide.clipEndSeconds !== null ? { clipEndSeconds: slide.clipEndSeconds } : {}),
        ...(revealed ? { revealedAnswer: slide.correctAnswer, ...(answerImage ? { answerImage } : {}), ...(typeof slide.answerExplanation === 'string' ? { answerExplanation: slide.answerExplanation } : {}), ...(state.recap ? { recapQuestionPosition: position } : {}) } : {}),
    };
}
export function offlineProjectionReferences(state: PublicLiveState): readonly string[] {
    return [...new Set([state.questionImage, state.backgroundImage, state.design?.backgroundImage, state.design?.showLogo === false ? undefined : state.design?.logoImage, state.answerRevealed ? state.answerImage : undefined, state.mediaSource].filter((value): value is string => typeof value === 'string' && value.length > 0))];
}
