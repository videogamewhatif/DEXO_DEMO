import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra la app compilada (next start) + PostgreSQL real con migraciones +
 * DOBLE DE PRUEBA de Supabase Auth (tests/e2e/mock-gotrue.mjs).
 * Requisitos: `npm run build` y PostgreSQL de pruebas (`npm run db:local:start`).
 */
const PORT = 3200;
const DB = process.env.E2E_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/nexo_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", locale: "es-MX", timezoneId: "America/Mexico_City" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node tests/e2e/seed.mjs && node tests/e2e/mock-gotrue.mjs",
      port: 54999,
      reuseExistingServer: false,
      env: { E2E_DATABASE_URL: DB },
      timeout: 60_000,
    },
    {
      command: `npx next start -p ${PORT}`,
      port: PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        APP_URL: `http://localhost:${PORT}`,
        DEMO_MODE_ENABLED: "true",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54999",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e",
        SUPABASE_SECRET_KEY: "sb_secret_e2e",
        DATABASE_URL: DB,
        DATABASE_SSL: "disable",
        TOKEN_ENCRYPTION_KEYS: "e2e:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "e2e",
        CRON_SECRET: "cron-e2e-secret",
      },
    },
  ],
});
