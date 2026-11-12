import { randomUUID } from "node:crypto";
import pg from "pg";
import { applyTestEnv, TEST_DATABASE_URL } from "./env";

applyTestEnv();

export const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 3 });

export interface TestUser {
  userId: string;
  email: string;
}

export async function createUser(prefix: string): Promise<TestUser> {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@test.example`;
  const { rows } = await admin.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  return { userId: rows[0]!.id, email };
}

export async function createOrg(name: string, opts: { timezone?: string } = {}): Promise<{ id: string; slug: string }> {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`;
  const { rows } = await admin.query<{ id: string }>(
    "insert into nexo.organizations (name, slug, timezone) values ($1, $2, $3) returning id",
    [name, slug, opts.timezone ?? "America/Mexico_City"],
  );
  return { id: rows[0]!.id, slug };
}

export async function addMember(orgId: string, userId: string, role: "org_admin" | "analyst" | "viewer") {
  await admin.query("insert into nexo.organization_members (organization_id, user_id, role) values ($1, $2, $3)", [orgId, userId, role]);
}

export async function makePlatformAdmin(userId: string) {
  await admin.query("insert into nexo.platform_admins (user_id, granted_by) values ($1, 'test')", [userId]);
}

/** Ejecuta SQL como el usuario (rol authenticated + claims), igual que withUserDb. */
export async function asUser<T>(user: TestUser, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await admin.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user.userId, role: "authenticated", email: user.email })]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Espera que la operación falle (permiso/RLS/regla) y devuelve el error. */
export async function expectDbError(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string };
  }
  throw new Error("Se esperaba un error de base de datos y la operación tuvo éxito");
}

export async function seedAdAccount(orgId: string, provider: "meta_ads" | "google_analytics" = "meta_ads") {
  const integ = await admin.query<{ id: string }>(
    "insert into nexo.integrations (organization_id, provider, status) values ($1, $2, 'connected') returning id",
    [orgId, provider],
  );
  const acc = await admin.query<{ id: string }>(
    `insert into nexo.provider_accounts (organization_id, integration_id, provider, account_type, external_id, name, currency, timezone, is_selected)
     values ($1, $2, $3, $4, $5, 'Cuenta', 'MXN', 'America/Mexico_City', true) returning id`,
    [orgId, integ.rows[0]!.id, provider, provider === "meta_ads" ? "meta_ad_account" : "ga4_property", String(Math.floor(Math.random() * 1e12))],
  );
  return { integrationId: integ.rows[0]!.id, accountId: acc.rows[0]!.id };
}
