import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { TEST_DB_ADMIN_URL, TEST_DB_NAME, TEST_DATABASE_URL } from "./env";

/**
 * Crea una base de datos limpia, aplica el shim de Supabase Auth (solo pruebas)
 * y TODAS las migraciones versionadas, en orden.
 */
export default async function setup() {
  const admin = new pg.Client({ connectionString: TEST_DB_ADMIN_URL });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `No se pudo conectar a PostgreSQL de pruebas (${TEST_DB_ADMIN_URL}). Ejecuta "npm run db:local:start" o define TEST_DB_ADMIN_URL. Detalle: ${(err as Error).message}`,
    );
  }
  await admin.query(`drop database if exists ${TEST_DB_NAME} with (force)`);
  await admin.query(`create database ${TEST_DB_NAME}`);
  await admin.end();

  const db = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await db.connect();
  const root = path.resolve(import.meta.dirname, "../..");
  await db.query(readFileSync(path.join(root, "tests/db/sql/supabase-auth-shim.sql"), "utf8"));
  const dir = path.join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try {
      await db.query(readFileSync(path.join(dir, f), "utf8"));
    } catch (err) {
      throw new Error(`Migración ${f} falló: ${(err as Error).message}`);
    }
  }
  await db.end();
}
