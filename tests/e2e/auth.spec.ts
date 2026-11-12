import { expect, test, type Page } from "@playwright/test";

/** Autenticación real de la app contra un DOBLE de Supabase Auth + PostgreSQL real con RLS. */
const PW = "Contrasena-Segura-1";

async function login(page: Page, email: string, password = PW) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  if (password === PW) await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("autenticación y aislamiento", () => {
  test("rutas protegidas redirigen a login; credenciales incorrectas muestran error genérico", async ({ page }) => {
    await page.goto("/app/empresa-alfa/resumen");
    await expect(page).toHaveURL(/\/login\?next=/);
    await login(page, "ana@empresa-a.test", "incorrecta");
    await expect(page.getByText("Correo o contraseña incorrectos.")).toBeVisible();
  });

  test("Ana ve solo la Empresa Alfa y no puede abrir ni exportar la Empresa Beta", async ({ page }) => {
    await login(page, "ana@empresa-a.test");
    await expect(page).toHaveURL(/\/app\/empresa-alfa\/resumen/);
    await expect(page.getByRole("cell", { name: "Alfa Ads", exact: true })).toBeVisible();
    await expect(page.getByText("Beta Ads")).toHaveCount(0);
    await page.goto("/app/empresa-beta/resumen");
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
    const own = await page.request.get("/app/empresa-alfa/exportar?kind=campaigns&preset=last_28");
    expect(own.status()).toBe(200);
    const csv = await own.text();
    expect(csv).toContain("Alfa Ads");
    expect(csv).not.toContain("Beta");
    const other = await page.request.get("/app/empresa-beta/exportar?kind=campaigns");
    expect(other.status()).toBe(403);
    // Cierre de sesión
    await page.goto("/app/empresa-alfa/resumen");
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("un lector no administra ni exporta", async ({ page }) => {
    await login(page, "pedro@empresa-a.test");
    await expect(page).toHaveURL(/empresa-alfa\/resumen/);
    await expect(page.getByRole("navigation", { name: "Navegación principal" }).getByText("Configuración")).toHaveAttribute("aria-disabled", "true");
    await page.goto("/app/empresa-alfa/configuracion");
    await expect(page.getByRole("heading", { name: "Permisos insuficientes" })).toBeVisible();
    expect((await page.request.get("/app/empresa-alfa/exportar?kind=campaigns")).status()).toBe(403);
  });

  test("usuario en dos empresas puede cambiar entre ellas", async ({ page }) => {
    await login(page, "sofia@ambas.test");
    await expect(page.getByRole("heading", { name: "Tus empresas" })).toBeVisible();
    await page.getByRole("link", { name: /Empresa Beta/ }).click();
    await expect(page.getByRole("cell", { name: "Beta Ads", exact: true })).toBeVisible();
    await page.getByLabel("Cambiar de empresa").click();
    await page.getByRole("link", { name: "Empresa Alfa" }).click();
    await expect(page.getByRole("cell", { name: "Alfa Ads", exact: true })).toBeVisible();
  });

  test("invitación: el administrador invita (sin SMTP, enlace manual) y la persona crea su cuenta", async ({ page, browser }) => {
    await login(page, "ana@empresa-a.test");
    await page.goto("/app/empresa-alfa/equipo");
    const email = `nueva-${Date.now()}@empresa-a.test`;
    await page.getByLabel("Correo", { exact: true }).fill(email);
    await page.getByLabel("Rol", { exact: true }).selectOption("analyst");
    await page.getByRole("button", { name: "Crear invitación" }).click();
    await expect(page.getByText(/No se envió correo/)).toBeVisible();
    const link = await page.locator("#action-detail").inputValue();
    expect(link).toMatch(/\/invitacion\//);

    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto(link);
    await expect(p2.getByText(/Te invitaron a/)).toContainText("Empresa Alfa");
    await p2.getByLabel("Nombre completo").fill("Nueva Persona");
    await p2.getByLabel("Contraseña", { exact: true }).fill("Otra-Contrasena-9");
    await p2.getByLabel("Confirmar contraseña").fill("Otra-Contrasena-9");
    await p2.getByRole("button", { name: "Crear cuenta y aceptar" }).click();
    await expect(p2).toHaveURL(/empresa-alfa\/resumen/);
    await expect(p2.getByText("Analista").first()).toBeVisible();
    // La invitación es de un solo uso.
    await p2.goto(link);
    await expect(p2.getByText("Esta invitación ya fue utilizada.")).toBeVisible();
    await ctx.close();
  });

  test("platform admin: administra empresas, sin ver reportes salvo con acceso de soporte auditado", async ({ page }) => {
    await login(page, "root@plataforma.test");
    await page.goto("/admin/empresas");
    await expect(page.getByRole("heading", { name: /Empresa Alfa/ })).toBeVisible();
    await page.goto("/app/empresa-alfa/resumen");
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
    await page.goto("/admin/empresas");
    const card = page.locator("section").filter({ hasText: "/empresa-alfa" });
    await card.getByPlaceholder("Motivo (p. ej. ticket #123)").fill("Revisión solicitada en ticket 42");
    await card.getByRole("button", { name: "Iniciar acceso de soporte" }).click();
    await expect(page).toHaveURL(/empresa-alfa\/resumen/);
    await expect(page.getByText(/Acceso de soporte temporal y auditado/)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Alfa Ads", exact: true })).toBeVisible();
  });

  test("un usuario normal no accede a la administración de plataforma", async ({ page }) => {
    await login(page, "luis@empresa-b.test");
    await page.goto("/admin/empresas");
    await expect(page.getByRole("heading", { name: "Página no encontrada" })).toBeVisible();
  });

  test("recuperación de contraseña responde sin revelar si la cuenta existe", async ({ page }) => {
    await page.goto("/recuperar");
    await page.getByLabel("Correo electrónico").fill("nadie@ejemplo.test");
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByRole("status")).toContainText("Si existe una cuenta con ese correo");
  });

  test("el endpoint programado exige secreto", async ({ request }) => {
    expect((await request.post("/api/cron/sync")).status()).toBe(401);
    expect((await request.post("/api/cron/sync", { headers: { authorization: "Bearer incorrecto" } })).status()).toBe(401);
    const ok = await request.post("/api/cron/sync", { headers: { authorization: "Bearer cron-e2e-secret" } });
    expect(ok.status()).toBe(200);
    expect((await request.get("/api/health")).status()).toBe(200);
  });
});
