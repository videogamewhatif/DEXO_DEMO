import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifrado de credenciales con AES-256-GCM.
 * - Claves fuera de la base de datos: TOKEN_ENCRYPTION_KEYS="v2:<base64 32 bytes>,v1:<base64 32 bytes>"
 * - TOKEN_ENCRYPTION_ACTIVE_KEY_ID indica con cuál se cifra; las demás solo descifran (rotación).
 * - AAD = contexto (integración + empresa): un texto cifrado copiado a otra fila/empresa no descifra.
 * Formato: "<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>"
 */
export interface KeyRing {
  activeKeyId: string;
  keys: Map<string, Buffer>;
}

export function parseKeyRing(spec: string | undefined, activeKeyId: string | undefined): KeyRing {
  if (!spec) throw new Error("TOKEN_ENCRYPTION_KEYS no está configurada");
  const keys = new Map<string, Buffer>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) throw new Error("Formato inválido en TOKEN_ENCRYPTION_KEYS (esperado id:base64)");
    const id = trimmed.slice(0, idx);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error("Identificador de clave inválido");
    const key = Buffer.from(trimmed.slice(idx + 1), "base64");
    if (key.length !== 32) throw new Error(`La clave ${id} debe tener 32 bytes (base64)`);
    keys.set(id, key);
  }
  const active = activeKeyId ?? [...keys.keys()][0];
  if (!active || !keys.has(active)) throw new Error("TOKEN_ENCRYPTION_ACTIVE_KEY_ID no corresponde a ninguna clave");
  return { activeKeyId: active, keys };
}

const b64u = (b: Buffer) => b.toString("base64url");

export function encryptString(ring: KeyRing, plaintext: string, aad: string): string {
  const key = ring.keys.get(ring.activeKeyId)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ring.activeKeyId, b64u(iv), b64u(tag), b64u(ct)].join(".");
}

export function decryptString(ring: KeyRing, payload: string, aad: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4) throw new Error("Credencial cifrada con formato inválido");
  const [keyId, iv, tag, ct] = parts as [string, string, string, string];
  const key = ring.keys.get(keyId);
  if (!key) throw new Error(`No existe la clave de cifrado ${keyId}`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function keyIdOf(payload: string): string {
  return payload.split(".")[0] ?? "";
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
