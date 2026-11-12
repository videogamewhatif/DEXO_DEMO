import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/config/env";
import { safeEqual } from "@/lib/security/crypto";
import { runSyncCycle } from "@/lib/sync/engine";
import { safeErrorMessage } from "@/lib/security/redact";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Endpoint programado (cron). Autenticado con CRON_SECRET (Authorization: Bearer).
 * Procesa trabajos dentro de un presupuesto de tiempo; los trabajos largos ceden
 * con checkpoint y continúan en la siguiente invocación o en el trabajador.
 */
async function handle(request: NextRequest) {
  const env = serverEnv();
  const header = request.headers.get("authorization") ?? "";
  if (!env.CRON_SECRET || !safeEqual(header, `Bearer ${env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const summary = await runSyncCycle({ deadline: Date.now() + env.SYNC_CRON_TIME_BUDGET_MS, maxJobs: 20 });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: safeErrorMessage(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
