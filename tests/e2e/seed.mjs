/** Prepara la base de datos de E2E: migraciones reales + shim de auth + datos de prueba (no demo). */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

const adminUrl = process.env.TEST_DB_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
const dbName = "nexo_e2e";
const root = path.resolve(import.meta.dirname, "../..");
const hash = (pw) => createHash("sha256").update(`e2e:${pw}`).digest("hex");

const a = new pg.Client({ connectionString: adminUrl });
await a.connect();
await a.query(`drop database if exists ${dbName} with (force)`);
await a.query(`create database ${dbName}`);
await a.end();

const db = new pg.Client({ connectionString: adminUrl.replace(/\/[^/]*$/, `/${dbName}`) });
await db.connect();
await db.query(readFileSync(path.join(root, "tests/db/sql/supabase-auth-shim.sql"), "utf8"));
for (const f of readdirSync(path.join(root, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  await db.query(readFileSync(path.join(root, "supabase/migrations", f), "utf8"));
}
const user = async (email) => (await db.query("insert into auth.users (email, encrypted_password, email_confirmed_at) values ($1, $2, now()) returning id", [email, hash("Contrasena-Segura-1")])).rows[0].id;
const ana = await user("ana@empresa-a.test");
const luis = await user("luis@empresa-b.test");
const pedro = await user("pedro@empresa-a.test");
const sofia = await user("sofia@ambas.test");
const root_ = await user("root@plataforma.test");
await db.query("insert into nexo.platform_admins (user_id, granted_by) values ($1, 'seed-e2e')", [root_]);
const org = async (name, slug) => (await db.query("insert into nexo.organizations (name, slug, display_currency) values ($1, $2, 'MXN') returning id", [name, slug])).rows[0].id;
const A = await org("Empresa Alfa", "empresa-alfa");
const B = await org("Empresa Beta", "empresa-beta");
const m = (o, u, r) => db.query("insert into nexo.organization_members (organization_id, user_id, role) values ($1, $2, $3)", [o, u, r]);
await m(A, ana, "org_admin");
await m(A, pedro, "viewer");
await m(B, luis, "org_admin");
await m(A, sofia, "analyst");
await m(B, sofia, "viewer");

// Datos sincronizados de prueba (simulan lo que escribiría el trabajador).
for (const [o, name, spend] of [[A, "Alfa Ads", 111], [B, "Beta Ads", 999]]) {
  const i = (await db.query("insert into nexo.integrations (organization_id, provider, status, external_user_label) values ($1, 'meta_ads', 'connected', 'Prueba') returning id", [o])).rows[0].id;
  const acc = (await db.query(
    `insert into nexo.provider_accounts (organization_id, integration_id, provider, account_type, external_id, name, currency, timezone, is_selected, last_successful_sync_at)
     values ($1, $2, 'meta_ads', 'meta_ad_account', $3, $4, 'MXN', 'America/Mexico_City', true, now()) returning id`, [o, i, name === "Alfa Ads" ? "1001" : "2002", name])).rows[0].id;
  await db.query("insert into nexo.campaigns (organization_id, provider_account_id, external_id, name) values ($1, $2, 'c1', $3)", [o, acc, `Campaña ${name}`]);
  await db.query(
    `insert into nexo.ad_campaign_daily (organization_id, provider_account_id, campaign_external_id, date, currency, spend, impressions, clicks, link_clicks, attribution_setting)
     select $1, $2, 'c1', d::date, 'MXN', $3, 1000, 40, 20, '7d_click_1d_view' from generate_series(current_date - 60, current_date, interval '1 day') d`, [o, acc, spend]);
  await db.query(
    `insert into nexo.data_coverage (organization_id, provider_account_id, dataset, date)
     select $1, $2, 'ads_campaign_daily', d::date from generate_series(current_date - 60, current_date, interval '1 day') d`, [o, acc]);
}
await db.end();
console.log("E2E seed listo");
