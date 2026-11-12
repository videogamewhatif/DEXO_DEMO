/**
 * Recifra todas las credenciales con la clave activa (TOKEN_ENCRYPTION_ACTIVE_KEY_ID).
 * Procedimiento completo en docs/seguridad.md (rotación de claves).
 *   npm run keys:rotate
 */
import { withPrivilegedDb } from "@/lib/db/privileged";
import { reencryptAll } from "@/lib/integrations/credentials";
import { closePool } from "@/lib/db/pool";

const n = await withPrivilegedDb((db) => reencryptAll(db));
console.log(`Credenciales recifradas con la clave activa: ${n}`);
await closePool();
