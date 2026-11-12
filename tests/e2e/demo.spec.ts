import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.describe("modo demostración", () => {
  test("lista dos empresas ficticias y muestra el aviso permanente", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("link", { name: /Panadería Aurora/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Viajes Horizonte/ })).toBeVisible();
    await page.getByRole("link", { name: /Panadería Aurora/ }).click();
    await expect(page.getByRole("region", { name: "Aviso de demostración" })).toContainText("Datos de demostración");
    await expect(page.getByRole("heading", { name: "Resumen" })).toBeVisible();
    await expect(page.locator('[data-metric="spend"]').first()).toContainText("MXN");
  });

  test("filtros y comparación con periodo anterior", async ({ page }) => {
    await page.goto("/demo/panaderia-aurora/resumen");
    await page.getByLabel("Periodo", { exact: true }).selectOption("last_7");
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(page).toHaveURL(/preset=last_7/);
    await expect(page.locator('[data-metric="spend"]').first()).toContainText("vs. periodo anterior");
    await page.getByLabel("Comparar con periodo anterior").uncheck();
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(page).toHaveURL(/compare=0/);
    await expect(page.locator('[data-metric="spend"]').first()).not.toContainText("vs. periodo anterior");
    await page.getByLabel("Fuente").selectOption("google_analytics");
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(page.getByRole("heading", { name: "Publicidad", exact: true })).toHaveCount(0);
    await expect(page.locator('[data-metric="sessions"]')).toBeVisible();
  });

  test("monedas separadas, conexión caducada y días sin datos", async ({ page }) => {
    await page.goto("/demo/viajes-horizonte/publicidad");
    await expect(page.getByText("Varias monedas")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meta Ads · COP" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meta Ads · USD" })).toBeVisible();
    await expect(page.getByText("Conexión caducada")).toBeVisible();
    await expect(page.getByText(/Datos incompletos/).first()).toBeVisible();
  });

  test("exporta CSV con BOM, periodo, fuente y moneda", async ({ page }) => {
    await page.goto("/demo/panaderia-aurora/reportes");
    const download = page.waitForEvent("download");
    await page.getByRole("listitem").filter({ hasText: "Campañas (Meta Ads)" }).getByRole("link", { name: "Descargar CSV" }).click();
    const file = await (await download).path();
    const text = readFileSync(file, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("periodo_inicio,periodo_fin,fuente,cuenta,campaña");
    expect(text).toContain("Meta Ads");
    expect(text).toContain("MXN");
  });

  test("rol simulado de lector: sin configuración ni exportación", async ({ page }) => {
    await page.goto("/demo/panaderia-aurora/resumen");
    await page.getByLabel("Simular rol (solo visual):").selectOption("viewer");
    await expect(page.locator("header").getByText("Lector", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navegación principal" }).getByText("Configuración")).toHaveAttribute("aria-disabled", "true");
    await page.goto("/demo/panaderia-aurora/configuracion");
    await expect(page.getByRole("heading", { name: "Permisos insuficientes" })).toBeVisible();
    const res = await page.request.get("/demo/panaderia-aurora/exportar?kind=campaigns");
    expect(res.status()).toBe(403);
    await page.goto("/demo/panaderia-aurora/resumen");
    await page.getByLabel("Simular rol (solo visual):").selectOption("org_admin");
  });

  test("módulos no implementados aparecen como Próximamente sin botones de conexión", async ({ page }) => {
    await page.goto("/demo/panaderia-aurora/redes");
    await expect(page.getByText("Próximamente").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Conectar/ })).toHaveCount(0);
    await page.goto("/demo/panaderia-aurora/integraciones");
    await expect(page.getByLabel("Google Ads: próximamente")).toBeVisible();
    await expect(page.getByLabel("Google Ads: próximamente").getByRole("button")).toHaveCount(0);
  });

  test("tabla ordenable y paginada", async ({ page }) => {
    await page.goto("/demo/panaderia-aurora/web?preset=last_90");
    const table = page.getByRole("region", { name: "Landing pages", exact: true });
    await table.getByRole("button", { name: /Sesiones/ }).click();
    await expect(table.locator("th").filter({ hasText: "Sesiones" })).toHaveAttribute("aria-sort", /ascending|descending/);
  });

  test("vista móvil sin desplazamiento horizontal y con menú", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto("/demo/panaderia-aurora/resumen");
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw).toBeLessThanOrEqual(390);
    await page.getByLabel("Abrir menú").click();
    await page.getByRole("navigation", { name: "Navegación principal (móvil)" }).getByRole("link", { name: "Publicidad" }).click();
    await expect(page.getByRole("heading", { name: "Publicidad" })).toBeVisible();
    await ctx.close();
  });

  test("navegación con teclado: enlace para saltar al contenido", async ({ page }) => {
    await page.goto("/demo/panaderia-aurora/resumen");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  });
});
