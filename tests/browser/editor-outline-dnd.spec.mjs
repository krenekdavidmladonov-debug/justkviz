import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { mediaSlide } from '../e2e/media-fixture.mjs';

async function openRounds(page) { await expect(page.locator('.outline-round').first()).toBeVisible(); while (await page.locator('.outline-collapse[aria-expanded="false"]').count()) await page.locator('.outline-collapse[aria-expanded="false"]').first().click(); }

async function fixture(page) {
  const identity = await editorIdentity();
  const id = 'save-all-' + randomUUID(), root = identity.db.doc('quizzes/' + id);
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
  await page.goto('/admin/quizzes/' + id + '/edit'); await openRounds(page); await page.locator('.outline-question').nth(1).waitFor();
  return { identity, root };
}
const select = (page, index) => page.locator('.outline-question').nth(index).click();
const prompt = page => page.getByRole('textbox', { name: 'Otázka *', exact: true });
const save = page => page.getByRole('button', { name: 'Uložit vše', exact: true }).click();


async function secondRound(f) {
  const batch = f.identity.db.batch();
  for (const [i, key] of ['round2', 'c', 'd', 'recap2'].entries()) batch.set(f.root.collection('slides').doc(key), {
    ...mediaSlide(i === 1 || i === 2 ? 'free' : i === 0 ? 'round' : 'recap'), position: i + 5, roundId: 'round2', roundTitle: 'Druhé kolo',
    isQuestion: i === 1 || i === 2, title: i === 0 ? 'Druhé kolo' : '', text: key, correctAnswer: 'Private answer', authoringStatus: 'ready', answerMode: 'open'
  });
  batch.set(f.root.collection('rounds').doc('round2'), { title: 'Druhé kolo', position: 2, type: 'classic', questionCount: 2, slideCount: 4 });
  batch.update(f.root, { slideCount: 8, questionCount: 4, roundCount: 2 }); await batch.commit();
}


const row = (page, id) => page.locator('[data-question-id="' + id + '"]');
const order = page => page.locator('[data-question-id]').evaluateAll(nodes => nodes.map(node => node.dataset.questionId));
const handle = (page, id) => row(page, id).locator('.outline-drag-handle');
const question = (page, id) => row(page, id).locator('.outline-question');
async function dragAt(page, source, target, fraction) {
  const destination = row(page, target); await destination.scrollIntoViewIfNeeded();
  const box = await destination.boundingBox(); expect(box).not.toBeNull();
  await expect(handle(page, source)).toHaveAttribute('draggable','true');
  await handle(page, source).dragTo(destination, { targetPosition: { x: box.width / 2, y: box.height * fraction } });
}
const dragBefore = (page, source, target) => dragAt(page, source, target, 0.25);

test('scoped quiz copy opens after the access grant remounts its dialog @duplicate-quiz', async ({ page }) => {
  const f = await fixture(page);
  try {
    const { member } = await f.identity.call('getMyAccess', {});
    const membershipRef = f.identity.db.doc('memberships/' + member.uid);
    await membershipRef.update({ quizzes: { mode: 'selected', ids: [f.root.id] }, version: member.version + 1 });
    await page.goto('/admin/quizzes/' + f.root.id);
    await page.getByRole('button', { name: 'Duplikovat kvíz Společné ukládání' }).click();
    const dialog = page.getByRole('dialog', { name: 'Duplikovat kvíz' });
    await expect(dialog).toBeVisible();
    let submissions = 0;
    await page.route('**/duplicateQuiz', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      submissions++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await dialog.waitFor({ state: 'detached' });
      await route.fulfill({ response });
    });
    await dialog.getByRole('button', { name: 'Vytvořit kopii' }).click();
    await expect(page).toHaveURL(/\/admin\/quizzes\/quiz_[a-f0-9]{64}\/edit$/u);
    await openRounds(page);
    await expect(page.locator('.outline-question')).toHaveCount(2);
    const targetId = new URL(page.url()).pathname.split('/')[3];
    const granted = (await membershipRef.get()).data();
    expect([...granted.quizzes.ids].sort()).toEqual([f.root.id, targetId].sort());
    expect((await f.root.get()).data().revision).toBe(0);
    expect(submissions).toBe(1);
  } finally { await f.identity.dispose(); }
});

test('drag in left outline changes order and rounds without leaving the editor', async ({ page }) => {
  const f = await fixture(page);
  try {
    await secondRound(f); await page.setViewportSize({ width: 1600, height: 1200 }); await page.reload(); await openRounds(page);
    await expect(page.getByRole('button', { name:'Storyboard', exact:true })).toHaveCount(0);
    await select(page, 0); await expect(prompt(page)).toHaveValue('a');
    await dragAt(page,'a','b',0.75);
    await expect.poll(() => order(page)).toEqual(['b','a','c','d']);
    await expect(prompt(page)).toHaveValue('a');
    await dragBefore(page,'a','c');
    await expect.poll(() => order(page)).toEqual(['b','a','c','d']);
    await expect.poll(async () => (await f.root.collection('slides').doc('a').get()).data().roundId).toBe('round2');
    await expect.poll(async () => (await f.root.collection('slides').doc('a').get()).data().questionNumber).toBe(1);
    await expect(handle(page,'a')).toHaveAttribute('draggable','true');
    await question(page,'a').focus(); await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => order(page)).toEqual(['b','c','a','d']);
    await expect(question(page,'a')).toBeFocused();
    // The assertions above verify interaction without capturing private editor content.
  } finally { await f.identity.dispose(); }
});

test('unsaved content survives selection and prevents structural writes until saved', async ({ page }) => {
  const f = await fixture(page);
  try {
    await select(page,0); await prompt(page).fill('Unfinished edit'); await select(page,1);
    await expect(handle(page,'a')).toHaveAttribute('draggable','false');
    await select(page,0); await expect(prompt(page)).toHaveValue('Unfinished edit');
    expect((await f.root.get()).data().revision).toBe(0);
    await save(page); await expect(handle(page,'a')).toHaveAttribute('draggable','true');
  } finally { await f.identity.dispose(); }
});

test('standalone announcement can be dragged between questions and back between rounds', async ({ page }) => {
  const f = await fixture(page);
  try {
    await secondRound(f);
    const slides = f.root.collection('slides');
    const batch = f.identity.db.batch();
    for (const [index, kind] of ['info', 'thank-you', 'end'].entries()) {
      batch.set(slides.doc(kind), {
        ...mediaSlide(kind), position: 9 + index, isQuestion: false,
        title: kind === 'info' ? 'Testovací oznámení' : kind === 'thank-you' ? 'Poděkování' : 'Závěr',
        options: [], correctAnswer: '',
      });
    }
    batch.update(f.root, { slideCount: 11 });
    await batch.commit();
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.reload();
    const fullOrder = page.locator('.presentation-outline');
    const announcementRow = fullOrder.locator('[data-slide-id="info"]');
    const announcement = announcementRow.getByRole('button', { name: /Přetáhnout sdělení/ });
    const position = async () => (await slides.orderBy('position').get()).docs.map(doc => doc.id);
    const dragBeforeProgramRow = async id => {
      await expect(page.locator('.editor-outline')).toHaveAttribute('aria-busy', 'false');
      await expect(announcement).toHaveAttribute('draggable', 'true');
      const target = fullOrder.locator('[data-slide-id="' + id + '"]');
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      await announcement.dragTo(target, { targetPosition: { x: box.width / 2, y: box.height / 4 } });
    };
    await dragBeforeProgramRow('b');
    await expect.poll(position).toEqual(['round','a','info','b','recap','round2','c','d','recap2','thank-you','end']);
    expect((await slides.doc('info').get()).data().roundId).toBeUndefined();
    expect((await slides.doc('b').get()).data().questionNumber).toBe(2);
    await expect(announcementRow.locator('[aria-current="true"]')).toBeVisible();
    expect(await fullOrder.locator('[data-slide-id]').evaluateAll(rows => rows.map(row => row.dataset.slideId))).toEqual(await position());
    await dragBeforeProgramRow('round2');
    await expect.poll(position).toEqual(['round','a','b','recap','info','round2','c','d','recap2','thank-you','end']);
    await page.reload();
    await expect(fullOrder.locator('[data-slide-id]')).toHaveCount(11);
    const ids = await fullOrder.locator('[data-slide-id]').evaluateAll(rows => rows.map(row => row.dataset.slideId));
    expect(ids).toEqual(await position());
  } finally { await f.identity.dispose(); }
});

test('interrupted cross-round drag reloads persisted order and keeps the editor usable', async ({ page }) => {
  const f = await fixture(page); let failed = false;
  try {
    await secondRound(f); await page.setViewportSize({ width:1600,height:1200 }); await page.reload(); await openRounds(page);
    await page.route('**/reorderQuizQuestion', async route => {
      if (route.request().method() === 'POST' && !failed) { failed=true; return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{status:'UNAVAILABLE',message:'Synthetic interruption'}})}); }
      return route.continue();
    });
    await dragBefore(page,'a','c'); await expect(page.locator('.round-editor-error')).toContainText('Přesun nebyl dokončen');
    await expect.poll(() => order(page)).toEqual(['b','c','d','a']);
    await dragBefore(page,'a','c'); await expect.poll(() => order(page)).toEqual(['b','a','c','d']);
  } finally { await f.identity.dispose(); }
});
