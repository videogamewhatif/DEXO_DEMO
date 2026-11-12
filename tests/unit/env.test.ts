import { afterEach, describe, expect, it, vi } from "vitest";
import { isDemoEnabled, resetEnvCache } from "@/config/env";

const AUTH_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
] as const;

function setProductionEnv(overrides: Record<string, string> = {}) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DEMO_MODE_ENABLED", "");
  for (const key of AUTH_ENV_KEYS) vi.stubEnv(key, "");
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  resetEnvCache();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("modo demostración", () => {
  it("se habilita en producción cuando falta configuración de autenticación o base de datos", () => {
    setProductionEnv();

    expect(isDemoEnabled()).toBe(true);
  });

  it("permanece apagado en producción con autenticación y base de datos configuradas", () => {
    setProductionEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      DATABASE_URL: "postgres://example",
    });

    expect(isDemoEnabled()).toBe(false);
  });

  it("respeta DEMO_MODE_ENABLED=false aunque no haya base de datos", () => {
    setProductionEnv({ DEMO_MODE_ENABLED: "false" });

    expect(isDemoEnabled()).toBe(false);
  });
});