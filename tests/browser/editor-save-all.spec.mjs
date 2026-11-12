import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { mediaSlide } from '../e2e/media-fixture.mjs';

async function fixture(page) {
  const identity = await editorIdentity();
  const id = 'save-all-' + randomUUID(), root = identity.db.doc('quizzes/' + id);
  try {
  const batch = identity.db.batch();
  batch.set(root, { title: 'Společné ukládání', description: '', status: 'draft', revision: 0, slideCount: 4, roundCount: 1, questionCount: 2,
    createdAt: new Date(), updatedAt: new Date(), createdBy: 'synthetic', updatedBy: 'synthetic' });
  batch.set(root.collection('rounds').doc('round'), { title: 'Kolo', position: 1, type: 'classic', questionCount: 2, slideCount: 4 });
  for (const [i, key] of ['round', 'a', 'b', 'recap'].entries()) {
    const question = key === 'a' || key === 'b';
    batch.set(root.collection('slides').doc(key), { ...mediaSlide(question ? 'free' : key), position: i + 1,
      roundId: 'round', roundTitle: 'Kolo', isQuestion: question, title: question ? '' : 'Kolo',
      ...(question ? { text: key, correctAnswer: 'Odpověď', authoringStatus: 'ready', answerMode: 'open' } : {}) });
    if (question) batch.set(root.collection('rounds').doc('round').collection('questions').doc(key), { prompt: key, type: 'text', position: i });
  }
  await batch.commit();
  await page.context().route('**/*', r => ['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
  await page.goto('/admin/login'); await page.getByLabel('E-mail').fill(identity.email); await page.getByLabel('Heslo').fill(identity.password);
  await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await page.locator('.admin-dashboard').waitFor();
  await page.goto('/admin/quizzes/' + id + '/edit'); await page.getByRole('button', {name:'Rozbalit kolo Kolo', exact:true}).click(); await page.locator('.outline-question').nth(1).waitFor();
  const dispose = identity.dispose; identity.dispose = async () => { await identity.db.recursiveDelete(root); await dispose(); };
  return { identity, root };
  } catch (error) { await identity.db.recursiveDelete(root); await identity.dispose(); throw error; }
}
const select = async (page, index) => { await page.locator('.outline-round').first().waitFor(); while (await page.locator('.outline-collapse[aria-expanded=false]').count()) await page.locator('.outline-collapse[aria-expanded=false]').first().click(); await page.locator('.outline-question').nth(index).click(); };
const prompt = page => page.getByRole('textbox', { name: 'Otázka *', exact: true });
const save = page => page.getByRole('button', { name: 'Uložit vše', exact: true }).click();

test('multiple questions retain work during navigation; Ctrl+S saves both and leaving offers discard', async ({ page }) => {
  const f = await fixture(page);
  try {
    await select(page, 0); await prompt(page).fill('a edited'); await select(page, 1); await prompt(page).fill('b edited');
    await select(page, 0); await expect(prompt(page)).toHaveValue('a edited'); await expect(page.getByRole('dialog')).toHaveCount(0);

    expect((await f.root.collection('slides').doc('a').get()).data().text).toBe('a');
    await page.keyboard.press('Control+s'); await expect(page.locator('.save-state')).toHaveText('Uloženo');
    expect((await f.root.collection('slides').doc('a').get()).data().text).toBe('a edited');
    expect((await f.root.collection('slides').doc('b').get()).data().text).toBe('b edited');
    await prompt(page).fill('unsaved'); await select(page, 1); await page.getByRole('link', { name: '← Knihovna kvízů' }).click();
    await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Zrušit', exact: true }).click();
    await select(page, 0); await expect(prompt(page)).toHaveValue('unsaved');
    await page.getByRole('link', { name: '← Knihovna kvízů' }).click(); await page.getByRole('button', { name: 'Pokračovat bez uložení' }).click();
    await expect(page).toHaveURL(/\/admin\/quizzes$/); expect((await f.root.collection('slides').doc('a').get()).data().text).toBe('a edited');
  } finally { await f.identity.dispose(); }
});

test('failure after one acknowledged write preserves the other draft and retry sends only that draft', async ({ page }) => {
  const f = await fixture(page), requests = []; let failed = false;
  try {
    await select(page, 0); await prompt(page).fill('a edited'); await select(page, 1); await prompt(page).fill('b edited');
    await page.route('**/updateQuizSlide', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const id = route.request().postDataJSON().data.slideId; requests.push(id);
      if (id === 'b' && !failed) { failed = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'Synthetic failure' } }) }); }
      return route.continue();
    });
    await save(page); await expect(page.locator('.save-state')).toHaveText('Uložení se nezdařilo');
    await expect(page.locator('.round-editor-error')).toContainText('Část změn je uložená'); await expect(prompt(page)).toHaveValue('b edited');
    expect((await f.root.get()).data().revision).toBe(1);
    await save(page); await expect(page.locator('.save-state')).toHaveText('Uloženo'); expect(requests).toEqual(['a','b','b']);
    expect((await f.root.get()).data().revision).toBe(2);
    await page.reload(); await select(page, 0); await expect(prompt(page)).toHaveValue('a edited');
    await select(page, 1); await expect(prompt(page)).toHaveValue('b edited');
  } finally { await f.identity.dispose(); }
});

test('lost response leaves the draft and cannot overwrite a newer revision on retry', async ({ page }) => {
  const f = await fixture(page); let lost = false;
  try {
    await select(page, 0); await prompt(page).fill('committed without response');
    await page.route('**/updateQuizSlide', async route => {
      if (route.request().method() === 'POST' && !lost) { lost = true; await route.fetch(); return route.abort(); }
      return route.continue();
    });
    await save(page); await expect(page.locator('.save-state')).toHaveText('Uložení se nezdařilo');
    expect((await f.root.get()).data().revision).toBe(1);
    await prompt(page).fill('must not overwrite'); await save(page);
    await expect(page.locator('.round-editor-error')).toContainText('Kvíz mezitím upravil někdo jiný');
    await expect(prompt(page)).toHaveValue('must not overwrite'); expect((await f.root.get()).data().revision).toBe(1);
    expect((await f.root.collection('slides').doc('a').get()).data().text).toBe('committed without response');
  } finally { await f.identity.dispose(); }
});

test('confirmed conflict reload locks editing, saving and selection until authoritative data arrives', async ({ page }) => {
  const f = await fixture(page);
  let releaseReload;
  const held = new Promise(resolve => { releaseReload = resolve; });
  let responseReady = false;
  try {
    await select(page, 0); await prompt(page).fill('Local work to discard');
    const batch = f.identity.db.batch();
    batch.update(f.root, { revision: 1, title: 'Authoritative quiz' });
    batch.update(f.root.collection('slides').doc('a'), { text: 'Authoritative question' });
    await batch.commit();
    await save(page); await expect(page.locator('.save-state')).toHaveText('Uložení se nezdařilo');
    await expect(page.locator('.round-editor-error')).toContainText('Kvíz mezitím upravil někdo jiný');
    await page.route('**/readAccessData', async route => {
      if (route.request().method() !== 'POST' || route.request().postDataJSON().data.operation !== 'editor') return route.continue();
      const response = await route.fetch();
      responseReady = true;
      await held;
      await route.fulfill({ response });
    });
    const reloadButton = page.getByRole('button', { name: 'Zahodit rozepsané změny a načíst aktuální verzi', exact: true });
    page.once('dialog', dialog => dialog.accept());
    await reloadButton.click();
    await expect.poll(() => responseReady).toBe(true);
    await expect(prompt(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Uložit vše', exact: true })).toBeDisabled();
    await expect(reloadButton).toBeDisabled();
    await select(page, 1);
    await expect(prompt(page)).toHaveValue('Local work to discard');
    releaseReload();
    await expect(page.getByLabel('Název kvízu *', { exact: true })).toHaveValue('Authoritative quiz');
    await expect(page.locator('.save-state')).toHaveText('Uloženo');
    await select(page, 0);
    await expect(prompt(page)).toBeEnabled();
    await expect(prompt(page)).toHaveValue('Authoritative question');
    await prompt(page).fill('New work after reload');
    await save(page); await expect(page.locator('.save-state')).toHaveText('Uloženo');
    expect((await f.root.collection('slides').doc('a').get()).data().text).toBe('New work after reload');
    expect((await f.root.get()).data().revision).toBe(2);
  } finally { releaseReload(); await f.identity.dispose(); }
});

test('failed authoritative reload preserves drafts, unlocks navigation and permits an explicit successful retry', async ({ page }) => {
  const f = await fixture(page);
  let editorReads = 0, writesAfterConflict = 0;
  try {
    await select(page, 0); await prompt(page).fill('Question draft kept after failed reload');
    await page.getByRole('button', { name: 'Název a nastavení kvízu', exact: true }).click();
    await page.getByLabel('Název kvízu *', { exact: true }).fill('Metadata draft kept after failed reload');
    await select(page, 0);
    const batch = f.identity.db.batch();
    batch.update(f.root, { revision: 1, title: 'Authoritative title after retry' });
    batch.update(f.root.collection('slides').doc('a'), { text: 'Authoritative question after retry' });
    await batch.commit();
    await save(page); await expect(page.locator('.round-editor-error')).toContainText('Kvíz mezitím upravil někdo jiný');
    await page.route('**/updateQuizSlide', route => {
      if (route.request().method() === 'POST') writesAfterConflict++;
      return route.continue();
    });
    await page.route('**/updateQuizMetadata', route => {
      if (route.request().method() === 'POST') writesAfterConflict++;
      return route.continue();
    });
    await page.route('**/readAccessData', route => {
      if (route.request().method() !== 'POST' || route.request().postDataJSON().data.operation !== 'editor') return route.continue();
      editorReads++;
      if (editorReads === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'Synthetic authoritative read failure' } }) });
      return route.continue();
    });
    const reloadButton = page.getByRole('button', { name: 'Zahodit rozepsané změny a načíst aktuální verzi', exact: true });
    page.once('dialog', dialog => dialog.accept()); await reloadButton.click();
    await expect.poll(() => editorReads).toBe(1);
    await expect(page.locator('.save-state')).toHaveText('Uložení se nezdařilo');
    await expect(reloadButton).toBeEnabled();
    await expect(prompt(page)).toBeEnabled();
    await expect(prompt(page)).toHaveValue('Question draft kept after failed reload');
    await expect(page.getByRole('button', { name: 'Uložit vše', exact: true })).toBeEnabled();
    await select(page, 1); await expect(prompt(page)).toHaveValue('b');
    await select(page, 0); await expect(prompt(page)).toHaveValue('Question draft kept after failed reload');
    await page.getByRole('button', { name: 'Název a nastavení kvízu', exact: true }).click();
    await expect(page.getByLabel('Název kvízu *', { exact: true })).toHaveValue('Metadata draft kept after failed reload');
    expect(writesAfterConflict).toBe(0);
    expect((await f.root.get()).data().revision).toBe(1);
    page.once('dialog', dialog => dialog.accept()); await reloadButton.click();
    await expect(page.locator('.save-state')).toHaveText('Uloženo');
    await expect(page.getByLabel('Název kvízu *', { exact: true })).toHaveValue('Authoritative title after retry');
    await select(page, 0); await expect(prompt(page)).toBeEnabled();
    await expect(prompt(page)).toHaveValue('Authoritative question after retry');
    expect(editorReads).toBe(2); expect(writesAfterConflict).toBe(0);
    expect((await f.root.get()).data().revision).toBe(1);
  } finally { await f.identity.dispose(); }
});

test('quiz metadata and round title survive selection, and invalid inactive content prevents all writes', async ({ page }) => {
  const f = await fixture(page);
  try {
    await select(page, 0); await prompt(page).fill(''); await select(page, 1); await prompt(page).fill('b edited');
    await save(page); await expect(page.locator('.round-editor-error')).toContainText('Před uložením');
    expect((await f.root.get()).data().revision).toBe(0); await expect(prompt(page)).toHaveValue('');
    await prompt(page).fill('a repaired'); await select(page, 1); await expect(prompt(page)).toHaveValue('b edited');
    await page.getByRole('button', { name: 'Název a nastavení kvízu', exact: true }).click();
    await page.getByLabel('Název kvízu *', { exact: true }).fill('Nový název');
    await page.locator('.outline-round-select').click();
    await page.getByLabel('Název kola *', { exact: true }).fill('Nové kolo');
    await select(page, 0); await save(page); await expect(page.locator('.save-state')).toHaveText('Uloženo');
    expect((await f.root.get()).data().title).toBe('Nový název');
    expect((await f.root.collection('rounds').doc('round').get()).data().title).toBe('Nové kolo');
    expect((await f.root.collection('slides').doc('b').get()).data().text).toBe('b edited');
  } finally { await f.identity.dispose(); }
});

test('discarding a new question from the header removes the temporary draft', async ({ page }) => {
  const f = await fixture(page);
  try {
    await page.getByRole('button', { name: '+ Přidat otázku', exact: true }).click();
    await prompt(page).fill('Temporary question');
    await page.getByRole('button', { name: 'Zahodit změny…', exact: true }).click();
    await page.getByRole('button', { name: 'Pokračovat bez uložení' }).click();
    await expect(page.getByRole('button', { name: 'Zrušit novou otázku' })).toHaveCount(0);
    await expect(page.locator('.save-state')).toHaveText('Uloženo');
    await select(page, 0); await prompt(page).fill('Only existing question');
    await save(page); await expect(page.locator('.save-state')).toHaveText('Uloženo');
    expect((await f.root.get()).data().slideCount).toBe(4);
    expect((await f.root.collection('slides').doc('a').get()).data().text).toBe('Only existing question');
  } finally { await f.identity.dispose(); }
});
