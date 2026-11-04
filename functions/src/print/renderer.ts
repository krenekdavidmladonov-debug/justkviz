import fontkit from '@pdf-lib/fontkit';
import { brand, brandArtwork } from '@filmovy-kviz/quiz-domain';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage, type RGB } from 'pdf-lib';
import { PrintCenterError } from './errors.js';
import { PRINT_LIMITS } from './limits.js';
import { answerDisplay } from './snapshot-mapper.js';
import type { PrintEvent, PrintOptions, PrintQuestion, PrintTeam, RenderedPrintArtifact } from './types.js';

const require = createRequire(import.meta.url);
const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = 42;
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.3, 0.3, 0.3);
const RULE = rgb(0.62, 0.62, 0.62);
const LIGHT = rgb(0.94, 0.94, 0.94);
// Paper adaptation of theme.css --color-background and --color-accent.
const NAVY = rgb(11 / 255, 18 / 255, 32 / 255);
const GOLD = rgb(1, 193 / 255, 7 / 255);
const FIXED_DATE = new Date('2000-01-01T00:00:00.000Z');
const DEFAULT_INSTRUCTIONS = 'Zapisujte čitelně. Čísla odpovědí odpovídají otázkám v daném kole.';

interface FontFace {
  base: PDFFont;
  extended: PDFFont;
}

interface Fonts {
  regular: FontFace;
  bold: FontFace;
}

interface Layout {
  doc: PDFDocument;
  fonts: Fonts;
  page: PDFPage;
  width: number;
  height: number;
  y: number;
  startedAt: number;
  bottom: number;
  logo?: PDFImage;
  accent: RGB;
  grayscale: boolean;
}

let fontBytesPromise: Promise<[Uint8Array, Uint8Array, Uint8Array, Uint8Array]> | undefined;

function loadFontBytes(): Promise<[Uint8Array, Uint8Array, Uint8Array, Uint8Array]> {
  fontBytesPromise ??= Promise.all([
    readFile(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff')),
    readFile(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff')),
    readFile(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff')),
    readFile(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff')),
  ]);
  return fontBytesPromise;
}

function checkDeadline(layout: Layout): void {
  if (Date.now() - layout.startedAt > PRINT_LIMITS.generationMs) {
    throw new PrintCenterError(503, 'generation-timeout', 'Generování PDF překročilo časový limit.');
  }
}

function addPage(layout: Layout, landscape = false): PDFPage {
  checkDeadline(layout);
  if (layout.doc.getPageCount() >= PRINT_LIMITS.pages) {
    throw new PrintCenterError(422, 'page-limit', `Dokument překročil limit ${PRINT_LIMITS.pages} stran.`);
  }
  const size: [number, number] = landscape ? [PAGE.height, PAGE.width] : [PAGE.width, PAGE.height];
  layout.page = layout.doc.addPage(size);
  layout.width = size[0];
  layout.height = size[1];
  layout.y = layout.height - MARGIN;
  return layout.page;
}

function drawText(
  layout: Layout,
  text: string,
  x: number,
  y: number,
  size = 10,
  bold = false,
  color = INK,
): void {
  text = printableText(text);
  if (layout.grayscale) {
    const gray = color.red * .2126 + color.green * .7152 + color.blue * .0722;
    color = rgb(gray, gray, gray);
  }
  const face = bold ? layout.fonts.bold : layout.fonts.regular;
  let cursor = x;
  let run = '';
  let runFont = fontForCharacter(face, text[0] ?? ' ');
  const flush = (): void => {
    if (!run) return;
    layout.page.drawText(run, { x: cursor, y, size, font: runFont, color });
    cursor += runFont.widthOfTextAtSize(run, size);
    run = '';
  };
  for (const character of text) {
    const selected = fontForCharacter(face, character);
    if (selected !== runFont) {
      flush();
      runFont = selected;
    }
    run += character;
  }
  flush();
}

function printableText(text: string): string {
  return text.normalize('NFC').replace(/[‐‑‒–—−]/gu, '-');
}

function fontForCharacter(face: FontFace, character: string): PDFFont {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x0100 && codePoint <= 0x024f ? face.extended : face.base;
}

function textWidth(text: string, face: FontFace, size: number): number {
  let width = 0;
  let run = '';
  let runFont = fontForCharacter(face, text[0] ?? ' ');
  const flush = (): void => {
    if (!run) return;
    width += runFont.widthOfTextAtSize(run, size);
    run = '';
  };
  for (const character of text) {
    const selected = fontForCharacter(face, character);
    if (selected !== runFont) {
      flush();
      runFont = selected;
    }
    run += character;
  }
  flush();
  return width;
}

function wrapText(text: string, font: FontFace, size: number, maxWidth: number): string[] {
  const normalized = printableText(text).trim().replace(/\s+/gu, ' ');
  if (!normalized) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of normalized.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, font, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    let remainder = word;
    while (remainder && textWidth(remainder, font, size) > maxWidth) {
      let cut = 1;
      while (
        cut < remainder.length &&
        textWidth(remainder.slice(0, cut + 1), font, size) <= maxWidth
      ) cut += 1;
      lines.push(remainder.slice(0, cut));
      remainder = remainder.slice(cut);
    }
    current = remainder;
  }
  if (current) lines.push(current);
  return lines;
}

function drawBrandArtwork(layout: Layout, x: number, top: number, width: number, markOnly = false): void {
  const viewBox = markOnly ? brandArtwork.markViewBox : brandArtwork.viewBox;
  const paths = markOnly ? brandArtwork.markPaths : brandArtwork.paths;
  for (const path of paths) {
    layout.page.drawSvgPath(path.d, {
      x, y: top, scale: width / viewBox.width,
      color: layout.grayscale ? INK : path.ink === 'accent' ? GOLD : NAVY,
    });
  }
}

function drawHeader(layout: Layout, event: PrintEvent, documentTitle: string, team?: PrintTeam): void {
  const template = event.quiz.printTemplate ?? {};
  const available = layout.width - MARGIN * 2;
  const player = documentTitle === 'Odpovědní arch';
  if (template.showLogo !== false) {
    if (layout.logo) {
      const factor = Math.min(120 / layout.logo.width, 26 / layout.logo.height);
      layout.page.drawImage(layout.logo, { x: MARGIN, y: layout.y - 21, width: layout.logo.width * factor, height: layout.logo.height * factor });
      layout.y -= 48;
    } else {
      const customText = template.logoText && template.logoText !== brand.name ? template.logoText : undefined;
      drawBrandArtwork(layout, MARGIN, layout.y + 4, customText ? 27 : 132, !!customText);
      const logoLines = customText ? wrapText(customText, layout.fonts.bold, 13, available - 160) : [];
      logoLines.forEach((line, index) => drawText(layout, line, MARGIN + 38, layout.y - 15 - index * 17, 13, true, NAVY));
      drawText(layout, player ? 'PRO HRÁČSKÉ TÝMY' : 'POUZE PRO OBSLUHU', layout.width - MARGIN - 118, layout.y - 12, 7.5, true, MUTED);
      layout.y -= Math.max(48, logoLines.length * 17 + 21);
    }
  }
  for (const line of wrapText(documentTitle, layout.fonts.bold, 21, available)) {
    drawText(layout, line, MARGIN, layout.y, 21, true, NAVY);
    layout.y -= 25;
  }
  // Keep the actual event identifiable even when the frozen template has a custom title.
  const title = template.title ? event.title + ' / ' + template.title : event.title;
  for (const line of wrapText(title, layout.fonts.regular, 10, available)) {
    drawText(layout, line, MARGIN, layout.y + 2, 10, false, MUTED);
    layout.y -= 14;
  }
  layout.y -= 5;
  if (player) {
    const teamLines = team ? wrapText(team.name, layout.fonts.bold, 11, available - 130) : [''];
    const boxHeight = Math.max(30, teamLines.length * 16 + 12);
    layout.page.drawRectangle({ x: MARGIN, y: layout.y - boxHeight, width: available, height: boxHeight, borderColor: RULE, borderWidth: .65 });
    drawText(layout, 'TÝM', MARGIN + 10, layout.y - 20, 8, true, MUTED);
    if (team) teamLines.forEach((line, index) => drawText(layout, line, MARGIN + 48, layout.y - 20 - index * 16, 11, true));
    else layout.page.drawLine({ start: { x: MARGIN + 48, y: layout.y - 25 }, end: { x: layout.width - MARGIN - 92, y: layout.y - 25 }, thickness: .6, color: RULE });
    drawText(layout, 'STŮL', layout.width - MARGIN - 66, layout.y - 14, 6.5, true, MUTED);
    layout.page.drawLine({ start: { x: layout.width - MARGIN - 66, y: layout.y - 25 }, end: { x: layout.width - MARGIN - 12, y: layout.y - 25 }, thickness: .6, color: RULE });
    layout.y -= boxHeight + 12;
    const instructions = template.instructions ?? DEFAULT_INSTRUCTIONS;
    for (const line of instructions ? wrapText(instructions, layout.fonts.regular, 8.5, available) : []) {
      drawText(layout, line, MARGIN, layout.y, 8.5, false, MUTED);
      layout.y -= 11;
    }
  } else {
    drawText(layout, documentTitle.startsWith('Klíč') ? 'DŮVĚRNÉ / SPRÁVNÉ ODPOVĚDI' : 'ZÁZNAM BODŮ / PŘIJATÉ TÝMY', MARGIN, layout.y, 7.5, true, MUTED);
    layout.y -= 14;
  }
  layout.page.drawLine({ start: { x: MARGIN, y: layout.y }, end: { x: MARGIN + 39, y: layout.y }, thickness: 2.5, color: layout.accent });
  layout.page.drawLine({ start: { x: MARGIN + 47, y: layout.y }, end: { x: layout.width - MARGIN, y: layout.y }, thickness: .5, color: RULE });
  layout.y -= 16;
}

function ensureSpace(layout: Layout, required: number, nextPage: () => void): void {
  if (layout.y - required < layout.bottom) nextPage();
  if (layout.y - required < layout.bottom) throw new PrintCenterError(422, 'layout-limit', 'Záhlaví zabírá příliš místa. Zkraťte nadpis nebo pokyny pro tisk.');
}

function roundHeadingLines(layout: Layout, round: PrintEvent['quiz']['rounds'][number], continuation = false): string[] {
  return wrapText(round.title + (continuation ? ' / pokračování' : ''), layout.fonts.bold, 11, layout.width - MARGIN * 2 - 104);
}

function roundHeadingHeight(layout: Layout, round: PrintEvent['quiz']['rounds'][number], continuation = false): number {
  return Math.max(32, roundHeadingLines(layout, round, continuation).length * 15 + 14) + 8;
}

function drawRoundHeader(layout: Layout, round: PrintEvent['quiz']['rounds'][number], continuation = false): void {
  const lines = roundHeadingLines(layout, round, continuation);
  const height = roundHeadingHeight(layout, round, continuation) - 8;
  layout.page.drawLine({ start: { x: MARGIN, y: layout.y }, end: { x: MARGIN, y: layout.y - height + 6 }, thickness: 3, color: layout.accent });
  drawText(layout, 'KOLO ' + String(round.number).padStart(2, '0'), MARGIN + 11, layout.y - 15, 9, true, NAVY);
  lines.forEach((line, index) => drawText(layout, line, MARGIN + 91, layout.y - 15 - index * 15, 11, true, NAVY));
  layout.y -= height + 8;
}

// A landscape A4 is cut into two portrait panels. Typography and writing space
// are designed at this final size, rather than scaling down existing A4 pages.
const PANEL_WIDTH = PAGE.height / 2;
const PANEL_MARGIN = 24;
const PANEL_CONTENT = PANEL_WIDTH - PANEL_MARGIN * 2;
const PANEL_TINT = rgb(1, .972, .88);
const PANEL_GRAY = rgb(.955, .955, .955);
type Round = PrintEvent['quiz']['rounds'][number];
interface PanelBlock {
  round: Round;
  columns: number;
  fontSize: number;
  height: number;
  questions: Array<{ question: PrintQuestion; height: number; answerLines?: string[] }>;
}
interface PanelPlan { blocks: PanelBlock[]; reserve?: boolean }

function panelColor(layout: Layout, color: RGB): RGB {
  if (!layout.grayscale) return color;
  const gray = color.red * .2126 + color.green * .7152 + color.blue * .0722;
  return rgb(gray, gray, gray);
}

function panelFooterLines(layout: Layout, event: PrintEvent): string[] {
  return wrapText(event.quiz.printTemplate?.footer ?? 'JustKvíz / Prostor pro vaše znalosti', layout.fonts.regular, 8, PANEL_CONTENT - 80);
}

function panelBottom(layout: Layout, event: PrintEvent): number {
  return PANEL_MARGIN + panelFooterLines(layout, event).length * 11 + 16;
}

function panelHeaderParts(layout: Layout, event: PrintEvent, team: PrintTeam | undefined, organizer = false) {
  const template = event.quiz.printTemplate ?? {};
  const customText = template.logoText && template.logoText !== brand.name ? template.logoText : undefined;
  const brandLines = template.showLogo === false || layout.logo || !customText ? [] : wrapText(customText, layout.fonts.bold, 11, PANEL_CONTENT - 34);
  const eventLines = wrapText(template.title ? `${event.title} / ${template.title}` : event.title, layout.fonts.regular, 8.5, PANEL_CONTENT);
  const teamLines = team ? wrapText(team.name, layout.fonts.bold, 10, PANEL_CONTENT - 100) : [''];
  // The mandatory response legend already covers default player instructions.
  // Keep authored instructions, while avoiding redundant copy in the small header.
  const instructionText = organizer ? (template.instructions ? 'Kontrolní zápisy podle připraveného kvízu.' : '')
    : template.instructions === DEFAULT_INSTRUCTIONS ? '' : template.instructions;
  const instructions = instructionText ? wrapText(instructionText, layout.fonts.regular, 8, PANEL_CONTENT) : [];
  const logoHeight = template.showLogo === false ? 0 : Math.max(28, brandLines.length * 14 + 8);
  const teamHeight = organizer ? 0 : Math.max(31, teamLines.length * 13 + 13);
  const height = logoHeight + 24 + eventLines.length * 11 + 7 + (organizer ? 0 : teamHeight + 9) + instructions.length * 10 + (instructions.length ? 7 : 0) + (organizer ? 0 : 17);
  return { brandLines, eventLines, teamLines, instructions, logoHeight, teamHeight, height };
}

function panelRoundLines(layout: Layout, round: Round): string[] {
  return wrapText(round.title, layout.fonts.bold, 9.5, PANEL_CONTENT - 74);
}

function panelRoundHeight(layout: Layout, round: Round): number {
  return Math.max(28, panelRoundLines(layout, round).length * 12 + 10) + 5;
}

function validateResponse(question: PrintQuestion): void {
  if (!['open', 'choice', 'true-false'].includes(question.answerMode)) {
    throw new PrintCenterError(422, 'invalid-snapshot', 'Otázka nemá platný způsob odpovědi pro tisk.');
  }
  if (question.answerMode === 'choice' && (!Number.isInteger(question.choiceCount) || (question.choiceCount ?? 0) < 2 || (question.choiceCount ?? 0) > 6)) {
    throw new PrintCenterError(422, 'invalid-snapshot', 'Otázka nemá platný počet možností pro tisk.');
  }
}

function fitRound(layout: Layout, round: Round, availableHeight: number, organizer: boolean, compact: boolean): PanelBlock {
  round.questions.forEach(validateResponse);
  const headingHeight = panelRoundHeight(layout, round);
  // A round is indivisible. Prefer roomy full-width rows, then a denser font,
  // then two columns; never create an unexpected second side of a team sheet.
  for (const columns of [1, 2]) {
    const width = (PANEL_CONTENT - (columns - 1) * 16) / columns;
    for (const fontSize of [9.5, 9, 8.5, 8]) {
      const rowMinimum = compact ? 24 : 30;
      const minimum = Math.max(19, rowMinimum - (9.5 - fontSize) * 6);
      const questions = round.questions.map(question => {
        // Player pagination must not even read the private answer properties.
        const answerLines = organizer ? wrapText(answerDisplay(question), layout.fonts.bold, fontSize, width - 29) : undefined;
        return { question, height: organizer ? Math.max(minimum, answerLines!.length * (fontSize + 3) + 9) : minimum, ...(answerLines ? { answerLines } : {}) };
      });
      const rowsPerColumn = Math.ceil(questions.length / columns);
      const columnHeights = Array.from({ length: columns }, (_, column) => questions.slice(column * rowsPerColumn, (column + 1) * rowsPerColumn).reduce((sum, question) => sum + question.height, 0));
      const height = headingHeight + Math.max(0, ...columnHeights);
      if (height <= availableHeight) return { round, columns, fontSize, height, questions };
    }
  }
  throw new PrintCenterError(422, 'layout-limit', `Kolo ${round.number} se nevejde na jednu stranu poloviny A4 při čitelném písmu. Zkraťte záhlaví nebo odpovědi, případně rozdělte kolo v kvízu.`);
}

function planPanels(layout: Layout, event: PrintEvent, headerHeight: number, organizer: boolean): PanelPlan[] {
  const compact = event.quiz.printTemplate?.layout === 'compact';
  const top = PAGE.width - PANEL_MARGIN - headerHeight - (organizer ? 29 : 0);
  const bottom = panelBottom(layout, event);
  const plans: PanelPlan[] = [];
  let plan: PanelPlan = { blocks: [] };
  let y = top;
  const nextPanel = (): void => {
    checkDeadline(layout);
    plan = { blocks: [] };
    plans.push(plan);
    y = top;
  };
  for (const round of event.quiz.rounds) {
    if (!round.questions.length) continue;
    let block = fitRound(layout, round, top - bottom, organizer, compact);
    if (compact && plan.blocks.length && y - block.height < bottom) {
      try { block = fitRound(layout, round, y - bottom, organizer, compact); }
      catch (error) { if (!(error instanceof PrintCenterError) || error.code !== 'layout-limit') throw error; }
    }
    if (!compact || !plan.blocks.length || y - block.height < bottom) nextPanel();
    plan.blocks.push(block);
    y -= block.height + (compact ? 9 : 12);
  }
  return plans.filter(panel => panel.blocks.length > 0);
}

function drawPanelHeader(layout: Layout, event: PrintEvent, x: number, team: PrintTeam | undefined, organizer: boolean, reserve: boolean): void {
  const parts = panelHeaderParts(layout, event, team, organizer);
  let y = PAGE.width - PANEL_MARGIN;
  const text = (value: string, dx: number, dy: number, size = 8, bold = false, color = INK) => drawText(layout, value, x + dx, dy, size, bold, color);
  if (parts.logoHeight) {
    if (layout.logo) {
      const factor = Math.min(112 / layout.logo.width, 21 / layout.logo.height);
      layout.page.drawImage(layout.logo, { x, y: y - 19, width: layout.logo.width * factor, height: layout.logo.height * factor });
    } else {
      drawBrandArtwork(layout, x, y + 2, parts.brandLines.length ? 23 : 112, parts.brandLines.length > 0);
      parts.brandLines.forEach((line, index) => text(line, 33, y - 14 - index * 14, 11, true, NAVY));
    }
    y -= parts.logoHeight;
  }
  text(organizer ? 'Kontrolní odpovědní arch' : 'Odpovědní arch', 0, y - 14, 14, true, NAVY);
  y -= 24;
  parts.eventLines.forEach((line, index) => text(line, 0, y - 8 - index * 11, 8.5, false, MUTED));
  y -= parts.eventLines.length * 11 + 7;
  if (!organizer) {
    layout.page.drawRectangle({ x, y: y - parts.teamHeight, width: PANEL_CONTENT, height: parts.teamHeight, color: layout.grayscale ? PANEL_GRAY : PANEL_TINT });
    layout.page.drawRectangle({ x, y: y - parts.teamHeight, width: 3, height: parts.teamHeight, color: layout.accent });
    text('TÝM', 10, y - 18, 8, true, MUTED);
    if (team) parts.teamLines.forEach((line, index) => text(line, 42, y - 18 - index * 13, 10, true, NAVY));
    else {
      if (reserve) text('REZERVNÍ ARCH', 42, y - 11, 8, true, MUTED);
      layout.page.drawLine({ start: { x: x + 42, y: y - 25 }, end: { x: x + PANEL_CONTENT - 64, y: y - 25 }, thickness: .65, color: RULE });
    }
    text('STŮL', PANEL_CONTENT - 48, y - 11, 8, true, MUTED);
    layout.page.drawLine({ start: { x: x + PANEL_CONTENT - 48, y: y - 25 }, end: { x: x + PANEL_CONTENT - 10, y: y - 25 }, thickness: .65, color: RULE });
    y -= parts.teamHeight + 9;
  }
  parts.instructions.forEach((line, index) => text(line, 0, y - 8 - index * 10, 8, false, MUTED));
  if (!organizer) {
    y -= parts.instructions.length * 10 + (parts.instructions.length ? 7 : 0);
    text(reserve ? 'Doplňte kolo; napište odpověď, písmeno nebo Pravda / Lež.' : 'U možností označte jednu odpověď; jinak odpověď napište.', 0, y - 8, 8, false, MUTED);
  }
}

function drawPanel(layout: Layout, event: PrintEvent, panel: PanelPlan, side: number, team: PrintTeam | undefined, headerHeight: number, index: number, total: number, organizer: boolean, reserve = false): void {
  const x = side * PANEL_WIDTH + PANEL_MARGIN;
  const text = (value: string, dx: number, y: number, size = 8, bold = false, color = INK) => drawText(layout, value, x + dx, y, size, bold, color);
  drawPanelHeader(layout, event, x, team, organizer, reserve);
  let y = PAGE.width - PANEL_MARGIN - headerHeight;
  if (organizer) {
    layout.page.drawRectangle({ x, y: y - 22, width: PANEL_CONTENT, height: 25, color: panelColor(layout, NAVY) });
    text('PRO ORGANIZÁTORA / SPRÁVNÉ ODPOVĚDI', 8, y - 7, 8, true, rgb(1, 1, 1));
    text('NEDÁVAT HRÁČŮM', 8, y - 18, 8, true, rgb(1, 1, 1));
    y -= 29;
  }
  for (const block of panel.blocks) {
    const height = panelRoundHeight(layout, block.round);
    layout.page.drawRectangle({ x, y: y - height + 5, width: PANEL_CONTENT, height: height - 5, color: layout.grayscale ? PANEL_GRAY : rgb(.94, .953, .972) });
    layout.page.drawRectangle({ x, y: y - height + 5, width: 3, height: height - 5, color: layout.accent });
    text(panel.reserve ? 'KOLO' : 'KOLO ' + String(block.round.number).padStart(2, '0'), 10, y - 16, 9, true, NAVY);
    panelRoundLines(layout, block.round).forEach((line, lineIndex) => text(line, 74, y - 16 - lineIndex * 12, 9.5, true, NAVY));
    y -= height;
    const rowTop = y;
    const columnWidth = (PANEL_CONTENT - (block.columns - 1) * 16) / block.columns;
    const rowsPerColumn = Math.ceil(block.questions.length / block.columns);
    for (const [questionIndex, { question, height: rowHeight, answerLines }] of block.questions.entries()) {
      const column = Math.floor(questionIndex / rowsPerColumn);
      if (questionIndex % rowsPerColumn === 0) y = rowTop;
      const dx = column * (columnWidth + 16);
      const baseline = Math.min(19, rowHeight - 6);
      text(String(question.number).padStart(2, '0'), dx + 3, y - baseline, block.fontSize + 1.5, true, NAVY);
      if (organizer) {
        answerLines!.forEach((line, lineIndex) => text(line, dx + 29, y - block.fontSize - 5 - lineIndex * (block.fontSize + 3), block.fontSize, true));
        layout.page.drawLine({ start: { x: x + dx + 29, y: y - rowHeight + 3 }, end: { x: x + dx + columnWidth, y: y - rowHeight + 3 }, thickness: .45, color: RULE });
      } else if (question.answerMode === 'open') {
        layout.page.drawLine({ start: { x: x + dx + 29, y: y - rowHeight + 5 }, end: { x: x + dx + columnWidth, y: y - rowHeight + 5 }, thickness: .65, color: RULE });
      } else {
        const labels = question.answerMode === 'choice' ? Array.from({ length: question.choiceCount! }, (_, choiceIndex) => String.fromCharCode(65 + choiceIndex)) : ['Pravda', 'Lež'];
        const spacing = block.columns === 1 ? (question.answerMode === 'choice' ? 51 : 112) : (columnWidth - 30) / labels.length;
        labels.forEach((label, choiceIndex) => {
          const cx = x + dx + 35 + choiceIndex * spacing;
          const cy = y - baseline + 3;
          const radius = block.columns === 1 ? 5 : 3.5;
          layout.page.drawCircle({ x: cx, y: cy, size: radius, borderColor: INK, borderWidth: .8 });
          text(label, cx - x + radius + 3, cy - 3, Math.min(9, block.fontSize), true);
        });
      }
      y -= rowHeight;
    }
    y = rowTop - (block.height - height) - (event.quiz.printTemplate?.layout === 'compact' ? 9 : 12);
  }
  const lines = panelFooterLines(layout, event);
  const top = PANEL_MARGIN + lines.length * 11;
  layout.page.drawLine({ start: { x, y: top + 6 }, end: { x: x + PANEL_CONTENT, y: top + 6 }, thickness: .5, color: RULE });
  lines.forEach((line, lineIndex) => text(line, 0, top - 9 - lineIndex * 11, 8, false, MUTED));
  const label = `Strana ${index + 1} / ${total}`;
  text(label, PANEL_CONTENT - textWidth(label, layout.fonts.regular, 8), PANEL_MARGIN, 8, false, MUTED);
}

function renderPairedSheets(layout: Layout, event: PrintEvent, options: PrintOptions): void {
  const organizer = options.artifactType === 'organizer-sheets';
  const teams: Array<PrintTeam | undefined> = options.artifactType === 'team-sheets' && options.mode !== 'generic' ? options.teams : [undefined];
  if (!teams.length) throw new PrintCenterError(409, 'missing-teams', 'Akce zatím nemá žádné přijaté týmy. Použijte prázdný odpovědní arch.');
  const headerHeight = Math.max(...teams.map(team => panelHeaderParts(layout, event, team, organizer).height), panelHeaderParts(layout, event, undefined, organizer).height);
  const panels = planPanels(layout, event, headerHeight, organizer);
  interface Sheet { panel: PanelPlan; team?: PrintTeam; index: number; total: number }
  const sheets: Sheet[] = [];
  const duplicate = organizer || options.artifactType === 'team-sheets' && options.mode !== 'all';
  if (duplicate) {
    panels.forEach((panel, index) => {
      const sheet = { panel, team: teams[0], index, total: panels.length };
      sheets.push(sheet, sheet);
    });
  } else {
    // Keep corresponding round panels together, while packing an odd final team
    // into the next panel rather than making a reserve copy for every round.
    for (let teamIndex = 0; teamIndex < teams.length; teamIndex += 2) {
      panels.forEach((panel, index) => {
        sheets.push({ panel, team: teams[teamIndex], index, total: panels.length });
        if (teams[teamIndex + 1]) sheets.push({ panel, team: teams[teamIndex + 1], index, total: panels.length });
      });
    }
    const round: Round = {
      number: 0, title: '_______________________________',
      questions: Array.from({ length: Math.max(...event.quiz.rounds.map(round => round.questions.length)) }, (_, index) => ({ number: index + 1, kind: 'free', answerMode: 'open', answer: '' })),
    };
    const reserveBlock = fitRound(layout, round, PAGE.width - PANEL_MARGIN - headerHeight - panelBottom(layout, event), false, event.quiz.printTemplate?.layout === 'compact');
    sheets.push({ panel: { blocks: [reserveBlock], reserve: true }, index: 0, total: 1 });
  }
  for (let offset = 0; offset < sheets.length; offset += 2) {
    addPage(layout, true);
    layout.page.drawLine({ start: { x: PANEL_WIDTH, y: 12 }, end: { x: PANEL_WIDTH, y: PAGE.width - 12 }, thickness: .5, color: RULE, dashArray: [4, 5] });
    sheets.slice(offset, offset + 2).forEach((sheet, side) => drawPanel(layout, event, sheet.panel, side, sheet.team, headerHeight, sheet.index, sheet.total, organizer, sheet.panel.reserve));
  }
}

function renderAnswerKey(layout: Layout, event: PrintEvent): void {
  addPage(layout);
  const repeatHeader = (): void => {
    addPage(layout);
    drawHeader(layout, event, 'Klíč správných odpovědí — pokračování');
  };
  drawHeader(layout, event, 'Klíč správných odpovědí');
  for (const round of event.quiz.rounds) {
    const headingHeight = roundHeadingHeight(layout, round);
    const firstQuestion = round.questions[0];
    const firstAnswerHeight = firstQuestion
      ? Math.max(22, wrapText(answerDisplay(firstQuestion), layout.fonts.regular, 9, layout.width - MARGIN * 2 - 32).length * 12 + 8)
      : 0;
    ensureSpace(layout, headingHeight + firstAnswerHeight, repeatHeader);
    drawRoundHeader(layout, round);
    for (const question of round.questions) {
      const lines = wrapText(answerDisplay(question), layout.fonts.regular, 9, layout.width - MARGIN * 2 - 32);
      const rowHeight = Math.max(22, lines.length * 12 + 8);
      if (layout.y - rowHeight < layout.bottom) {
        repeatHeader();
        ensureSpace(layout, roundHeadingHeight(layout, round, true) + rowHeight, () => { throw new PrintCenterError(422, 'layout-limit', 'Odpověď nebo záhlaví jsou příliš dlouhé pro jednu stranu.'); });
        drawRoundHeader(layout, round, true);
      }
      if (layout.y - rowHeight < layout.bottom) throw new PrintCenterError(422, 'layout-limit', 'Záhlaví nebo odpověď je příliš dlouhá. Zkraťte nadpis pro tisk.');
      drawText(layout, `${question.number}.`, MARGIN + 4, layout.y - 10, 9, true);
      lines.forEach((line, index) => drawText(layout, line, MARGIN + 31, layout.y - 10 - index * 12, 9));
      layout.page.drawLine({ start: { x: MARGIN, y: layout.y - rowHeight + 2 }, end: { x: layout.width - MARGIN, y: layout.y - rowHeight + 2 }, thickness: 0.45, color: RULE });
      layout.y -= rowHeight;
    }
    layout.y -= 7;
  }
}

function drawScoreHeader(layout: Layout, roundNumbers: number[], columnWidths: number[], lastSection: boolean): void {
  const tableWidth = columnWidths.reduce((total, width) => total + width, 0);
  const top = layout.y;
  layout.page.drawRectangle({ x: MARGIN, y: top - 25, width: tableWidth, height: 25, color: LIGHT, borderColor: INK, borderWidth: 0.7 });
  const labels = ['Tým', ...roundNumbers.map((number) => `Kolo ${number}`), lastSection ? 'Celkem' : 'Mezisoučet'];
  let x = MARGIN;
  labels.forEach((label, index) => {
    drawText(layout, label, x + 4, top - 16, index === 0 ? 8.5 : 7.3, true);
    x += columnWidths[index] ?? 0;
    if (index < labels.length - 1) layout.page.drawLine({ start: { x, y: top }, end: { x, y: top - 25 }, thickness: 0.6, color: RULE });
  });
  layout.y -= 25;
}

function renderScoreTable(layout: Layout, event: PrintEvent, teams: PrintTeam[]): void {
  if (teams.length === 0) throw new PrintCenterError(409, 'missing-teams', 'Bodovací tabulka bude dostupná po přidání přijatých týmů.');
  const landscape = event.quiz.rounds.length > 5;
  const roundsPerSection = landscape ? 9 : 5;
  for (let start = 0; start < event.quiz.rounds.length; start += roundsPerSection) {
    const roundNumbers = event.quiz.rounds.slice(start, start + roundsPerSection).map((round) => round.number);
    let teamOffset = 0;
    while (teamOffset < teams.length) {
      addPage(layout, landscape);
      drawHeader(layout, event, start === 0 ? 'Bodovací tabulka' : `Bodovací tabulka — kola ${roundNumbers[0]}–${roundNumbers.at(-1)}`);
      drawText(layout, 'Zapisujte body za jednotlivá kola a jejich celkový součet.', MARGIN, layout.y, 8.5, false, MUTED);
      layout.y -= 17;
      const available = layout.width - MARGIN * 2;
      const teamWidth = landscape ? 150 : 135;
      const totalWidth = 54;
      const scoreWidth = (available - teamWidth - totalWidth) / roundNumbers.length;
      const widths = [teamWidth, ...roundNumbers.map(() => scoreWidth), totalWidth];
      drawScoreHeader(layout, roundNumbers, widths, start + roundsPerSection >= event.quiz.rounds.length);
      let pageTeamCount = 0;
      for (const team of teams.slice(teamOffset)) {
        const nameLines = wrapText(team.name, layout.fonts.regular, 9, teamWidth - 12);
        const rowHeight = Math.max(32, nameLines.length * 12 + 12);
        if (layout.y - rowHeight < layout.bottom) break;
        const top = layout.y;
        let x = MARGIN;
        layout.page.drawRectangle({ x, y: top - rowHeight, width: available, height: rowHeight, borderColor: RULE, borderWidth: 0.6 });
        nameLines.forEach((line, index) => drawText(layout, line, x + 6, top - 14 - index * 12, 9));
        widths.slice(0, -1).forEach((width) => {
          x += width;
          layout.page.drawLine({ start: { x, y: top }, end: { x, y: top - rowHeight }, thickness: 0.6, color: RULE });
        });
        layout.y -= rowHeight;
        pageTeamCount += 1;
      }
      if (pageTeamCount === 0) throw new PrintCenterError(422, 'layout-limit', 'Název týmu nebo záhlaví je příliš dlouhé pro bodovací tabulku. Zkraťte jej.');
      teamOffset += pageTeamCount;
    }
  }
}

function addPageNumbers(layout: Layout, event: PrintEvent): void {
  const { doc, fonts } = layout;
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    layout.page = page;
    const footer = event.quiz.printTemplate?.footer ?? 'JustKvíz / Prostor pro vaše znalosti';
    const footerLines = wrapText(footer, fonts.regular, 8, page.getWidth() - MARGIN * 2 - 96);
    const footerTop = MARGIN + footerLines.length * 11;
    page.drawLine({ start: { x: MARGIN, y: footerTop + 8 }, end: { x: page.getWidth() - MARGIN, y: footerTop + 8 }, thickness: .5, color: RULE });
    footerLines.forEach((line, lineIndex) => drawText(layout, line, MARGIN, footerTop - 11 - lineIndex * 11, 8, false, MUTED));
    const label = `Strana ${index + 1} / ${pages.length}`;
    const width = textWidth(label, fonts.regular, 8);
    page.drawText(label, { x: page.getWidth() - MARGIN - width, y: MARGIN, size: 8, font: fonts.regular.base, color: MUTED });
  });
}

function filenameFor(options: PrintOptions): string {
  if (options.artifactType === 'organizer-sheets') return 'organizatorske-archy.pdf';
  if (options.artifactType === 'answer-key') return 'klic-spravnych-odpovedi.pdf';
  if (options.artifactType === 'score-table') return 'bodovaci-tabulka.pdf';
  return 'odpovedni-archy.pdf';
}

export async function renderPrintArtifact(event: PrintEvent, options: PrintOptions): Promise<RenderedPrintArtifact> {
  // Transient presentation choices never mutate the frozen snapshot template.
  event = { ...event, quiz: { ...event.quiz, printTemplate: {
    ...event.quiz.printTemplate,
    ...(options.layout ? { layout: options.layout === 'spacious' ? 'comfortable' : 'compact' } : {}),
    ...(options.showLogo === undefined ? {} : { showLogo: options.showLogo }),
    instructions: options.showInstructions === false ? '' : event.quiz.printTemplate?.instructions || DEFAULT_INSTRUCTIONS,
  } } };
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regularBytes, regularExtendedBytes, boldBytes, boldExtendedBytes] = await loadFontBytes();
  const fonts: Fonts = {
    regular: {
      base: await doc.embedFont(new Uint8Array(regularBytes), { subset: true }),
      extended: await doc.embedFont(new Uint8Array(regularExtendedBytes), { subset: true }),
    },
    bold: {
      base: await doc.embedFont(new Uint8Array(boldBytes), { subset: true }),
      extended: await doc.embedFont(new Uint8Array(boldExtendedBytes), { subset: true }),
    },
  };
  doc.setTitle(`${brand.name} — tiskové centrum`);
  doc.setAuthor(brand.name);
  doc.setCreator(brand.name);
  doc.setProducer('pdf-lib');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);

  const placeholder = doc.addPage([PAGE.width, PAGE.height]);
  const footer = event.quiz.printTemplate?.footer ?? 'JustKvíz / Prostor pro vaše znalosti';
  // Reserve footer space at the narrowest page width, including long unbroken copy.
  const footerHeight = wrapText(footer, fonts.regular, 8, PAGE.width - MARGIN * 2 - 96).length * 11;
  const layout: Layout = { doc, fonts, page: placeholder, width: PAGE.width, height: PAGE.height, y: 0, startedAt: Date.now(), bottom: MARGIN + footerHeight + 23, accent: GOLD, grayscale: options.colorMode === 'grayscale' };
  const hex = event.quiz.printTemplate?.accentColor?.replace('#', '');
  const expanded = hex?.length === 3 ? hex.split('').map(char => char + char).join('') : hex;
  if (expanded && /^[a-f\d]{6}$/iu.test(expanded)) layout.accent = rgb(parseInt(expanded.slice(0, 2), 16) / 255, parseInt(expanded.slice(2, 4), 16) / 255, parseInt(expanded.slice(4, 6), 16) / 255);
  if (layout.grayscale) layout.accent = INK;
  if (event.quiz.printTemplate?.showLogo !== false && event.logo && !layout.grayscale) {
    try { layout.logo = event.logo.contentType === 'image/png' ? await doc.embedPng(event.logo.bytes) : await doc.embedJpg(event.logo.bytes); }
    catch { throw new PrintCenterError(422, 'invalid-logo', 'Logo nelze vložit do PDF. Nahrajte platný PNG nebo JPEG soubor.'); }
  }
  doc.removePage(0);

  if (options.artifactType === 'team-sheets' || options.artifactType === 'organizer-sheets') renderPairedSheets(layout, event, options);
  else if (options.artifactType === 'answer-key') renderAnswerKey(layout, event);
  else renderScoreTable(layout, event, options.teams);

  if (options.artifactType !== 'team-sheets' && options.artifactType !== 'organizer-sheets') addPageNumbers(layout, event);
  const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  if (bytes.byteLength > PRINT_LIMITS.outputBytes) {
    throw new PrintCenterError(422, 'output-limit', 'Výsledné PDF překročilo povolenou velikost.');
  }
  return { bytes, pageCount: doc.getPageCount(), filename: filenameFor(options) };
}
