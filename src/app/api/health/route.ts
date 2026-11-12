import { NextResponse } from "next/server";
import { isAuthConfigured, isDemoEnabled, isEmailConfigured, serverEnv } from "@/config/env";
import { getPool } from "@/lib/db/pool";
import { listConnectors } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

/** Salud del despliegue. No expone secretos ni datos de empresas. */
export async function GET() {
  const env = serverEnv();
  const checks: Record<string, string> = {
    auth: isAuthConfigured() ? "configurado" : "no_configurado",
    email: isEmailConfigured() ? "configurado" : "no_configurado",
    demo: isDemoEnabled() ? "habilitado" : "deshabilitado",
    encryption: env.TOKEN_ENCRYPTION_KEYS ? "configurado" : "no_configurado",
    cron: env.CRON_SECRET ? "configurado" : "no_configurado",
  };
  for (const c of listConnectors()) checks[c.descriptor.id] = c.configStatus(env).configured ? "configurado" : "no_configurado";
  if (env.DATABASE_URL) {
    const client = await getPool().connect().catch(() => null);
    if (!client) checks.database = "sin_conexion";
    else {
      try {
        await client.query("begin");
        // Verifica que la conexión puede asumir el rol sujeto a RLS.
        await client.query("set local role authenticated");
        await client.query("select 1 from nexo.role_permissions limit 1");
        await client.query("rollback");
        checks.database = "ok";
      } catch {
        await client.query("rollback").catch(() => undefined);
        checks.database = "error_rol_o_migraciones";
      } finally {
        client.release();
      }
    }
  } else checks.database = "no_configurado";
  const ok = checks.database === "ok" || checks.database === "no_configurado";
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
