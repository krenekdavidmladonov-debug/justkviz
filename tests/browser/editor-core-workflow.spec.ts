import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const importedQuizPath = '/admin/quizzes/editor-core-imported-e2e/edit';

async function restrictToLocalhost(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      await route.continue();
      return;
    }
    await route.abort();
  });
}

async function login(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('E-mail').fill('admin@example.test');
  await page.getByLabel('Heslo').fill('LocalQuiz123!');
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/admin$/u);
}

async function waitForCallable(page: Page, callableName: string, action: () => Promise<void>): Promise<void> {
  const response = page.waitForResponse((candidate) => (
    candidate.request().method() === 'POST' && candidate.url().endsWith(`/europe-west1/${callableName}`)
  ));
  await Promise.all([response, action()]);
}

async function selectOnlyQuestion(page: Page): Promise<ReturnType<Page['getByLabel']>> {
  await expect(page.locator('.round-first-editor')).toBeVisible();
  await expect(page.locator('.outline-round').first()).toBeVisible();
  while (await page.locator('.outline-collapse[aria-expanded="false"]').count()) {
    await page.locator('.outline-collapse[aria-expanded="false"]').first().click();
  }
  await expect(page.locator('.outline-question')).toHaveCount(1);
  await page.locator('.outline-question').click();
  const prompt = page.getByLabel('Otázka *');
  await expect(prompt).toBeVisible();
  return prompt;
}

test.describe.configure({ mode: 'serial' });

test('empty library exposes the new-quiz CTA @empty-library', async ({ browser }) => {
  const context = await browser.newContext();
  await restrictToLocalhost(context);
  const page = await context.newPage();
  try {
    await login(page);
    await page.goto('/admin/quizzes');
    const emptyState = page.locator('.quiz-state-card');
    await expect(emptyState.getByRole('heading', { name: 'Zatím tu nejsou žádné kvízy' })).toBeVisible();
    await expect(emptyState.getByRole('link', { name: '+ Nový kvíz' })).toBeVisible();
    await emptyState.getByRole('link', { name: '+ Nový kvíz' }).click();
    await expect(page).toHaveURL(/\/admin\/quizzes\/new$/u);
    await expect(page.getByRole('heading', { name: 'Nový kvíz' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('imported slide survives two saves and reports a stale revision without losing the draft @seeded', async ({ browser }) => {
  const context = await browser.newContext();
  await restrictToLocalhost(context);
  const primary = await context.newPage();
  try {
    await login(primary);
    await primary.goto(importedQuizPath);
    let prompt = await selectOnlyQuestion(primary);
    await expect(prompt).toHaveValue('Původní syntetické zadání');

    const firstSavedText = 'První uložená změna importovaného zadání';
    await prompt.fill(firstSavedText);
    await waitForCallable(primary, 'updateQuizSlide', () => primary.getByRole('button', { name: 'Uložit vše', exact: true }).click());
    await expect(primary.locator('.save-state')).toHaveText('Uloženo');
    await primary.reload();
    prompt = await selectOnlyQuestion(primary);
    await expect(prompt).toHaveValue(firstSavedText);

    const secondSavedText = 'Druhá uložená změna importovaného zadání';
    await prompt.fill(secondSavedText);
    await waitForCallable(primary, 'updateQuizSlide', () => primary.getByRole('button', { name: 'Uložit vše', exact: true }).click());
    await expect(primary.locator('.save-state')).toHaveText('Uloženo');
    await primary.reload();
    prompt = await selectOnlyQuestion(primary);
    await expect(prompt).toHaveValue(secondSavedText);

    const competing = await context.newPage();
    await competing.goto(importedQuizPath);
    const competingPrompt = await selectOnlyQuestion(competing);
    await expect(competingPrompt).toHaveValue(secondSavedText);

    const winningText = 'Uložená změna z prvního editoru';
    const preservedDraft = 'Rozepsaná změna ze zastaralého editoru';
    await prompt.fill(winningText);
    await competingPrompt.fill(preservedDraft);
    await waitForCallable(primary, 'updateQuizSlide', () => primary.getByRole('button', { name: 'Uložit vše', exact: true }).click());
    await expect(primary.locator('.save-state')).toHaveText('Uloženo');

    await waitForCallable(competing, 'updateQuizSlide', () => competing.getByRole('button', { name: 'Uložit vše', exact: true }).click());
    await expect(competing.locator('.save-state')).toHaveText('Uložení se nezdařilo');
    const error = competing.locator('.round-editor-error');
    await expect(error).toContainText('Kvíz mezitím upravil někdo jiný.');
    await expect(error).toContainText('EDITOR_SAVE_FAILED');
    await expect(competingPrompt).toHaveValue(preservedDraft);
    await competing.close();
  } finally {
    await context.close();
  }
});

test('library CTA creates an empty quiz and carries its first round and free question through reopen @seeded', async ({ browser }) => {
  const context = await browser.newContext();
  await restrictToLocalhost(context);
  const page = await context.newPage();
  const title = `Syntetický nový kvíz ${Date.now()}`;
  const question = 'Která odpověď potvrzuje nový editorový tok?';
  const answer = 'Lokální syntetická odpověď';
  try {
    await login(page);
    await page.goto('/admin/quizzes');
    const libraryHeader = page.locator('.section-heading');
    await expect(libraryHeader.getByRole('link', { name: '+ Nový kvíz' })).toBeVisible();
    await libraryHeader.getByRole('link', { name: '+ Nový kvíz' }).click();

    await page.getByLabel('Název kvízu').fill(title);
    await waitForCallable(page, 'createQuiz', () => page.getByRole('button', { name: 'Vytvořit', exact: true }).click());
    await expect(page).toHaveURL(/\/admin\/quizzes\/quiz_[a-f0-9]+\/edit$/u);
    await expect(page.locator('.editor-empty-preview')).toContainText('Zatím není co promítnout');
    await expect(page.locator('.outline-round')).toHaveCount(0);

    await waitForCallable(page, 'createQuizRound', () => page.getByRole('button', { name: '+ Přidat kolo' }).click());
    await expect(page.locator('.outline-round')).toHaveCount(1);
    await page.getByRole('button', { name: '+ Přidat otázku' }).click();
    await page.getByLabel('Otázka *').fill(question);
    await page.getByLabel('Správná odpověď *').fill(answer);
    await waitForCallable(page, 'createQuizSlide', () => page.getByRole('button', { name: 'Uložit vše', exact: true }).click());
    await expect(page.locator('.save-state')).toHaveText('Uloženo');

    await page.getByRole('link', { name: '← Knihovna kvízů' }).click();
    await page.getByRole('link', { name: title, exact: true }).click();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '← Zpět do knihovny' }).click();
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
    await page.getByRole('link', { name: title, exact: true }).click();
    await page.getByRole('link', { name: 'Otevřít editor' }).click();
    await expect(page.locator('.outline-round').first()).toBeVisible();
    while (await page.locator('.outline-collapse[aria-expanded="false"]').count()) await page.locator('.outline-collapse[aria-expanded="false"]').first().click();
    await page.locator('.outline-question').filter({ hasText: question }).click();
    await expect(page.getByLabel('Otázka *')).toHaveValue(question);
    await expect(page.getByLabel('Správná odpověď *')).toHaveValue(answer);
  } finally {
    await context.close();
  }
});

test('lost quiz creation restores the same attempt on reload and permits a deliberate new attempt after library check @seeded', async ({ browser }) => {
  const context = await browser.newContext();
  await restrictToLocalhost(context);
  const page = await context.newPage();
  const title = `Synthetic creation recovery ${Date.now()}`;
  const requests: { title: string; requestId: string }[] = [];
  const committedIds: string[] = [];
  let loseNext = true;
  await page.route('**/europe-west1/createQuiz', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    const payload = route.request().postDataJSON() as { data: { title: string; requestId: string } };
    requests.push(payload.data);
    const response = await route.fetch();
    const body = await response.json() as { result: { quizId: string } };
    committedIds.push(body.result.quizId);
    if (loseNext) { loseNext = false; await route.abort('failed'); }
    else await route.fulfill({ response });
  });
  try {
    await login(page);
    const legacyId = `legacy-creation-${Date.now()}`;
    await page.evaluate(id => sessionStorage.setItem('justkviz.quiz-create-request-id', id), legacyId);
    await page.goto('/admin/quizzes/new');
    await page.getByLabel('Název kvízu').fill(title);
    await page.getByRole('button', { name: 'Vytvořit', exact: true }).click();
    await expect(page.getByText('Kvíz se nepodařilo vytvořit. Zadaný název zůstal zachovaný.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Název kvízu')).toHaveValue(title);
    await expect(page.getByLabel('Název kvízu')).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Začít nový pokus', exact: true })).toBeDisabled();
    await waitForCallable(page, 'createQuiz', () => page.getByRole('button', { name: 'Zkusit znovu', exact: true }).click());
    await expect(page).toHaveURL(new RegExp(`/admin/quizzes/${committedIds[0]}/edit$`));
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]?.requestId).toBe(legacyId);
    expect(await page.evaluate(() => sessionStorage.getItem('justkviz.quiz-create-request-id'))).toBeNull();
    expect(committedIds[1]).toBe(committedIds[0]);
    await page.getByRole('link', { name: '← Knihovna kvízů' }).click();
    await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(1);

    await page.goto('/admin/quizzes/new');
    loseNext = true;
    await page.getByLabel('Název kvízu').fill(title + ' second');
    await page.getByRole('button', { name: 'Vytvořit', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Zkusit znovu', exact: true })).toBeEnabled();
    await page.getByRole('link', { name: 'zkontrolujte knihovnu kvízů', exact: true }).click();
    await expect(page.getByRole('link', { name: title + ' second', exact: true })).toHaveCount(1);
    await page.goto('/admin/quizzes/new');
    await expect(page.getByLabel('Název kvízu')).toHaveValue(title + ' second');
    await page.getByRole('checkbox', { name: 'Zkontroloval(a) jsem knihovnu a chci začít nový pokus.' }).check();
    await page.getByRole('button', { name: 'Začít nový pokus', exact: true }).click();
    await page.getByLabel('Název kvízu').fill(title + ' third');
    await waitForCallable(page, 'createQuiz', () => page.getByRole('button', { name: 'Vytvořit', exact: true }).click());
    await expect(page).toHaveURL(/\/edit$/u);
    expect(requests).toHaveLength(4);
    expect(requests[2]).toBeDefined();
    expect(requests[3]).toBeDefined();
    expect(requests[3]?.requestId).not.toBe(requests[2]?.requestId);
    expect(new Set(committedIds).size).toBe(3);
  } finally { await context.close(); }
});
