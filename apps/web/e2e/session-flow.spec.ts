import { expect, test } from '@playwright/test';

// Flujo completo con proveedores simulados: crear sesión -> empezar sin audio -> inyectar
// una pregunta -> recibir respuesta -> terminar -> ver notas y transcripción.
test('crear sesión, recibir respuesta y terminar', async ({ page }) => {
  await page.goto('/sessions');
  await expect(page.getByRole('heading', { name: 'Call Sessions' })).toBeVisible();

  await page.goto('/sessions/new');
  await page.locator('input[name="company"]').fill('E2E Corp');
  await page.locator('input[name="title"]').fill('Prueba automática');
  await page.locator('select[name="model"]').selectOption('fake-fast');
  await page.getByRole('button', { name: /Guardar|Save/ }).click();

  await expect(page).toHaveURL(/\/sessions\/[^/]+\/live/);
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole('button', { name: /Empezar sin audio|Start without audio/ }).click();

  const debugInput = page.getByPlaceholder('¿Cómo manejas los plazos ajustados?');
  await expect(debugInput).toBeVisible();
  await expect(page.getByText(/Escuchando|Listening/)).toBeVisible();

  await debugInput.fill('Hola, ¿me escuchas bien?');
  await page
    .getByRole('button', { name: /Inyectar texto como 'Ellos'|Inject text as 'Them'/ })
    .click();
  await expect(page.getByText('Hola, ¿me escuchas bien?').first()).toBeVisible();

  await debugInput.fill('¿Cuánto tiempo tardarían en implementar el dashboard de ventas?');
  await page
    .getByRole('button', { name: /Inyectar texto como 'Ellos'|Inject text as 'Them'/ })
    .click();
  await expect(page.getByText('Respuesta:').first()).toBeVisible({ timeout: 30_000 });

  // Botón Answer manual y chat.
  await page.getByRole('button', { name: /⚡ Answer/ }).click();
  await page.getByPlaceholder(/Escribe un mensaje|Type a manual message/).fill('hazlo más corto');
  await page.getByRole('button', { name: /^Enviar$|^Send$/ }).click();
  await expect(page.getByText('hazlo más corto')).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Terminar|^End$/ }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/, { timeout: 30_000 });
  await expect(page.getByText('E2E Corp').first()).toBeVisible();

  // Las notas se generan en segundo plano: recargar hasta verlas.
  await expect
    .poll(
      async () => {
        await page.reload();
        return page
          .getByText(/Resumen|Summary/)
          .first()
          .isVisible();
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await page.getByRole('button', { name: /Transcripción|Transcript/ }).click();
  await expect(
    page.getByText('¿Cuánto tiempo tardarían en implementar el dashboard de ventas?').first(),
  ).toBeVisible();
});

test('la lista filtra por estado y busca', async ({ page }) => {
  await page.goto('/sessions?tab=ended');
  await expect(page.getByText(/Terminada|Ended/).first()).toBeVisible();
  await page.goto('/sessions?q=Nubank');
  await expect(page.getByText('Nubank').first()).toBeVisible();
  await expect(page.getByText('Rappi')).toHaveCount(0);
});
