import { expect, test, type Page } from '@playwright/test';

/** Collects console errors/warnings and uncaught exceptions; tests assert it stays empty. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function openMenu(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'HOOPLINE' })).toBeVisible();
}

test('boots to the main menu with SEO metadata and no console problems', async ({ page }) => {
  const problems = watchConsole(page);
  await openMenu(page);
  await expect(page).toHaveTitle(/Hoopline/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /baloncesto/i);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Jugar/ })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(problems).toEqual([]);
});

test('navigates every menu screen and back', async ({ page }) => {
  const problems = watchConsole(page);
  await openMenu(page);
  for (const [item, title] of [
    [/Jugadores/, 'Jugadores'],
    [/Equipos/, 'Equipos'],
    [/Ajustes/, 'Ajustes'],
    [/Mi jugador/, 'Mi jugador'],
  ] as const) {
    await page.getByRole('button', { name: item }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page.getByRole('heading', { name: 'HOOPLINE' })).toBeVisible();
  }
  expect(problems).toEqual([]);
});

test('creates My Player, plays a full 1v1 and earns progression', async ({ page }) => {
  const problems = watchConsole(page);
  await openMenu(page);
  await page.getByRole('button', { name: /Mi jugador/ }).click();
  await page.getByRole('textbox', { name: 'Nombre' }).fill('Tester <b>');
  await page.getByRole('radio', { name: /Francotirador/ }).click();
  await page.getByRole('button', { name: 'Crear jugador' }).click();
  await expect(page.getByRole('heading', { name: 'Tester b' })).toBeVisible();
  await page.getByRole('button', { name: 'Volver' }).click();

  await page.getByRole('button', { name: /Jugar/ }).click();
  await page.getByRole('radio', { name: /1 contra 1/ }).click();
  await page.getByRole('switch', { name: /mi jugador/i }).check();
  await page.getByRole('button', { name: 'Empezar' }).click();
  await expect(page.locator('.scoreboard')).toBeVisible();

  // Debug overlay (backquote) → play the rest of the match instantly.
  await page.keyboard.press('Backquote');
  await page.getByRole('button', { name: 'Simular hasta el final' }).click();
  await expect(page.locator('.result-banner')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.box-score tbody tr')).toHaveCount(2);
  await expect(page.locator('.xp-gain')).toContainText('PX');

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('button', { name: /Mi jugador/ })).toContainText('Tester b');
  await page.getByRole('button', { name: /Mi jugador/ }).click();
  await expect(page.getByText(/Carrera: 1 partidos/)).toBeVisible();
  expect(problems).toEqual([]);
});

test('practice: holding shoot shows the timing meter and releasing gives feedback', async ({ page }) => {
  const problems = watchConsole(page);
  await openMenu(page);
  await page.getByRole('button', { name: /Práctica/ }).click();
  await expect(page.locator('.hud[data-phase="live"]')).toBeAttached();
  const shoot = page.locator('.action-shoot');
  await expect(shoot).toBeVisible();
  const box = (await shoot.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // Real touch input through the browser's touch → pointer event pipeline.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await expect(page.locator('.shot-meter')).toBeVisible();
  await page.waitForTimeout(450);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.toast-main').first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('pause menu resumes and quits to the menu', async ({ page }) => {
  const problems = watchConsole(page);
  await openMenu(page);
  await page.getByRole('button', { name: /Jugar/ }).click();
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('button', { name: 'Pausa' }).click();
  await expect(page.getByRole('dialog', { name: 'Pausa' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('dialog', { name: 'Pausa' })).toBeHidden();
  await page.getByRole('button', { name: 'Pausa' }).click();
  await page.getByRole('button', { name: 'Salir al menú' }).click();
  await expect(page.getByRole('heading', { name: 'HOOPLINE' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('settings persist across reloads (language and quality)', async ({ page }) => {
  const problems = watchConsole(page);
  await openMenu(page);
  await page.getByRole('button', { name: /Ajustes/ }).click();
  await page.getByRole('radio', { name: 'Baja' }).click();
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Play\b/ })).toBeVisible();
  await page.getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true');
  expect(problems).toEqual([]);
});

test('portrait phones get a rotate prompt during matches', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await openMenu(page);
  await page.getByRole('button', { name: /Jugar/ }).click();
  await page.getByRole('button', { name: 'Empezar' }).click();
  await expect(page.locator('.rotate-hint')).toBeVisible();
});
