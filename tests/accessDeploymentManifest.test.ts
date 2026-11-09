import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, test } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const manifest = JSON.parse(read('tools/access/deployment-manifest.json')) as {
  projectId: string; region: string; functions: string[]; unchangedExcluded: Record<string, string>;
  existingFunctionUpdates: number; newAccessFunctions: number; auth: { newProviders: boolean };
};

test('the targeted deployment accounts for every exported Function, including explicit exclusions', () => {
  const source = ts.createSourceFile('index.ts', read('functions/src/index.ts'), ts.ScriptTarget.Latest, true);
  const exported: string[] = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      exported.push(...statement.exportClause.elements.map(element => element.name.text));
    }
    if (ts.isVariableStatement(statement) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      exported.push(...statement.declarationList.declarations.map(declaration => declaration.name.getText(source)));
    }
  }
  const accounted = [...manifest.functions, ...Object.keys(manifest.unchangedExcluded)];
  expect(new Set(accounted).size).toBe(accounted.length);
  expect(accounted.sort()).toEqual(exported.sort());
  expect(manifest.functions.length).toBe(manifest.existingFunctionUpdates + manifest.newAccessFunctions);
  expect(manifest.projectId).toBe('filmovy-kviz-v2-staging');
  expect(manifest.region).toBe('europe-west1');
  expect(manifest.auth.newProviders).toBe(false);
  for (const worker of ['dispatchRegistrationEmail', 'deliverEmailTask', 'createEventTeamMessage']) expect(manifest.functions).not.toContain(worker);
  expect(manifest.functions).not.toContain('readLocalEventMediaManifest');
  expect(manifest.unchangedExcluded.readLocalEventMediaManifest).toContain('Demo emulators only');
  for (const name of ['readLocalEventMediaAuthorization', 'readLocalProjectorMediaAuthority', 'readLocalImageManifest', 'authorizeLocalImageBackup', 'readLocalImageAuthority',
    'prepareOfflineEvent', 'readOfflineTrust', 'authorizeOfflineEvent', 'previewOfflineSync', 'commitOfflineSync']) {
    expect(manifest.functions).not.toContain(name);
    expect(manifest.unchangedExcluded[name]).toContain('Demo emulators only');
  }
});

test('deployed Rules candidates are exactly the Rules exercised by the access isolation suite', () => {
  const normalized = (path: string) => read(path).replaceAll('\r\n', '\n');
  expect(normalized('firestore.rules')).toBe(normalized('tests/access/firestore.candidate.rules'));
  expect(normalized('storage.rules')).toBe(normalized('tests/access/storage.candidate.rules'));
});
