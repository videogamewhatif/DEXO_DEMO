import "server-only";
import { hostname } from "node:os";
import { serverEnv } from "@/config/env";
import { withPrivilegedDb } from "@/lib/db/privileged";
import type { Queryable } from "@/lib/db/types";
import type { ChunkData, Connector, DateRange, FetchContext } from "@/lib/integrations/contract";
import { ProviderError } from "@/lib/integrations/errors";
import { getConnector } from "@/lib/integrations/registry";
import { getUsableTokens, markIntegrationNeedsReauth, providerHttp } from "@/lib/integrations/service";
import { snapshotRanges, todayInTimeZone } from "@/lib/metrics/periods";
import { safeErrorMessage } from "@/lib/security/redact";
import { DEFAULT_RETRY, rescheduleDelayMs, withRetry, type RetryPolicy } from "./retry";
import { writeChunk, writeSnapshots } from "./writers";

export interface SyncJobRow {
  id: string;
  organization_id: string;
  provider_account_id: string;
  kind: string;
  status: string;
  date_from: string;
  date_to: string;
  attempts: number;
  max_attempts: number;
  checkpoint: Checkpoint;
  lease_owner: string | null;
}

interface Checkpoint {
  validated?: boolean;
  skipDatasets?: string[];
  nextChunk?: number;
  notes?: string[];
}

export interface WorkerOptions {
  workerId?: string;
  leaseSeconds?: number;
  /** Momento (epoch ms) a partir del cual no se inicia otro bloque; el trabajo cede con su checkpoint. */
  deadline?: number;
  sleep?: (ms: number) => Promise<void>;
  retry?: RetryPolicy;
  preferAsync?: boolean;
  /** Solo pruebas: simula una caída del proceso después de N bloques escritos. */
  crashAfterChunks?: number;
}

export type JobOutcome = "completed" | "partially_completed" | "failed" | "cancelled" | "rescheduled" | "yielded" | "lease_lost";

class LeaseLostError extends Error {}
class SimulatedCrash extends Error {}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function defaultWorkerId() {
  return serverEnv().SYNC_WORKER_ID ?? `${hostname()}-${process.pid}`;
}

export async function claimJob(workerId: string, leaseSeconds: number): Promise<SyncJobRow | null> {
  return withPrivilegedDb(async (db) => {
    const { rows } = await db.query<SyncJobRow>("select * from nexo.claim_next_sync_job($1, $2)", [workerId, leaseSeconds]);
    return rows[0] ?? null;
  });
}

async function finishJob(
  db: Queryable,
  job: SyncJobRow,
  workerId: string,
  runId: string,
  status: "completed" | "partially_completed" | "failed" | "cancelled",
  error: { code?: string | null; message?: string | null } = {},
  stats: Record<string, unknown> = {},
) {
  await db.query(
    `update nexo.sync_jobs set status = $3, finished_at = now(), lease_owner = null, lease_expires_at = null,
       error_code = $4, error_message = $5
     where id = $1 and lease_owner = $2`,
    [job.id, workerId, status, error.code ?? null, error.message ?? null],
  );
  await db.query(
    `update nexo.sync_runs set status = $2, finished_at = now(), error_code = $3, error_message = $4, stats = $5::jsonb where id = $1`,
    [runId, status, error.code ?? null, error.message ?? null, JSON.stringify(stats)],
  );
}

/** Procesa un trabajo ya reclamado (con lease). */
export async function processJob(job: SyncJobRow, opts: WorkerOptions = {}): Promise<JobOutcome> {
  const env = serverEnv();
  const workerId = opts.workerId ?? defaultWorkerId();
  const leaseSeconds = opts.leaseSeconds ?? env.SYNC_LEASE_SECONDS;
  const sleep = opts.sleep ?? defaultSleep;
  const retry = opts.retry ?? DEFAULT_RETRY;
  const checkpoint: Checkpoint = { ...(job.checkpoint ?? {}) };
  const stats: Record<string, unknown> = { chunks: 0, rows: 0, discarded: 0, provider_calls: 0, retries: 0 };

  const runId = await withPrivilegedDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into nexo.sync_runs (job_id, organization_id, attempt, worker_id, status) values ($1, $2, $3, $4, 'running') returning id`,
      [job.id, job.organization_id, job.attempts, workerId],
    );
    return rows[0]!.id;
  });

  const ctxRow = await withPrivilegedDb(async (db) => {
    const { rows } = await db.query<{
      external_id: string;
      currency: string | null;
      timezone: string | null;
      provider: string;
      integration_id: string | null;
      integration_status: string | null;
      org_status: string;
      org_timezone: string;
      is_selected: boolean;
    }>(
      `select pa.external_id, pa.currency, pa.timezone, pa.provider, pa.integration_id, pa.is_selected,
              i.status::text as integration_status, o.status::text as org_status, o.timezone as org_timezone
         from nexo.provider_accounts pa
         join nexo.organizations o on o.id = pa.organization_id
         left join nexo.integrations i on i.id = pa.integration_id
        where pa.id = $1 and pa.organization_id = $2`,
      [job.provider_account_id, job.organization_id],
    );
    return rows[0];
  });

  const fail = (status: "failed" | "cancelled", code: string, message: string) =>
    withPrivilegedDb((db) => finishJob(db, job, workerId, runId, status, { code, message }, stats)).then(() => status);

  if (!ctxRow) return fail("failed", "account_missing", "La cuenta ya no existe");
  if (ctxRow.org_status !== "active") return fail("cancelled", "organization_suspended", "La empresa está suspendida");
  if (!ctxRow.is_selected) return fail("cancelled", "account_deselected", "La cuenta ya no está seleccionada");
  if (!ctxRow.integration_id || ctxRow.integration_status !== "connected") {
    return fail("failed", "integration_not_connected", "La integración no está conectada; no se consultó al proveedor");
  }
  const connector: Connector | null = getConnector(ctxRow.provider);
  if (!connector) return fail("failed", "unknown_provider", "Proveedor sin conector registrado");
  if (!connector.configStatus(env).configured) {
    return fail("failed", "integration_not_configured", "Faltan credenciales de aplicación del proveedor en el servidor");
  }
  const integ = { id: ctxRow.integration_id, organization_id: job.organization_id };
  const http = providerHttp(connector);

  try {
    const tokens = await withPrivilegedDb((db) => getUsableTokens(db, connector, integ));
    const ctx: FetchContext = {
      tokens,
      account: { id: job.provider_account_id, externalId: ctxRow.external_id, currency: ctxRow.currency, timezone: ctxRow.timezone },
      http,
      env,
      sleep,
      preferAsync: opts.preferAsync,
    };
    const onRetry = () => {
      stats.retries = (stats.retries as number) + 1;
    };

    if (!checkpoint.validated) {
      const v = await withRetry(() => connector.validateAccount(ctx), retry, sleep, onRetry);
      if (!v.ok) {
        await withPrivilegedDb((db) =>
          db.query(`update nexo.integrations set last_error_code = $2, last_error_message = $3 where id = $1`, [integ.id, v.code, v.message]),
        );
        return fail("failed", v.code, v.message);
      }
      await withPrivilegedDb((db) =>
        db.query(
          `update nexo.provider_accounts set currency = coalesce($2, currency), timezone = coalesce($3, timezone) where id = $1`,
          [job.provider_account_id, v.currency, v.timezone],
        ),
      );
      ctx.account.currency = v.currency ?? ctx.account.currency;
      ctx.account.timezone = v.timezone ?? ctx.account.timezone;
      checkpoint.validated = true;
      checkpoint.skipDatasets = v.unsupportedDatasets;
      checkpoint.notes = v.notes;
    }
    ctx.skipDatasets = checkpoint.skipDatasets ?? [];

    const chunks: DateRange[] = connector.planChunks({ from: job.date_from, to: job.date_to });
    let i = checkpoint.nextChunk ?? 0;
    for (; i < chunks.length; i++) {
      if (opts.deadline && Date.now() > opts.deadline) {
        // Cede el trabajo con su checkpoint; otra ejecución lo continuará.
        await withPrivilegedDb(async (db) => {
          await db.query(
            `update nexo.sync_jobs set status = 'pending', run_after = now(), lease_owner = null, lease_expires_at = null,
               attempts = greatest(attempts - 1, 0), checkpoint = $3::jsonb
             where id = $1 and lease_owner = $2`,
            [job.id, workerId, JSON.stringify({ ...checkpoint, nextChunk: i })],
          );
          await db.query(`update nexo.sync_runs set status = 'partially_completed', finished_at = now(), error_code = 'yielded', stats = $2::jsonb where id = $1`, [
            runId,
            JSON.stringify(stats),
          ]);
        });
        return "yielded";
      }

      // La empresa o la integración pudieron cambiar durante la ejecución.
      const state = await withPrivilegedDb(async (db) => {
        const { rows } = await db.query<{ org: string; integ: string | null }>(
          `select o.status::text as org, i.status::text as integ from nexo.organizations o
             left join nexo.integrations i on i.id = $2 where o.id = $1`,
          [job.organization_id, integ.id],
        );
        return rows[0];
      });
      if (state?.org !== "active") return fail("cancelled", "organization_suspended", "La empresa fue suspendida durante la sincronización");
      if (state?.integ !== "connected") return fail("failed", "integration_not_connected", "La integración fue desconectada durante la sincronización");

      const range = chunks[i]!;
      const data: ChunkData = await withRetry(() => connector.fetchChunk(ctx, range), retry, sleep, onRetry);

      await withPrivilegedDb(async (db) => {
        // Fencing: solo escribe quien conserva el lease.
        const fence = await db.query(
          `update nexo.sync_jobs set checkpoint = $3::jsonb, lease_expires_at = now() + make_interval(secs => $4)
             where id = $1 and lease_owner = $2 and status = 'running' returning id`,
          [job.id, workerId, JSON.stringify({ ...checkpoint, nextChunk: i + 1 }), leaseSeconds],
        );
        if (fence.rowCount === 0) throw new LeaseLostError();
        const res = await writeChunk(db, { organizationId: job.organization_id, accountId: job.provider_account_id, jobId: job.id }, data);
        await db.query(`update nexo.sync_jobs set rows_written = rows_written + $2 where id = $1`, [job.id, res.rows]);
        stats.rows = (stats.rows as number) + res.rows;
        stats.discarded = (stats.discarded as number) + res.discarded;
      });
      stats.chunks = (stats.chunks as number) + 1;
      if (opts.crashAfterChunks !== undefined && (stats.chunks as number) >= opts.crashAfterChunks) throw new SimulatedCrash();
    }

    // Agregados no aditivos por periodo exacto (no bloquean el resultado principal).
    let snapshotProblem: string | null = null;
    if (connector.fetchSnapshots) {
      const ranges = snapshotRanges(todayInTimeZone(ctxRow.org_timezone)).filter((r) => r.to <= job.date_to);
      if (ranges.length) {
        try {
          const snaps = await withRetry(() => connector.fetchSnapshots!(ctx, ranges), retry, sleep, onRetry);
          await withPrivilegedDb((db) =>
            writeSnapshots(db, { organizationId: job.organization_id, accountId: job.provider_account_id, jobId: job.id }, snaps),
          );
        } catch (err) {
          if (err instanceof ProviderError && err.kind === "auth") throw err;
          snapshotProblem = safeErrorMessage(err, 200);
        }
      }
    }

    stats.provider_calls = http.calls;
    const partial = (checkpoint.skipDatasets?.length ?? 0) > 0 || snapshotProblem !== null;
    const message = [
      checkpoint.skipDatasets?.length ? `Conjuntos no compatibles omitidos: ${checkpoint.skipDatasets.join(", ")}` : null,
      snapshotProblem ? `Agregados por periodo no disponibles: ${snapshotProblem}` : null,
      ...(checkpoint.notes ?? []),
    ]
      .filter(Boolean)
      .join(" · ");
    await withPrivilegedDb(async (db) => {
      await finishJob(db, job, workerId, runId, partial ? "partially_completed" : "completed", { code: partial ? "partial" : null, message: message || null }, stats);
      await db.query(`update nexo.provider_accounts set last_successful_sync_at = now() where id = $1`, [job.provider_account_id]);
      await db.query(`update nexo.integrations set last_validated_at = now() where id = $1`, [integ.id]);
    });
    return partial ? "partially_completed" : "completed";
  } catch (err) {
    stats.provider_calls = http.calls;
    if (err instanceof SimulatedCrash) return "lease_lost";
    if (err instanceof LeaseLostError) {
      await withPrivilegedDb((db) =>
        db.query(`update nexo.sync_runs set status = 'failed', finished_at = now(), error_code = 'lease_lost', stats = $2::jsonb where id = $1`, [
          runId,
          JSON.stringify(stats),
        ]),
      );
      return "lease_lost";
    }
    const message = safeErrorMessage(err);
    if (err instanceof ProviderError && err.kind === "auth") {
      await withPrivilegedDb(async (db) => {
        await markIntegrationNeedsReauth(db, integ.id, err);
        await finishJob(db, job, workerId, runId, "failed", { code: err.code, message }, stats);
      });
      return "failed";
    }
    const retryable = !(err instanceof ProviderError) || err.retryable;
    if (retryable && job.attempts < job.max_attempts) {
      const pe = err instanceof ProviderError ? err : new ProviderError("transient", ctxRow.provider, message);
      const delay = rescheduleDelayMs(pe, job.attempts);
      await withPrivilegedDb(async (db) => {
        await db.query(
          `update nexo.sync_jobs set status = 'pending', run_after = now() + make_interval(secs => $3), lease_owner = null, lease_expires_at = null,
             error_code = $4, error_message = $5
           where id = $1 and lease_owner = $2`,
          [job.id, workerId, Math.ceil(delay / 1000), pe.code, message],
        );
        await db.query(`update nexo.sync_runs set status = 'failed', finished_at = now(), error_code = $2, error_message = $3, stats = $4::jsonb where id = $1`, [
          runId,
          pe.code,
          message,
          JSON.stringify({ ...stats, rescheduled_in_seconds: Math.ceil(delay / 1000) }),
        ]);
      });
      return "rescheduled";
    }
    const code = err instanceof ProviderError ? err.code : "internal_error";
    await withPrivilegedDb((db) => finishJob(db, job, workerId, runId, "failed", { code, message }, stats));
    return "failed";
  }
}

/** Ciclo completo: recuperar, programar y procesar hasta agotar trabajos o tiempo. */
export async function runSyncCycle(opts: WorkerOptions & { maxJobs?: number; enqueue?: boolean } = {}) {
  const env = serverEnv();
  const workerId = opts.workerId ?? defaultWorkerId();
  const leaseSeconds = opts.leaseSeconds ?? env.SYNC_LEASE_SECONDS;
  const summary = { recovered: 0, enqueued: 0, processed: 0, outcomes: {} as Record<string, number> };
  await withPrivilegedDb(async (db) => {
    summary.recovered = (await db.query<{ n: number }>("select nexo.recover_stale_sync_jobs() as n")).rows[0]?.n ?? 0;
    if (opts.enqueue !== false) {
      summary.enqueued = (await db.query<{ n: number }>("select nexo.enqueue_scheduled_sync_jobs() as n")).rows[0]?.n ?? 0;
    }
  });
  const maxJobs = opts.maxJobs ?? 50;
  while (summary.processed < maxJobs) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const job = await claimJob(workerId, leaseSeconds);
    if (!job) break;
    const outcome = await processJob(job, { ...opts, workerId, leaseSeconds });
    summary.processed++;
    summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
  }
  return summary;
}
