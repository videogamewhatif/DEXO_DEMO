import pg from "pg";
import { serverEnv } from "@/config/env";

// Las fechas (DATE) se devuelven como texto YYYY-MM-DD: evita desplazamientos de zona horaria.
pg.types.setTypeParser(1082, (v: string) => v);
// NUMERIC se mantiene como texto y se convierte de forma explícita donde corresponde.

const globalForPool = globalThis as unknown as { __nexoPool?: pg.Pool };

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL no está configurada");
    this.name = "DatabaseNotConfiguredError";
  }
}

/** Pool único por proceso. NO exportar fuera de src/lib/db. */
export function getPool(): pg.Pool {
  if (globalForPool.__nexoPool) return globalForPool.__nexoPool;
  const env = serverEnv();
  if (!env.DATABASE_URL) throw new DatabaseNotConfiguredError();
  const ssl =
    env.DATABASE_SSL === "disable" ? false : env.DATABASE_SSL === "no-verify" ? { rejectUnauthorized: false } : { rejectUnauthorized: true };
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: "nexo-analytics",
  });
  pool.on("error", (err) => {
    console.error("[db] error en conexión inactiva:", err.message);
  });
  globalForPool.__nexoPool = pool;
  return pool;
}

export async function closePool() {
  if (globalForPool.__nexoPool) {
    await globalForPool.__nexoPool.end();
    globalForPool.__nexoPool = undefined;
  }
}
