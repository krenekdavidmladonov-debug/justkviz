import { ColorTypes, PDFDocument, PDFPage, PDFName, PDFRawStream } from 'pdf-lib';
import { PNG } from 'pngjs';
import { describe, expect, test, vi } from 'vitest';

import { renderPrintArtifact } from '../functions/src/print/renderer';
import { answerDisplay, mapSnapshotToPrintEvent } from '../functions/src/print/snapshot-mapper';
import { syntheticPrintEvent, longSyntheticPrintEvent, syntheticSnapshotDocuments, syntheticTeams } from './printCenter.fixture';
import { printLogoAsset } from '../functions/src/print/logo';
import type { PrintOptions } from '../functions/src/print/types';
import { assertCurrentPrintSource } from '../functions/src/print/source-guard';
import { brandArtwork } from '../packages/quiz-domain/src/brand-artwork';

describe('PDF Print Center renderer', () => {
  test('uses the shared vector logo in paper headers and respects hidden logos', async () => {
    const paths = vi.spyOn(PDFPage.prototype, 'drawSvgPath');
    try {
      for (const artifactType of ['team-sheets', 'score-table'] as const) {
        paths.mockClear();
        await renderPrintArtifact(syntheticPrintEvent(), { artifactType, disposition: 'inline', mode: 'generic', teams: syntheticTeams(2) });
        expect(paths.mock.calls.some(([path]) => path === brandArtwork.paths[0].d)).toBe(true);
        paths.mockClear();
        await renderPrintArtifact(syntheticPrintEvent(), { artifactType, disposition: 'inline', mode: 'generic', teams: syntheticTeams(2), showLogo: false });
        expect(paths).not.toHaveBeenCalled();
      }
      paths.mockClear();
      await renderPrintArtifact(syntheticPrintEvent(), { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [], colorMode: 'grayscale' });
      expect(paths.mock.calls.length).toBeGreaterThan(0);
      expect(paths.mock.calls.every(([, options]) => {
        const color = options?.color;
        return color?.type === ColorTypes.RGB && color.red === color.green && color.green === color.blue;
      })).toBe(true);
    } finally { paths.mockRestore(); }
  });
  test('renders deterministic A4 team sheets for 20 synthetic teams', async () => {
    const event = syntheticPrintEvent();
    const options = { artifactType: 'team-sheets', disposition: 'inline', mode: 'all', teams: syntheticTeams() } as const;
    const first = await renderPrintArtifact(event, options);
    const second = await renderPrintArtifact(event, options);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
    expect(first.filename).toBe('odpovedni-archy.pdf');
    expect(first.pageCount).toBe(51); // 100 team/round panels and one universal reserve.
    const pdf = await PDFDocument.load(first.bytes);
    expect(pdf.getPageCount()).toBe(first.pageCount);
    expect(pdf.getTitle()).toBe('JustKvíz — tiskové centrum');
    expect(pdf.getAuthor()).toBe('JustKvíz');
    expect(pdf.getCreator()).toBe('JustKvíz');
    expect(pdf.getPages()[0]?.getWidth()).toBeCloseTo(841.89, 1);
    expect(pdf.getPages()[0]?.getHeight()).toBeCloseTo(595.28, 1);
    expect(first.bytes.byteLength).toBeLessThan(10 * 1024 * 1024);
  }, 20_000);

  test('renders a private answer key with canonical Choice labels', async () => {
    expect(answerDisplay({ answer: 'Správná možnost', choiceLabel: 'B' })).toBe('B — Správná možnost');
    expect(answerDisplay({ answer: 'Pravda' })).toBe('Pravda');
    const result = await renderPrintArtifact(syntheticPrintEvent(), { artifactType: 'answer-key', disposition: 'inline' });
    expect(result.filename).toBe('klic-spravnych-odpovedi.pdf');
    expect(result.pageCount).toBeGreaterThan(0);
    await expect(PDFDocument.load(result.bytes)).resolves.toBeDefined();
  });

  test('draws exact empty vector choices independently of audio, video and image media', async () => {
    const event = syntheticPrintEvent();
    event.quiz.rounds = [{
      number: 1, title: 'Různé způsoby odpovědi', questions: [
        ...([2, 3, 4, 5, 6] as const).map((choiceCount, index) => ({
          number: index + 1, kind: (['audio', 'video', 'image', 'choice', 'audio'] as const)[index]!,
          answerMode: 'choice' as const, choiceCount, answer: 'NEZVEŘEJNĚNÁ ODPOVĚĎ', choiceLabel: 'B',
        })),
        { number: 6, kind: 'pl', answerMode: 'true-false', answer: 'Pravda' },
        { number: 7, kind: 'video', answerMode: 'open', answer: 'TAJNÝ TEXT' },
      ],
    }];
    const circles = vi.spyOn(PDFPage.prototype, 'drawCircle');
    const text = vi.spyOn(PDFPage.prototype, 'drawText');
    try {
      await renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] });
      expect(circles).toHaveBeenCalledTimes(2 * (2 + 3 + 4 + 5 + 6 + 2));
      expect(circles.mock.calls.every(([options]) => options?.color === undefined && options?.size === 5 && options.borderWidth === .8)).toBe(true);
      const drawn = text.mock.calls.map(([value]) => value);
      for (const [letter, count] of [['A', 5], ['B', 5], ['C', 4], ['D', 3], ['E', 2], ['F', 1]] as const) {
        expect(drawn.filter(value => value === letter)).toHaveLength(count * 2);
      }
      expect(drawn).not.toContain('NEZVEŘEJNĚNÁ ODPOVĚĎ');
      expect(drawn).not.toContain('TAJNÝ TEXT');
    } finally {
      circles.mockRestore();
      text.mockRestore();
    }
  });

  test('keeps every answer block and wrapped text inside A4 for six rounds and 67 questions', async () => {
    const event = longSyntheticPrintEvent();
    expect(event.quiz.rounds.flatMap(round => round.questions)).toHaveLength(67);
    const text = vi.spyOn(PDFPage.prototype, 'drawText');
    const line = vi.spyOn(PDFPage.prototype, 'drawLine');
    const rectangle = vi.spyOn(PDFPage.prototype, 'drawRectangle');
    try {
      const pageCounts: number[] = [];
      for (const layout of ['spacious', 'compact'] as const) {
        for (const colorMode of ['color', 'grayscale'] as const) {
          text.mockClear();
          line.mockClear();
          rectangle.mockClear();
          const result = await renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'single', teams: [syntheticTeams()[19]!], layout, colorMode });
          pageCounts.push(result.pageCount);
          const pages = (await PDFDocument.load(result.bytes)).getPages();
          expect(pages.every(page => page.getWidth() === 841.89 && page.getHeight() === 595.28)).toBe(true);
          // Every piece of text stays inside its own cut panel, including footers.
          text.mock.calls.forEach(([value, options]) => {
            const panelOffset = options!.x! < 420.945 ? 0 : 420.945;
            expect(options!.x! - panelOffset).toBeGreaterThanOrEqual(24);
            expect(options?.y).toBeGreaterThanOrEqual(24);
            expect(options!.y! + options!.size!).toBeLessThanOrEqual(595.28 - 16);
            expect(options!.size).toBeGreaterThanOrEqual(8);
            expect(options!.x! + options!.font!.widthOfTextAtSize(value, options!.size!)).toBeLessThanOrEqual(panelOffset + 396.955);
          });
          const questionCalls = text.mock.calls.map((call, index) => ({ call, page: text.mock.contexts[index] }))
            .filter(({ call: [value] }) => /^\d{2}$/u.test(value));
          expect(questionCalls).toHaveLength(134);
          expect(new Set(questionCalls.map(({ page }) => page)).size).toBe(result.pageCount);
          text.mock.calls.forEach(([value, position], index) => {
            if (!value.startsWith('KOLO ')) return;
            const page = text.mock.contexts[index];
            const followingQuestion = text.mock.calls.findIndex(([candidate, options], next) => next > index && text.mock.contexts[next] === page && Math.floor(options!.x! / 420.945) === Math.floor(position!.x! / 420.945) && /^\d{2}$/u.test(candidate));
            expect(followingQuestion).toBeGreaterThan(index);
            const nextHeading = text.mock.calls.findIndex(([candidate, options], next) => next > index && text.mock.contexts[next] === page && Math.floor(options!.x! / 420.945) === Math.floor(position!.x! / 420.945) && candidate.startsWith('KOLO '));
            const questions = text.mock.calls.filter(([candidate, options], next) => next > index && (nextHeading < 0 || next < nextHeading) && text.mock.contexts[next] === page && Math.floor(options!.x! / 420.945) === Math.floor(position!.x! / 420.945) && /^\d{2}$/u.test(candidate));
            expect(questions).toHaveLength(event.quiz.rounds[Number(value.slice(5)) - 1]!.questions.length);
          });
          if (colorMode === 'grayscale') {
            text.mock.calls.forEach(([, options]) => {
              const color = options?.color;
              if (color?.type === ColorTypes.RGB) expect(color.red === color.green && color.green === color.blue).toBe(true);
            });
            line.mock.calls.forEach(([options]) => {
              const color = options?.color;
              if (color?.type === ColorTypes.RGB) expect(color.red === color.green && color.green === color.blue).toBe(true);
            });
            rectangle.mock.calls.forEach(([options]) => {
              for (const color of [options?.color, options?.borderColor]) {
                if (color?.type === ColorTypes.RGB) expect(color.red === color.green && color.green === color.blue).toBe(true);
              }
            });
          }
        }
      }
      expect(pageCounts[2]).toBeLessThanOrEqual(pageCounts[0]!);
      expect(pageCounts[0]).toBe(pageCounts[1]);
      expect(pageCounts[2]).toBe(pageCounts[3]);
      expect(pageCounts[0]).toBeGreaterThanOrEqual(6);
      expect(pageCounts[2]).toBeGreaterThan(1);
    } finally {
      text.mockRestore();
      line.mockRestore();
      rectangle.mockRestore();
    }
  });

  test('keeps comfortable rounds separate and packs whole short rounds in compact mode', async () => {
    const event = syntheticPrintEvent();
    event.quiz.rounds.forEach(round => { round.questions = round.questions.slice(0, 4); });
    const options: PrintOptions = { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] };
    const comfortable = await renderPrintArtifact(event, options);
    expect(comfortable.pageCount).toBe(5);
    event.quiz.printTemplate = { layout: 'compact', title: 'Kvízový večer', instructions: 'Pište čitelně.', footer: 'Děkujeme všem týmům.', accentColor: '#b89242', showLogo: false };
    const compact = await renderPrintArtifact(event, options);
    expect(compact.pageCount).toBeLessThan(comfortable.pageCount);
  });

  test('never draws answers or choice labels on player sheets, even when secret values change', async () => {
    const event = syntheticPrintEvent();
    const options: PrintOptions = { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] };
    const first = await renderPrintArtifact(event, options);
    event.quiz.rounds.forEach(round => round.questions.forEach(question => { question.answer = 'UNREVEALED-SECRET-CHANGED'; question.choiceLabel = 'Z'; }));
    const second = await renderPrintArtifact(event, options);
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true);
  });

  test('never even reads private answer fields in the player renderer', async () => {
    const event = syntheticPrintEvent();
    for (const question of event.quiz.rounds.flatMap(round => round.questions)) {
      Object.defineProperty(question, 'answer', { get() { throw new Error('Player renderer read a private answer'); } });
      Object.defineProperty(question, 'choiceLabel', { get() { throw new Error('Player renderer read a private choice label'); } });
    }
    await expect(renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] })).resolves.toMatchObject({ filename: 'odpovedni-archy.pdf' });
  });

  test.each(['generic', 'single'] as const)('prints two identical complete copies of each logical page in %s mode', async mode => {
    const event = syntheticPrintEvent();
    const text = vi.spyOn(PDFPage.prototype, 'drawText');
    const line = vi.spyOn(PDFPage.prototype, 'drawLine');
    try {
      const result = await renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode, teams: mode === 'single' ? [{ id: 'one', name: 'Vybraný tým' }] : [] });
      const drawnPages = [...new Set(text.mock.contexts)];
      expect(drawnPages).toHaveLength(result.pageCount);
      for (const page of drawnPages) {
        const calls = text.mock.calls.filter((_, index) => text.mock.contexts[index] === page);
        const panelCalls = (side: number) => calls.filter(([, options]) => Math.floor(options!.x! / 420.945) === side)
          .map(([value, options]) => ({ value, x: options!.x! - side * 420.945, y: options!.y, size: options!.size }));
        const left = panelCalls(0);
        const right = panelCalls(1);
        expect(left).toHaveLength(right.length);
        left.forEach(({ x, ...item }, index) => {
          const { x: rightX, ...rightItem } = right[index]!;
          expect(item).toEqual(rightItem);
          expect(x).toBeCloseTo(rightX, 5);
        });
        expect(calls.filter(([value]) => value.startsWith('Strana '))).toHaveLength(2);
        expect(calls.filter(([value]) => value === 'U mo')).toHaveLength(2);
      }
      expect(line.mock.calls.filter(([options]) => options?.start.x === 420.945 && options.end.x === 420.945 && options.dashArray?.join(',') === '4,5')).toHaveLength(result.pageCount);
    } finally {
      text.mockRestore();
      line.mockRestore();
    }
  });

  test.each([1, 2, 3, 4])('prints exactly one universal reserve across multiple rounds for %i teams', async count => {
    const event = syntheticPrintEvent();
    event.title = 'Syntetický večer';
    event.quiz.rounds = [26, 7, 11].map((questions, index) => ({ number: index + 1, title: `Syntetické kolo ${index + 1}`, questions: Array.from({ length: questions }, (_, index) => ({ number: index + 1, kind: 'free', answerMode: 'open', answer: 'SECRET' })) }));
    const teams = Array.from({ length: count }, (_, index) => ({ id: 'team-' + index, name: 'Team ' + index }));
    const text = vi.spyOn(PDFPage.prototype, 'drawText');
    try {
      const result = await renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'all', teams });
      expect(result.pageCount).toBe(Math.ceil((count * 3 + 1) / 2));
      const pages = [...new Set(text.mock.contexts)];
      const panels = pages.flatMap(page => [0, 1].map(side => text.mock.calls.filter(([, options], index) => text.mock.contexts[index] === page && Math.floor(options!.x! / 420.945) === side).map(([value]) => value))).filter(panel => panel.length);
      expect(panels).toHaveLength(count * 3 + 1);
      // These glyphs all live in the base font, without fallback runs.
      expect(panels.filter(panel => panel.includes('REZERVNÍ ARCH'))).toHaveLength(1);
      for (const team of teams) {
        const teamPanels = panels.filter(panel => panel.includes(team.name));
        expect(teamPanels).toHaveLength(3);
        expect(teamPanels.map(panel => panel.filter(value => /^\d{2}$/u.test(value)).length)).toEqual([26, 7, 11]);
        expect(teamPanels.every(panel => !panel.includes('REZERVNÍ ARCH'))).toBe(true);
      }
      const reserve = panels.find(panel => panel.includes('REZERVNÍ ARCH'))!;
      expect(reserve.filter(value => /^\d{2}$/u.test(value))).toHaveLength(26);
      expect(reserve).toContain('KOLO');
      expect(reserve.some(value => value.startsWith('KOLO 0'))).toBe(false);
      expect(text.mock.calls.some(([value]) => value.includes('SECRET') || value.includes('pokra'))).toBe(false);
    } finally { text.mockRestore(); }
  });

  test('prints filled organizer panels with prominent warnings on every half and a separate A4 answer key', async () => {
    const event = syntheticPrintEvent();
    event.quiz.rounds = [{ number: 1, title: 'Kontrola odpovědí', questions: [
      { number: 1, kind: 'choice', answerMode: 'choice', choiceCount: 4, choiceLabel: 'C', answer: 'SECRET-CHOICE' },
      { number: 2, kind: 'free', answerMode: 'open', answer: 'SECRET-OPEN' },
      { number: 3, kind: 'pl', answerMode: 'true-false', answer: 'Pravda' },
    ] }];
    const text = vi.spyOn(PDFPage.prototype, 'drawText');
    const circle = vi.spyOn(PDFPage.prototype, 'drawCircle');
    try {
      for (const colorMode of ['color', 'grayscale'] as const) {
        text.mockClear();
        circle.mockClear();
        const result = await renderPrintArtifact(event, { artifactType: 'organizer-sheets', disposition: 'inline', colorMode });
        expect(result.filename).toBe('organizatorske-archy.pdf');
        const pages = (await PDFDocument.load(result.bytes)).getPages();
        expect(pages.every(page => page.getWidth() === 841.89 && page.getHeight() === 595.28)).toBe(true);
        expect(circle).not.toHaveBeenCalled();
        expect(text.mock.calls.some(([value]) => value === 'TÝM' || value === 'STŮL')).toBe(false);
        for (const page of new Set(text.mock.contexts)) {
          for (const side of [0, 1]) {
            const rows = new Map<number, string>();
            text.mock.calls.forEach(([value, options], index) => {
              if (text.mock.contexts[index] === page && Math.floor(options!.x! / 420.945) === side) rows.set(options!.y!, (rows.get(options!.y!) ?? '') + value);
            });
            expect([...rows.values()]).toEqual(expect.arrayContaining([
              'PRO ORGANIZÁTORA / SPRÁVNÉ ODPOVĚDI', 'NEDÁVAT HRÁČŮM',
              'C - SECRET-CHOICE', 'SECRET-OPEN', 'Pravda',
            ]));
          }
        }
      }
      const key = await renderPrintArtifact(event, { artifactType: 'answer-key', disposition: 'inline' });
      expect((await PDFDocument.load(key.bytes)).getPages().every(page => page.getWidth() === 595.28 && page.getHeight() === 841.89)).toBe(true);
    } finally {
      text.mockRestore();
      circle.mockRestore();
    }
  });

  test('transient print choices preserve the frozen template and never require hidden logo bytes', async () => {
    const event = syntheticPrintEvent();
    event.quiz.printTemplate = { layout: 'comfortable', showLogo: true, instructions: 'Pokyny připraveného kvízu', footer: 'W'.repeat(160) };
    const before = structuredClone(event.quiz.printTemplate);
    event.logo = { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' };
    const result = await renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [], layout: 'compact', showLogo: false, showInstructions: false });
    expect(result.pageCount).toBeGreaterThan(0);
    expect(event.quiz.printTemplate).toEqual(before);
    await expect(PDFDocument.load(result.bytes)).resolves.toBeDefined();
  });

  test('empty rosters require the explicit blank team-sheet mode', async () => {
    const event = syntheticPrintEvent();
    await expect(renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'all', teams: [] })).rejects.toMatchObject({ code: 'missing-teams' });
    await expect(renderPrintArtifact(event, { artifactType: 'score-table', disposition: 'inline', teams: [] })).rejects.toMatchObject({ code: 'missing-teams' });
    expect((await renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] })).pageCount).toBe(5);
  });

  test('embeds a verified raster logo, and hiding it avoids reading its bytes', async () => {
    const event = syntheticPrintEvent();
    const png = new PNG({ width: 40, height: 10 });
    png.data.fill(255);
    event.logo = { bytes: PNG.sync.write(png), contentType: 'image/png' };
    const options: PrintOptions = { artifactType: 'team-sheets', disposition: 'inline', mode: 'generic', teams: [] };
    const pdf = await PDFDocument.load((await renderPrintArtifact(event, options)).bytes);
    expect(pdf.context.enumerateIndirectObjects().some(([, value]) => value instanceof PDFRawStream && value.dict.get(PDFName.of('Subtype'))?.toString() === '/Image')).toBe(true);
    event.quiz.printTemplate = { showLogo: false };
    event.logo.bytes = new Uint8Array([1, 2, 3]);
    await expect(renderPrintArtifact(event, options)).resolves.toBeDefined();
    event.quiz.printTemplate = { showLogo: true };
    await expect(renderPrintArtifact(event, options)).rejects.toMatchObject({ code: 'invalid-logo' });
  });

  test('rejects impossible round/header density rather than splitting a round across pages', async () => {
    const event = syntheticPrintEvent();
    event.quiz.rounds = [{ number: 1, title: 'Velmi dlouhý název kola '.repeat(20), questions: Array.from({ length: 35 }, (_, index) => ({ number: index + 1, kind: 'free', answerMode: 'open', answer: 'tajné' })) }];
    event.quiz.printTemplate = { title: 'Dlouhý nadpis '.repeat(9), logoText: 'W'.repeat(80), instructions: 'Čitelně zapisujte odpovědi. '.repeat(15), footer: 'Děkujeme za příjemný večer. '.repeat(5) };
    await expect(renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'inline', mode: 'single', teams: [syntheticTeams(20)[19]!] })).rejects.toMatchObject({ code: 'layout-limit', status: 422 });
  });

  test('uses landscape and multiple pages for the score table when rounds grow', async () => {
    const event = syntheticPrintEvent();
    event.quiz.rounds.push(...event.quiz.rounds.map((round, index) => ({ ...round, number: index + 6, title: `Další kolo ${index + 6}` })));
    const result = await renderPrintArtifact(event, { artifactType: 'score-table', disposition: 'inline', teams: syntheticTeams(30) });
    const pdf = await PDFDocument.load(result.bytes);
    expect(result.filename).toBe('bodovaci-tabulka.pdf');
    expect(result.pageCount).toBeGreaterThan(1);
    expect(pdf.getPages().every((page) => page.getWidth() > page.getHeight())).toBe(true);
  });
});

describe('print logo immutable ownership boundary', () => {
  const reference = 'quiz-asset:quiz-1/' + 'a'.repeat(64);
  const asset = { quizId: 'quiz-1', status: 'ready', kind: 'image', contentType: 'image/png', size: 123, generation: '42' };
  test('accepts only verified PNG/JPEG at a concrete generation', () => {
    expect(printLogoAsset(reference, 'quiz-1', asset)).toMatchObject({ quizId: 'quiz-1', generation: '42', contentType: 'image/png' });
  });
  test.each([
    ['https://example.test/logo.png', 'quiz-1', asset],
    [reference, 'other-quiz', asset],
    [reference, 'quiz-1', { ...asset, status: 'pending' }],
    [reference, 'quiz-1', { ...asset, generation: undefined }],
    [reference, 'quiz-1', { ...asset, kind: 'audio' }],
    [reference, 'quiz-1', { ...asset, contentType: 'image/webp' }],
  ])('rejects external, unrelated, unready or unsupported logo %s', (value, quizId, metadata) => {
    expect(() => printLogoAsset(value, quizId, metadata)).toThrow();
  });
});

describe('print generation source consistency', () => {
  const assignment = { snapshotId: 'snapshot-1', quizId: 'quiz-1', quizRevision: 2 };
  const snapshot = { status: 'ready', quizId: 'quiz-1', quizRevision: 2, eventId: 'event-1' };
  test('allows the unchanged frozen source', () => expect(() => assertCurrentPrintSource(assignment, { ...assignment }, snapshot, 'event-1')).not.toThrow());
  test.each([
    [{ ...assignment, snapshotId: 'snapshot-2' }, snapshot],
    [{ ...assignment, quizId: 'other' }, snapshot],
    [{ ...assignment, quizRevision: 3 }, snapshot],
    [undefined, snapshot],
    [assignment, undefined],
    [assignment, { ...snapshot, status: 'building' }],
    [assignment, { ...snapshot, eventId: 'other-event' }],
  ])('rejects relock, detachment or deletion before bytes leave the server', (current, frozen) => expect(() => assertCurrentPrintSource(assignment, current, frozen, 'event-1')).toThrow());
});

describe('trusted snapshot mapper', () => {
  test('maps only print fields and drops prompts, media, notes, legacy data, and internal IDs', () => {
    const { rounds, slides } = syntheticSnapshotDocuments();
    const mapped = mapSnapshotToPrintEvent(
      { title: 'Syntetická akce' },
      { status: 'ready', quizTitle: 'Syntetický kvíz' },
      rounds,
      slides,
    );
    const json = JSON.stringify(mapped);
    expect(mapped.quiz.rounds).toHaveLength(5);
    expect(mapped.quiz.rounds.flatMap((round) => round.questions)).toHaveLength(50);
    expect(json).not.toMatch(/TAJNÝ TEXT|TAJNÁ POZNÁMKA|TAJNÉ-MEDIA-ID|LEGACY RAW|private-slide|round-/u);
    expect(mapped.quiz.rounds[0]?.questions[0]).toEqual({ number: 1, kind: 'choice', answerMode: 'choice', choiceCount: 3, answer: 'Možnost B', choiceLabel: 'B' });
  });
  test('uses bounded frozen print template rather than mutable event values', () => {
    const { rounds, slides } = syntheticSnapshotDocuments();
    const mapped = mapSnapshotToPrintEvent({ title: 'Akce', printTemplate: { title: 'IGNORED' } }, { status: 'ready', quizTitle: 'Kvíz', printTemplate: { title: 'Zamčená šablona', footer: 'A'.repeat(200), unknown: 'secret' } }, rounds, slides);
    expect(mapped.quiz.printTemplate).toEqual({ title: 'Zamčená šablona', footer: 'A'.repeat(160) });
  });
});
