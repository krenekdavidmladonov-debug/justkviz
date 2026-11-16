import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mapSnapshotToPrintEvent } from '../../functions/lib/print/snapshot-mapper.js';
import { renderPrintArtifact } from '../../functions/lib/print/renderer.js';
import { printRedesignData } from './print-redesign-data.mjs';

const directory = path.resolve('output/pdf/print-redesign');
await mkdir(directory, { recursive: true });
const manifest = [];
for (const scenario of ['abcd', 'mixed', 'six', 'long']) {
  const data = printRedesignData(scenario);
  const event = mapSnapshotToPrintEvent(data.event, data.snapshot, data.rounds, data.slides);
  for (const layout of ['spacious', ...(scenario === 'mixed' || scenario === 'long' ? ['compact'] : [])]) {
    for (const colorMode of ['color', ...(scenario === 'mixed' || scenario === 'long' ? ['grayscale'] : [])]) {
      const name = `${scenario}-${layout}-${colorMode}.pdf`;
      const result = await renderPrintArtifact(event, { artifactType: 'team-sheets', disposition: 'attachment', mode: 'single', teams: [data.teams[1]], layout, colorMode });
      await writeFile(path.join(directory, name), result.bytes);
      manifest.push({ name, scenario, layout, colorMode, pages: result.pageCount, questions: data.slides.length });
    }
  }
}
const data = printRedesignData('long'), event = mapSnapshotToPrintEvent(data.event, data.snapshot, data.rounds, data.slides);
for (const artifactType of ['answer-key', 'score-table']) {
  const result = await renderPrintArtifact(event, { artifactType, disposition: 'attachment', teams: data.teams, colorMode: 'color' });
  const name = artifactType + '.pdf';
  await writeFile(path.join(directory, name), result.bytes);
  manifest.push({ name, scenario: 'long', pages: result.pageCount });
}
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
