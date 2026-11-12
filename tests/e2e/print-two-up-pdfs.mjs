import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mapSnapshotToPrintEvent } from '../../functions/lib/print/snapshot-mapper.js';
import { renderPrintArtifact } from '../../functions/lib/print/renderer.js';
import { printRedesignData } from './print-redesign-data.mjs';

const directory = path.resolve('output/pdf/print-two-up');
await mkdir(directory, { recursive: true });
const manifest = [];
async function generate(name, scenario, options) {
  const data = printRedesignData(scenario);
  const event = mapSnapshotToPrintEvent(data.event, data.snapshot, data.rounds, data.slides);
  const result = await renderPrintArtifact(event, { disposition: 'attachment', ...options });
  await writeFile(path.join(directory, name + '.pdf'), result.bytes);
  manifest.push({ name: name + '.pdf', scenario, artifactType: options.artifactType, mode: options.mode, layout: options.layout, colorMode: options.colorMode ?? 'color', pages: result.pageCount, questions: data.slides.length, teamCount: options.teams?.length ?? 0, largestRoundQuestions: Math.max(...event.quiz.rounds.map(round => round.questions.length)) });
}
for (const scenario of ['abcd', 'mixed', 'six', 'long']) {
  const data = printRedesignData(scenario);
  for (const layout of ['spacious', ...(scenario === 'mixed' || scenario === 'long' ? ['compact'] : [])]) {
    for (const colorMode of ['color', ...(scenario === 'mixed' || scenario === 'long' ? ['grayscale'] : [])]) {
      await generate(`${scenario}-${layout}-${colorMode}`, scenario, { artifactType: 'team-sheets', mode: 'single', teams: [data.teams[1]], layout, colorMode });
    }
  }
}
for (const [layout, colorMode] of [['spacious', 'color'], ['compact', 'grayscale']]) {
  await generate(`organizer-${layout}-${colorMode}`, 'long', { artifactType: 'organizer-sheets', layout, colorMode });
}
const data = printRedesignData('long');
await generate('answer-key', 'long', { artifactType: 'answer-key' });
await generate('score-table', 'long', { artifactType: 'score-table', teams: data.teams });
await generate('odd-teams', 'mixed', { artifactType: 'team-sheets', mode: 'all', teams: [...data.teams, { id: 'team-3', name: 'Třetí tým' }] });
await generate('generic', 'mixed', { artifactType: 'team-sheets', mode: 'generic', teams: [] });
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
