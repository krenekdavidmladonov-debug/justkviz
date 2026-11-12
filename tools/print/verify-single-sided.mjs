import { mkdir, writeFile } from 'node:fs/promises';
import { renderPrintArtifact } from '../../functions/lib/print/renderer.js';
const directory = 'output/pdf/event-night-print';
await mkdir(directory, { recursive: true });
const rounds = [30, 7, 11].map((count, roundIndex) => ({
  number: roundIndex + 1, title: 'Ukázkové kolo ' + (roundIndex + 1),
  questions: Array.from({ length: count }, (_, index) => ({
    number: index + 1, kind: index % 3 === 0 ? 'choice' : index % 3 === 1 ? 'free' : 'pl',
    answerMode: index % 3 === 0 ? 'choice' : index % 3 === 1 ? 'open' : 'true-false',
    ...(index % 3 === 0 ? { choiceCount: 6, choiceLabel: 'B' } : {}),
    answer: index % 3 === 2 ? 'Pravda' : 'Ukázka ' + (index + 1),
  })),
}));
const event = { title: 'Syntetický kvízový večer', quiz: { title: 'Umělá tisková data', rounds } };
const teams = Array.from({ length: 3 }, (_, index) => ({ id: 'synthetic-' + index, name: 'Ukázkový tým ' + (index + 1) }));
const cases = [
  ['dense-player', { ...event, quiz: { ...event.quiz, rounds: [rounds[0]] } }, { artifactType: 'team-sheets', mode: 'generic', teams: [] }],
  ['dense-organizer', { ...event, quiz: { ...event.quiz, rounds: [rounds[0]] } }, { artifactType: 'organizer-sheets' }],
  ['all-odd', event, { artifactType: 'team-sheets', mode: 'all', teams }],
  ['all-even', event, { artifactType: 'team-sheets', mode: 'all', teams: teams.slice(0, 2) }],
  ['compact', event, { artifactType: 'team-sheets', mode: 'generic', teams: [], layout: 'compact', colorMode: 'grayscale' }],
];
const manifest = [];
for (const [name, source, options] of cases) {
  const result = await renderPrintArtifact(source, { disposition: 'inline', ...options });
  await writeFile(directory + '/' + name + '.pdf', result.bytes);
  manifest.push({ name, pages: result.pageCount });
}
await writeFile(directory + '/manifest.json', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));