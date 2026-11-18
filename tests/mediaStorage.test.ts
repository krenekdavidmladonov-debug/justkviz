import { loadUpcomingImages } from '../functions/src/live/upcoming-images';
import { upcomingPromptImages } from '../functions/src/live/publication';
import { describe, expect, test, vi } from 'vitest';
import { parseQuizAsset, quizAssetReference, validOwnedMedia } from '../packages/quiz-domain/src/media-assets';
import { assertQuizAssets, mediaByteRange, mediaSignature, publicMediaAllowed } from '../functions/src/media/model';
import { mediaBucketName } from '../functions/src/media/environment';
const reference = quizAssetReference('quiz-1', 'a'.repeat(64));
describe('owned media contract', () => {
  test('reserved reference cannot become a URL, path traversal or foreign field', () => {
    expect(parseQuizAsset(reference)).toEqual({quizId:'quiz-1',assetId:'a'.repeat(64)});
    for(const source of ['https://example.test/a.png','abcdefghijk','quiz-asset:../'+'a'.repeat(64),reference+'?x=1',reference+'/more',reference.toUpperCase()]) expect(parseQuizAsset(source)).toBeUndefined();
  });
  test('exact supported MIME and positive bounded integer sizes', () => {
    expect(validOwnedMedia('image','image/png',10485760)).toBe(true);
    expect(validOwnedMedia('audio','audio/wav',26214400)).toBe(true);
    for(const [kind,mime,size] of [['image','image/png',10485761],['audio','audio/mpeg',26214401],['image','image/svg+xml',5],['audio','video/mp4',5],['image','image/png',0],['image','image/png',1.5],['image','image/png','15']]) expect(validOwnedMedia(kind,mime,size)).toBe(false);
  });
  test('declared MIME needs matching byte signature', () => {
    const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);
    const wave=Buffer.alloc(44);wave.write('RIFF');wave.write('WAVE',8);
    expect(mediaSignature(png,'image/png')).toBe(true);expect(mediaSignature(wave,'audio/wav')).toBe(true);
    expect(mediaSignature(Buffer.from([255,216,255,224]),'image/jpeg')).toBe(true);
    expect(mediaSignature(Buffer.from('ID3synthetic'),'audio/mpeg')).toBe(true);
    for(const mime of ['image/png','image/jpeg','image/webp','audio/wav','audio/mpeg']) expect(mediaSignature(Buffer.from('<html>bad</html>'),mime)).toBe(false);
    expect(mediaSignature(wave,'image/png')).toBe(false);
  });
  test('bounded single byte range, suffix and open end', () => {
    expect(mediaByteRange(undefined,100)).toBeUndefined();
    expect(mediaByteRange('bytes=4-20',100)).toEqual({start:4,end:20});
    expect(mediaByteRange('bytes=90-',100)).toEqual({start:90,end:99});
    expect(mediaByteRange('bytes=-10',100)).toEqual({start:90,end:99});
    expect(mediaByteRange('bytes=0-1000',100)).toEqual({start:0,end:99});
    for(const value of ['bytes=-0','bytes=100-','bytes=20-10','bytes=0-1,3-4','bytes=-','bytes=99999999999999999-','none']) expect(()=>mediaByteRange(value,100)).toThrow();
  });
  test('publication authorizes only active exact image or recap audio, not unshown media', () => {
    const image={status:'active',slideKind:'image',questionImage:reference};
    expect(publicMediaAllowed(image,reference,'image')).toBe(true);
    expect(publicMediaAllowed(image,reference,'audio')).toBe(false);
    for(const extra of [{status:'ended'},{status:'waiting'},{status:undefined},{interimResults:{}},{finalReveal:{}},{questionImage:reference+'x'}]) expect(publicMediaAllowed({...image,...extra},reference)).toBe(false);
    const audio={status:'active',slideKind:'audio',mediaSource:reference};
    expect(publicMediaAllowed(audio,reference,'audio')).toBe(false);
    expect(publicMediaAllowed({...audio,renderMode:'recap'},reference,'audio')).toBe(true);
    expect(publicMediaAllowed({...audio,renderMode:'recap'},reference,'image')).toBe(false);
    expect(publicMediaAllowed({status:'active',answerImage:reference},reference)).toBe(false);
  });
  test('binding rejects cross-quiz, unresolved, wrong kind and conflicting roles across slides', async () => {
    let data: Record<string,unknown> = {quizId:'quiz-1',status:'ready',generation:'123',kind:'image',contentType:'image/png',size:20};
    const tx={get:()=>Promise.resolve({data:()=>data})} as unknown as Parameters<typeof assertQuizAssets>[0], db={doc:(path:string)=>path} as unknown as Parameters<typeof assertQuizAssets>[1];
    const bind=(slides:Record<string,unknown>[])=>assertQuizAssets(tx,db,'quiz-1',slides);
    await expect(bind([{kind:'image',questionImage:reference,answerImage:reference,backgroundImage:reference}])).resolves.toBeUndefined();
    await expect(bind([{kind:'image',questionImage:reference},{kind:'audio',mediaSource:reference}])).rejects.toMatchObject({code:'invalid-argument'});
    for(const slide of [{kind:'audio',questionImage:reference,mediaSource:reference},{kind:'image',questionImage:reference.replace('quiz-1','quiz-2')}]) await expect(bind([slide])).rejects.toMatchObject({code:'invalid-argument'});
    data={...data,status:'uploading'};await expect(bind([{kind:'image',questionImage:reference}])).rejects.toMatchObject({code:'failed-precondition'});
    data={...data,status:'ready',kind:'audio'};await expect(bind([{kind:'image',questionImage:reference}])).rejects.toMatchObject({code:'failed-precondition'});
    await expect(bind([{kind:'image',questionImage:'https://example.test/legacy.png'},{kind:'audio',mediaSource:'abcdefghijk'}])).resolves.toBeUndefined();
  });
  test('all emulator signals fail closed without demo project and local Storage; cloud requires explicit bucket', () => {
    expect(mediaBucketName('demo-media',undefined,{FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9199'})).toBe('demo-media.appspot.com');
    for(const signal of [{FUNCTIONS_EMULATOR:'true'},{FIRESTORE_EMULATOR_HOST:'localhost:8080'},{FIREBASE_AUTH_EMULATOR_HOST:'localhost:9099'},{FIREBASE_STORAGE_EMULATOR_HOST:'localhost:9199'}]) expect(()=>mediaBucketName('cloud-project','cloud-bucket',signal)).toThrow();
    for(const host of [undefined,'example.test:9199','localhost:65536','localhost:0','http://localhost:9199']) expect(()=>mediaBucketName('demo-media','cloud-bucket',{FIREBASE_STORAGE_EMULATOR_HOST:host})).toThrow();
    expect(()=>mediaBucketName('cloud-project',undefined,{})).toThrow();
    expect(mediaBucketName('cloud-project','explicit-bucket',{})).toBe('explicit-bucket');
  });
});


test('public lookahead selects only the next three visible prompt slides and excludes globally shared answer images', () => {
  const image = (letter: string) => 'quiz-asset:quiz-1/' + letter.repeat(64);
  const slides = [
    { id: 'current', data: { position: 1, kind: 'image', questionImage: image('a') } },
    { id: 'next', data: { position: 2, kind: 'image', questionImage: image('b'), answerImage: image('f'), correctAnswer: 'secret' } },
    { id: 'hidden', data: { position: 3, kind: 'info', hidden: true, backgroundImage: image('c') } },
    { id: 'third', data: { position: 4, kind: 'image', questionImage: image('c') } },
    { id: 'fourth', data: { position: 5, kind: 'image', questionImage: image('d') } },
    { id: 'outside', data: { position: 6, kind: 'image', questionImage: image('e'), answerDesign: { backgroundImage: image('b') } } },
  ];
  expect(upcomingPromptImages('quiz-1', {}, slides, 1)).toEqual([image('c'), image('d')]);
  const publication = { status: 'active', presentationMode: 'slide', upcomingImages: [image('c'), image('d')] };
  expect(publicMediaAllowed(publication, image('c'), 'image')).toBe(true);
  for (const reference of [image('b'), image('e'), image('f')]) expect(publicMediaAllowed(publication, reference, 'image')).toBe(false);
  expect(publicMediaAllowed(publication, image('c'), 'audio')).toBe(false);
  expect(publicMediaAllowed({ ...publication, status: 'ended' }, image('c'), 'image')).toBe(false);
});


test('legacy answer-role and explicit answer designs exclude shared prompt references across the whole source', () => {
  const image = (letter: string) => 'quiz-asset:quiz-1/' + letter.repeat(64);
  const sources = [
    { id: 'current', data: { position: 1, kind: 'question' } },
    { id: 'next', data: { position: 2, kind: 'image', media: [{ role: 'prompt', kind: 'image', value: image('a') }], design: { backgroundImage: image('b'), logoImage: image('c') } } },
    { id: 'answer', data: { position: 10, kind: 'image', media: [{ role: 'answer', kind: 'image', value: image('a') }, { role: 'answer', kind: 'image', source: image('b') }], answerDesign: { logoImage: image('c') } } },
  ];
  expect(upcomingPromptImages('quiz-1', {}, sources, 1)).toEqual([]);
});

test('immutable snapshot lookahead reuses only a bounded derived plan, expires it, and never caches mutable quizzes', async () => {
  vi.useFakeTimers();
  try {
    let reads = 0;
    const image = 'quiz-asset:quiz-plan-cache/' + 'a'.repeat(64);
    const slides = Array.from({ length: 400 }, (_, index) => ({ id: String(index), data: () => ({ position: index + 1, kind: 'image', questionImage: image }) }));
    const query = { limit: () => query, slides: true };
    const root = { collection: () => query };
    const db = { collection: () => ({ doc: () => root }) } as unknown as Parameters<typeof loadUpcomingImages>[0];
    const tx = { get: (ref: unknown) => { reads++; return Promise.resolve(ref === root
      ? { data: () => ({ quizId: 'quiz-plan-cache', status: 'ready' }) } : { docs: slides }); } } as unknown as Parameters<typeof loadUpcomingImages>[1];
    const session = { status: 'active', presentationMode: 'slide', quizId: 'quiz-plan-cache', snapshotId: 'immutable-plan', currentSlidePosition: 1 } as Parameters<typeof loadUpcomingImages>[2];
    expect(await loadUpcomingImages(db, tx, session)).toEqual([image]); expect(reads).toBe(2);
    await loadUpcomingImages(db, tx, { ...session, currentSlidePosition: 2 }); expect(reads).toBe(2);
    for (const state of [{ status: 'ended' }, { status: 'waiting' }, { answerRevealed: true }, { interimResults: {} }, { finalReveal: { visible: true } }, { presentationMode: 'recap' }]) {
      expect(await loadUpcomingImages(db, tx, { ...session, ...state } as typeof session)).toEqual([]);
    }
    expect(reads).toBe(2);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await loadUpcomingImages(db, tx, session); expect(reads).toBe(4);
    await loadUpcomingImages(db, tx, { ...session, snapshotId: undefined });
    await loadUpcomingImages(db, tx, { ...session, snapshotId: undefined }); expect(reads).toBe(8);
    for (let index = 0; index < 9; index++) await loadUpcomingImages(db, tx, { ...session, snapshotId: 'bounded-' + index });
    const before = reads; await loadUpcomingImages(db, tx, session); expect(reads).toBe(before + 2);
  } finally { vi.useRealTimers(); }
});
