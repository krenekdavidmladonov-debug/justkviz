import { execFileSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const ENTRY = 'functions/src/index.ts';
const DOMAIN = 'packages/quiz-domain/src/index.ts';
const shaPattern = /^[a-f0-9]{40}$/u;
const sourcePath = name => /^(?:functions|packages\/quiz-domain)\/src\/.*\.(?:ts|js|mts|mjs)$/u.test(name);
const buildPath = name => /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.gitattributes|\.gitmodules|\.node-version|\.nvmrc|\.yarnrc[^/]*|\.pnp[^/]*|\.npmrc|\.pnpmfile\..*|tsconfig[^/]*\.json|firebase[^/]*\.json|functions\/(?!src\/)|packages\/(?!quiz-domain\/src\/)|patches\/|tools\/media-worker\/|tools\/deploy\/(?!.*\.test\.mjs$)|tools\/staging\/(?:functions-package-lock\.json|restart-build-core\.mjs))/u.test(name);

function git(root, args, options = {}) {
  return execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options });
}

// Read Git objects, never checkout files or execute code from either revision.
function readTree(root, revision) {
  if (!shaPattern.test(revision ?? '')) throw new Error('Revize musí být úplné neměnné SHA commitu.');
  const commit = git(root, ['rev-parse', '--verify', revision + '^{commit}'], { encoding: 'utf8' }).trim();
  if (commit !== revision) throw new Error('Revize neoznačuje požadovaný commit.');
  const entries = new Map(git(root, ['ls-tree', '-r', '-z', revision], { encoding: 'utf8' }).split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const [mode, kind, oid] = line.slice(0, tab).split(' ');
    return [line.slice(tab + 1), { mode, kind, oid }];
  }));
  const selected = [...entries].filter(([name]) => sourcePath(name) || ['functions/package.json', 'packages/quiz-domain/package.json'].includes(name));
  if (selected.some(([, entry]) => entry.mode !== '100644' && entry.mode !== '100755')) throw new Error('Zdroj obsahuje odkaz nebo submodul.');
  const bytes = git(root, ['cat-file', '--batch'], { input: selected.map(([, entry]) => entry.oid).join('\n') + '\n' });
  const files = new Map();
  let offset = 0;
  for (const [name, entry] of selected) {
    const end = bytes.indexOf(10, offset);
    const [oid, kind, sizeText] = bytes.subarray(offset, end).toString('utf8').split(' ');
    const size = Number(sizeText);
    if (oid !== entry.oid || kind !== 'blob' || !Number.isSafeInteger(size) || size < 0) throw new Error('Nelze přečíst zdrojový Git objekt.');
    files.set(name, bytes.subarray(end + 1, end + 1 + size).toString('utf8'));
    offset = end + size + 2;
  }
  return { entries, files };
}

function graph(tree) {
  const nodes = new Map();
  const manifests = ['functions/package.json', 'packages/quiz-domain/package.json'].map(name => JSON.parse(tree.files.get(name) ?? '{}'));
  for (const manifest of manifests) for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.optionalDependencies })) {
    if (/^(?:workspace:|file:|link:)/u.test(version) && name !== '@filmovy-kviz/quiz-domain') throw new Error('Nezmapovaná lokální workspace závislost: ' + name);
  }
  const dependencies = new Set(Object.keys(manifests[0].dependencies ?? {}));
  function resolve(from, specifier) {
    if (specifier === '@filmovy-kviz/quiz-domain') {
      if (!tree.files.has(DOMAIN)) throw new Error('Chybí vstup quiz-domain.');
      return DOMAIN;
    }
    if (specifier.startsWith('@filmovy-kviz/quiz-domain/')) throw new Error('Neznámý podmodul quiz-domain: ' + specifier);
    if (!specifier.startsWith('.')) {
      const pkg = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      if (!isBuiltin(specifier) && !dependencies.has(pkg)) throw new Error('Neznámá externí závislost: ' + specifier);
      return null;
    }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
    const candidates = [target.replace(/\.js$/u, '.ts'), target.replace(/\.mjs$/u, '.mts'), target, target + '.ts', target + '/index.ts'];
    const found = candidates.find(candidate => tree.files.has(candidate));
    if (!found) throw new Error('Neurčitá lokální závislost: ' + from + ' → ' + specifier);
    return found;
  }
  function parse(name) {
    if (nodes.has(name)) return nodes.get(name);
    const text = tree.files.get(name);
    if (text === undefined) throw new Error('Chybí zdroj: ' + name);
    const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    if (file.parseDiagnostics.length) throw new Error('Nelze parsovat ' + name);
    const node = { file, deps: new Set(), runtimeDeps: new Set(), shared: [] };
    nodes.set(name, node);
    const staticUrls = new Map();
    function collectUrls(child) {
      if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer && ts.isNewExpression(child.initializer)
        && child.initializer.expression.getText(file) === 'URL' && child.initializer.arguments?.length === 2
        && ts.isStringLiteralLike(child.initializer.arguments[0]) && child.initializer.arguments[1].getText(file) === 'import.meta.url') {
        staticUrls.set(child.name.text, child.initializer.arguments[0].text);
      }
      ts.forEachChild(child, collectUrls);
    }
    collectUrls(file);
    function add(specifier, runtime = true) { const dep = resolve(name, specifier); if (dep) { node.deps.add(dep); if (runtime) node.runtimeDeps.add(dep); } }
    function walk(child) {
      if ((ts.isImportDeclaration(child) || ts.isExportDeclaration(child)) && child.moduleSpecifier) {
        if (!ts.isStringLiteralLike(child.moduleSpecifier)) throw new Error('Neurčitý import v ' + name);
        add(child.moduleSpecifier.text, ts.isImportDeclaration(child));
      }
      if (ts.isImportEqualsDeclaration(child)) throw new Error('Nepodporovaný import equals v ' + name);
      if (ts.isCallExpression(child) && (child.expression.kind === ts.SyntaxKind.ImportKeyword || child.expression.getText(file) === 'require' || child.expression.getText(file) === 'require.resolve')) {
        const arg = child.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) add(arg.text);
        else if (arg && ts.isPropertyAccessExpression(arg) && arg.name.text === 'href' && ts.isIdentifier(arg.expression)
          && staticUrls.get(arg.expression.text) === '../../worker/clip.mjs' && name === 'functions/src/drive/processor.ts') {
          // D2 worker is generated outside src; every runtime/packager change forces full below.
        } else throw new Error('Dynamická závislost v ' + name);
      }
      if ((ts.isCallExpression(child) || ts.isNewExpression(child)) && ['eval', 'Function'].includes(child.expression.getText(file))) throw new Error('Dynamický kód v ' + name);
      ts.forEachChild(child, walk);
    }
    walk(file);
    return node;
  }
  function exports(name, visiting = new Set()) {
    if (visiting.has(name)) throw new Error('Cyklický exportní barrel: ' + name);
    const next = new Set([...visiting, name]);
    const node = parse(name);
    const result = new Map();
    const put = (key, value) => { if (result.has(key)) throw new Error('Nejednoznačný export ' + key); result.set(key, value); };
    for (const statement of node.file.statements) {
      const text = statement.getText(node.file);
      if (ts.isExportAssignment(statement) || statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) throw new Error('Default nebo CommonJS export vyžaduje plný rozsah.');
      if (ts.isExportDeclaration(statement)) {
        if (statement.isTypeOnly) continue;
        const origin = statement.moduleSpecifier ? resolve(name, statement.moduleSpecifier.text) : name;
        if (!origin) throw new Error('Reexport externího balíčku.');
        if (!statement.exportClause) {
          for (const [key] of exports(origin, next)) if (key !== 'default') put(key, { origin, signature: text });
        } else if (ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) if (!element.isTypeOnly) put(element.name.text, { origin, signature: text });
        } else throw new Error('Namespace export vyžaduje plný rozsah.');
      } else if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) throw new Error('Destrukturovaný export.');
            put(declaration.name.text, { origin: name, signature: text });
          }
        } else if (statement.name && ts.isIdentifier(statement.name)) put(statement.name.text, { origin: name, signature: text });
        else throw new Error('Nepodporovaný export.');
      } else node.shared.push(text);
    }
    return result;
  }
  const rootExports = exports(ENTRY);
  function closure(origin) {
    const seen = new Set();
    function visit(name) {
      if (seen.has(name)) return;
      seen.add(name);
      const node = parse(name);
      for (const dep of node.deps) visit(dep);
    }
    if (origin !== ENTRY) visit(origin);
    // Local imports at the entrypoint can have initialization side effects for every export.
    for (const dep of parse(ENTRY).runtimeDeps) visit(dep);
    return seen;
  }
  return { rootExports, closure, shared: parse(ENTRY).shared.join('\n'), inline: [...rootExports.values()].filter(value => value.origin === ENTRY).map(value => value.signature).join('\n') };
}

/** Offline conservative impact analysis of immutable Git commits. functionNames excludes separately managed D2 exports. */
export function analyzeFunctionImpact({ root, baseline, target, functionNames } = {}) {
  let names = [...new Set(functionNames ?? [])].sort();
  const result = (mode, changed, removed, reasons) => ({ mode, changed, unchanged: names.filter(name => !changed.includes(name)), removed, reasons, baseline, target });
  try {
    const after = readTree(root, target);
    const afterGraph = graph(after);
    if (!functionNames) names = [...afterGraph.rootExports.keys()].sort();
    if (!baseline) return result('full', names, [], ['Původ živého backendu není doložen.']);
    const before = readTree(root, baseline);
    git(root, ['merge-base', '--is-ancestor', baseline, target]);
    const beforeGraph = graph(before);
    const changedFiles = new Set([...new Set([...before.entries.keys(), ...after.entries.keys()])].filter(name => before.entries.get(name)?.oid !== after.entries.get(name)?.oid || before.entries.get(name)?.mode !== after.entries.get(name)?.mode));
    const removed = [...beforeGraph.rootExports.keys()].filter(name => !afterGraph.rootExports.has(name) && (!functionNames || names.includes(name))).sort();
    if (removed.length) return result('full', names, removed, ['Odstraněné exporty vyžadují kontrolu úplného rozsahu.']);
    const build = [...changedFiles].filter(buildPath).sort();
    if (build.length) return result('full', names, [], ['Změna sestavení, závislostí nebo runtime souborů: ' + build.join(', ')]);
    if (beforeGraph.shared !== afterGraph.shared) return result('full', names, [], ['Změna společné inicializace vstupního modulu.']);
    const changed = [];
    for (const name of names) {
      const oldExport = beforeGraph.rootExports.get(name), newExport = afterGraph.rootExports.get(name);
      if (!newExport) throw new Error('Požadovaný export v cíli chybí: ' + name);
      const previousClosure = oldExport ? beforeGraph.closure(oldExport.origin) : [];
      const nextClosure = afterGraph.closure(newExport.origin);
      if (!oldExport || oldExport.origin !== newExport.origin || oldExport.signature !== newExport.signature
        || (newExport.origin === ENTRY && beforeGraph.inline !== afterGraph.inline)
        || [...previousClosure, ...nextClosure].some(file => changedFiles.has(file))) changed.push(name);
    }
    // Non-source payload in source directories cannot be mapped reliably to imports.
    const runtime = [...changedFiles].filter(name => /^(?:functions|packages\/quiz-domain)\/src\//u.test(name) && !sourcePath(name));
    if (runtime.length) return result('full', names, [], ['Neurčitý runtime soubor: ' + runtime.join(', ')]);
    if (names.length > 1 && changed.length === names.length) return result('full', names, [], ['Změna zasahuje všechny vybrané exporty včetně jejich společných závislostí.']);
    return result('partial', changed, [], []);
  } catch (error) {
    return result('full', names, [], ['Nelze bezpečně určit dopad: ' + error.message]);
  }
}
