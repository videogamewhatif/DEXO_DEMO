/**
 * Genera una clave aleatoria de 32 bytes (base64) para TOKEN_ENCRYPTION_KEYS.
 *   npm run keys:generate -- v2
 * Guarda el resultado en tu gestor de secretos; no lo publiques ni lo subas al repositorio.
 */
import { randomBytes } from "node:crypto";

const id = process.argv[2] ?? `k${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
  console.error("Identificador inválido (letras, números, _ o -).");
  process.exit(1);
}
console.log(`${id}:${randomBytes(32).toString("base64")}`);
