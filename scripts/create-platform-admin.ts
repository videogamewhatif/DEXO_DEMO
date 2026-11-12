/**
 * Procedimiento administrativo controlado para otorgar el rol de platform admin.
 * Requiere acceso de servidor (DATABASE_URL y SUPABASE_SECRET_KEY). Nunca se
 * otorga desde la interfaz ni por metadatos de registro.
 *
 *   npm run admin:create-platform-admin -- --email persona@dominio.com --note "Responsable de plataforma"
 *
 * - Si la cuenta no existe, la crea (correo confirmado, contraseña aleatoria
 *   que no se muestra) y genera un enlace de un solo uso para definir contraseña.
 * - Registra el alta en audit_logs.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/config/env";
import { withPrivilegedDb } from "@/lib/db/privileged";
import { closePool } from "@/lib/db/pool";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg("email")?.toLowerCase();
const note = arg("note") ?? null;
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Uso: --email persona@dominio.com [--note 'motivo']");
  process.exit(1);
}
const env = serverEnv();
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.DATABASE_URL) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY o DATABASE_URL.");
  process.exit(1);
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let userId = await withPrivilegedDb(async (db) => (await db.query<{ id: string }>("select id from auth.users where lower(email) = $1", [email])).rows[0]?.id);
let link: string | null = null;
if (!userId) {
  const created = await supabase.auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
  if (created.error || !created.data.user) {
    console.error(`No se pudo crear la cuenta: ${created.error?.message}`);
    process.exit(1);
  }
  userId = created.data.user.id;
  const gen = await supabase.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: new URL("/auth/confirm?next=/restablecer", env.APP_URL).toString() } });
  link = gen.data?.properties?.action_link ?? null;
}

await withPrivilegedDb(async (db) => {
  await db.query("insert into nexo.platform_admins (user_id, granted_by, note) values ($1, $2, $3) on conflict (user_id) do nothing", [userId, `script:${process.env.USER ?? "operador"}`, note]);
  await db.query("select nexo.write_audit(null, null, 'system', 'platform_admin.granted', 'user', $1, $2::jsonb)", [userId, JSON.stringify({ email, note })]);
});
console.log(`Platform admin otorgado a ${email} (${userId}).`);
if (link) console.log(`Enlace de un solo uso para definir contraseña (compártelo solo con esa persona):\n${link}`);
await closePool();
