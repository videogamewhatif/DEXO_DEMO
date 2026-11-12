import { describe, expect, it } from "vitest";
import { decryptString, encryptString, parseKeyRing, pkceChallengeS256, sha256Hex } from "@/lib/security/crypto";
import { redactSecrets } from "@/lib/security/redact";
import { csvCell, toCsv } from "@/lib/reports/csv";
import { safeNextPath } from "@/lib/auth/session";
import { parseFilters, MAX_RANGE_DAYS } from "@/lib/reports/filters";
import { createProviderHttp } from "@/lib/integrations/http";
import { ProviderError } from "@/lib/integrations/errors";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");

describe("cifrado de credenciales", () => {
  it("cifra y descifra con AES-256-GCM; el texto cifrado no contiene el secreto", () => {
    const ring = parseKeyRing(`v1:${K1}`, "v1");
    const ct = encryptString(ring, "refresh-token-secreto", "integration:a:org:b");
    expect(ct).not.toContain("refresh-token-secreto");
    expect(ct.startsWith("v1.")).toBe(true);
    expect(decryptString(ring, ct, "integration:a:org:b")).toBe("refresh-token-secreto");
  });
  it("el AAD liga el cifrado a la integración/empresa (copiarlo a otra empresa falla)", () => {
    const ring = parseKeyRing(`v1:${K1}`, "v1");
    const ct = encryptString(ring, "x", "integration:a:org:b");
    expect(() => decryptString(ring, ct, "integration:a:org:OTRA")).toThrow();
  });
  it("detecta manipulación", () => {
    const ring = parseKeyRing(`v1:${K1}`, "v1");
    const ct = encryptString(ring, "x", "aad").split(".");
    ct[3] = Buffer.from("zz").toString("base64url");
    expect(() => decryptString(ring, ct.join("."), "aad")).toThrow();
  });
  it("rotación: la clave nueva cifra y la anterior aún descifra", () => {
    const old = parseKeyRing(`v1:${K1}`, "v1");
    const ct = encryptString(old, "dato", "aad");
    const rotated = parseKeyRing(`v2:${K2},v1:${K1}`, "v2");
    expect(decryptString(rotated, ct, "aad")).toBe("dato");
    expect(encryptString(rotated, "dato", "aad").startsWith("v2.")).toBe(true);
  });
  it("rechaza claves de longitud incorrecta", () => {
    expect(() => parseKeyRing(`v1:${Buffer.alloc(16).toString("base64")}`, "v1")).toThrow(/32 bytes/);
  });
  it("PKCE S256 coincide con el vector del RFC 7636", () => {
    expect(pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(sha256Hex("abc")).toHaveLength(64);
  });
});

describe("redacción de secretos", () => {
  it("elimina tokens de URLs, JSON, cabeceras y formatos conocidos", () => {
    const s = redactSecrets(`GET https://graph.facebook.com/x?access_token=EAAabcdefghijklmnopqrstuvwxyz123&fields=a {"refresh_token":"1//abc","code":"xyz"} Bearer ya29.AAAA sb_secret_123`);
    expect(s).not.toMatch(/EAAabc|1\/\/abc|"xyz"|ya29\.AAAA|sb_secret_123/);
    expect(s).toContain("fields=a");
  });
});

describe("CSV seguro", () => {
  it("neutraliza fórmulas y escapa comillas; BOM para acentos", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(-5)).toBe("-5"); // números propios no se alteran
    expect(csvCell("Campaña, otoño")).toBe(`"Campaña, otoño"`);
    const out = toCsv(["campaña"], [["Pan de muerto"]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain("campaña\r\nPan de muerto");
  });
});

describe("validación de entradas", () => {
  it("redirecciones solo a rutas internas", () => {
    expect(safeNextPath("https://evil.example")).toBe("/app");
    expect(safeNextPath("//evil.example")).toBe("/app");
    expect(safeNextPath("/\\evil")).toBe("/app");
    expect(safeNextPath("/app/x/resumen")).toBe("/app/x/resumen");
  });
  it("filtros: fechas inválidas, invertidas y periodos excesivos", () => {
    expect(parseFilters({ preset: "custom", from: "2026-02-30", to: "2026-03-01" }, "2026-11-10").error).toBeTruthy();
    expect(parseFilters({ preset: "custom", from: "2026-10-10", to: "2026-10-01" }, "2026-11-10").preset).toBe("last_28");
    const long = parseFilters({ preset: "custom", from: "2020-01-01", to: "2026-11-01" }, "2026-11-10");
    expect(long.error).toMatch(String(MAX_RANGE_DAYS));
    expect(parseFilters({ account: ["'; drop table x;--", "abc-123"] }, "2026-11-10").accountIds).toEqual(["abc-123"]);
  });
});

describe("cliente HTTP de proveedores", () => {
  it("bloquea hosts no declarados y HTTP sin TLS", async () => {
    const http = createProviderHttp({ provider: "meta_ads", allowedHosts: ["graph.facebook.com"], fetchImpl: async () => new Response("{}") });
    await expect(http.request("GET", "https://evil.example/x")).rejects.toBeInstanceOf(ProviderError);
    await expect(http.request("GET", "http://graph.facebook.com/x")).rejects.toBeInstanceOf(ProviderError);
    expect(http.calls).toBe(0);
  });
});
