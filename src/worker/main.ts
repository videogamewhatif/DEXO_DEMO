/**
 * Trabajador de sincronización de larga duración.
 *   npm run worker
 * Ciclo: recupera trabajos interrumpidos, programa actualizaciones vencidas y
 * procesa la cola. Varios trabajadores pueden ejecutarse en paralelo: los
 * leases (FOR UPDATE SKIP LOCKED + fencing) evitan ejecuciones duplicadas.
 */
import { closePool } from "@/lib/db/pool";
import { defaultWorkerId, runSyncCycle } from "@/lib/sync/engine";
import { serverEnv } from "@/config/env";
import { safeErrorMessage } from "@/lib/security/redact";

const IDLE_MS = Number(process.env.SYNC_IDLE_MS ?? 30_000);
let stopping = false;

async function main() {
  serverEnv(); // valida configuración al arrancar
  const workerId = defaultWorkerId();
  console.log(`[worker] iniciado (${workerId})`);
  while (!stopping) {
    try {
      const summary = await runSyncCycle({ workerId });
      if (summary.processed || summary.recovered || summary.enqueued) {
        console.log(`[worker] ciclo: ${JSON.stringify(summary)}`);
      }
    } catch (err) {
      console.error(`[worker] error de ciclo: ${safeErrorMessage(err)}`);
    }
    if (!stopping) await new Promise((r) => setTimeout(r, IDLE_MS));
  }
  await closePool();
  console.log("[worker] detenido");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} recibido; terminando tras el trabajo actual`);
    stopping = true;
  });
}

main().catch((err) => {
  console.error(`[worker] fallo fatal: ${safeErrorMessage(err)}`);
  process.exit(1);
});
