// Offline illustrative samples only: no credentials, network or user quiz data.
// Build functions first, then render the PDFs with pdftoppm -singlefile -r 110 -png.
import { mkdir, writeFile } from 'node:fs/promises';
import { renderPrintArtifact } from '../../functions/lib/print/renderer.js';
import { mapSnapshotToPrintEvent } from '../../functions/lib/print/snapshot-mapper.js';
import { printRedesignData } from '../../tests/e2e/print-redesign-data.mjs';

const data = printRedesignData('mixed');
data.event.title = 'Ukázkový kvíz';
data.snapshot.quizTitle = 'Ukázka tiskových materiálů';
const answers = ['Praha', 'Vltava', 'Karel', 'Modrá', 'Jaro', 'Piano', 'Český lev', 'Pravda'];
data.slides.forEach((slide, index) => {
  slide.data.text = `Ukázková otázka ${index + 1}`;
  if (slide.data.options.length) {
    slide.data.options = slide.data.options.map((_, option) => option === 1 ? answers[index] : `Možnost ${String.fromCharCode(65 + option)}`);
  }
  slide.data.correctAnswer = answers[index];
});
const event = mapSnapshotToPrintEvent(data.event, data.snapshot, data.rounds, data.slides);
const scoreData = printRedesignData('long');
scoreData.event.title = data.event.title;
const scoreEvent = mapSnapshotToPrintEvent(scoreData.event, scoreData.snapshot, scoreData.rounds, scoreData.slides);
const teams = ['Filmoví nadšenci', 'Zlaté hlavy', 'Noční sovy', 'Parta od vedle', 'Čtyři mušketýři', 'Věční optimisté', 'Hvězdný tým', 'Kvízoví borci'].map((name, index) => ({id: `sample-${index}`, name}));
const output = 'output/pdf/print-editor-samples';
await mkdir(output, { recursive: true });
for (const [name, source, options] of [
  ['player-standard', event, { artifactType: 'team-sheets', mode: 'generic', teams: [], layout: 'spacious' }],
  ['player-compact', event, { artifactType: 'team-sheets', mode: 'generic', teams: [], layout: 'compact' }],
  ['organizer', event, { artifactType: 'organizer-sheets', layout: 'spacious' }],
  ['score', scoreEvent, { artifactType: 'score-table', teams }],
]) {
  const result = await renderPrintArtifact(source, { disposition: 'inline', colorMode: 'color', ...options });
  if (result.pageCount !== 1) throw new Error('Editor sample must be exactly one page');
  await writeFile(`${output}/${name}.pdf`, result.bytes);
  console.log(`${name}: 1 page`);
}
