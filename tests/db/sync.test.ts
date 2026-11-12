import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { addMember, admin, asUser, createOrg, createUser, expectDbError, type TestUser } from "./helpers";
import { __setProviderFetchForTests, completeOAuth, disconnectIntegration, startOAuth } from "@/lib/integrations/service";
import { claimJob, processJob, runSyncCycle } from "@/lib/sync/engine";
import { closePool } from "@/lib/db/pool";
import { createProviderMock, type MockOptions } from "../support/provider-mocks";
import { createDbRepository } from "@/lib/reports/db-repository";

/**
 * Integración con PostgreSQL real + proveedores SIMULADOS (fixtures).
 * Verifica OAuth, cifrado, sincronización idempotente, leases, recuperación,
 * límites y desconexión. No consulta las APIs reales de Google ni Meta.
 */

let ana: TestUser;
let luis: TestUser;
let org: { id: string; slug: string };
let orgB: { id: string; slug: string };

function installMock(opts?: MockOptions) {
  const m = createProviderMock(opts);
  __setProviderFetchForTests(m.fetchImpl);
  return m;
}

async function connect(user: TestUser, orgId: string, provider: "meta_ads" | "google_analytics", mockOpts?: MockOptions) {
  const mock = installMock(mockOpts);
  const url = new URL(await startOAuth(user, orgId, provider));
  const state = url.searchParams.get("state")!;
  const res = await completeOAuth(user, provider, new URLSearchParams({ state, code: "ok" }));
  return { ...res, mock, state };
}

async function selectAccount(user: TestUser, orgId: string, externalId: string, range?: { from: string; to: string }) {
  const acc = (await admin.query("select id from nexo.provider_accounts where organization_id = $1 and external_id = $2", [orgId, externalId])).rows[0]!.id as string;
  await asUser(user, (c) => c.query("select nexo.set_account_selection($1, true)", [acc]));
  if (range) await admin.query("update nexo.sync_jobs set date_from = $2, date_to = $3 where provider_account_id = $1 and status = 'pending'", [acc, range.from, range.to]);
  return acc;
}

const counts = async (accountId: string) =>
  (
    await admin.query(
      `select (select count(*)::int from nexo.ad_campaign_daily where provider_account_id = $1) ads,
              (select count(*)::int from nexo.ad_campaign_daily_actions where provider_account_id = $1) actions,
              (select coalesce(sum(spend),0)::text from nexo.ad_campaign_daily where provider_account_id = $1) spend,
              (select count(*)::int from nexo.data_coverage where provider_account_id = $1) coverage`,
      [accountId],
    )
  ).rows[0];

beforeAll(async () => {
  org = await createOrg("Sync A");
  orgB = await createOrg("Sync B");
  ana = await createUser("ana-sync");
  luis = await createUser("luis-sync");
  await addMember(org.id, ana.userId, "org_admin");
  await addMember(orgB.id, luis.userId, "org_admin");
});

afterEach(() => __setProviderFetchForTests(undefined));
afterAll(async () => {
  await admin.end();
  await closePool();
});

describe("OAuth y credenciales", () => {
  it("conecta Meta, guarda credenciales CIFRADAS y lista cuentas autorizadas", async () => {
    const r = await connect(ana, org.id, "meta_ads");
    expect(r.organizationId).toBe(org.id);
    expect(r.accounts).toBe(2);
    const cred = (await admin.query("select ciphertext, key_id from nexo_private.integration_credentials where integration_id = $1", [r.integrationId])).rows[0];
    expect(cred.key_id).toBe("test1");
    expect(cred.ciphertext).not.toContain("EAA");
    const integ = (await admin.query("select status, granted_scopes from nexo.integrations where id = $1", [r.integrationId])).rows[0];
    expect(integ.status).toBe("connected");
    expect(integ.granted_scopes).toContain("ads_read");
  });

  it("el state es de un solo uso, ligado al usuario y la empresa sale del state (no de la URL)", async () => {
    installMock();
    const url = new URL(await startOAuth(ana, org.id, "google_analytics"));
    const state = url.searchParams.get("state")!;
    // Luis (otra empresa) intenta completar el flujo de Ana: rechazado y el state queda consumido.
    await expect(completeOAuth(luis, "google_analytics", new URLSearchParams({ state, code: "ok", org: orgB.id }))).rejects.toMatchObject({ code: "oauth_state_user_mismatch" });
    await expect(completeOAuth(ana, "google_analytics", new URLSearchParams({ state, code: "ok" }))).rejects.toMatchObject({ code: "oauth_state_invalid" });
    // Flujo válido: un parámetro org en la URL se ignora.
    const url2 = new URL(await startOAuth(ana, org.id, "google_analytics"));
    const res = await completeOAuth(ana, "google_analytics", new URLSearchParams({ state: url2.searchParams.get("state")!, code: "ok", org: orgB.id }));
    expect(res.organizationId).toBe(org.id);
    expect((await admin.query("select count(*)::int n from nexo.integrations where organization_id = $1", [orgB.id])).rows[0].n).toBe(0);
    // Reutilizar el callback ya consumido falla.
    await expect(completeOAuth(ana, "google_analytics", new URLSearchParams({ state: url2.searchParams.get("state")!, code: "ok" }))).rejects.toMatchObject({ code: "oauth_state_invalid" });
  });

  it("un state vencido no se acepta", async () => {
    installMock();
    const url = new URL(await startOAuth(ana, org.id, "meta_ads"));
    await admin.query("update nexo_private.oauth_states set expires_at = now() - interval '1 second' where consumed_at is null");
    await expect(completeOAuth(ana, "meta_ads", new URLSearchParams({ state: url.searchParams.get("state")!, code: "ok" }))).rejects.toMatchObject({ code: "oauth_state_expired" });
  });

  it("no se puede iniciar una conexión para otra empresa ni sin permiso", async () => {
    installMock();
    await expect(startOAuth(ana, orgB.id, "meta_ads")).rejects.toMatchObject({ code: "forbidden" });
    const viewer = await createUser("viewer-sync");
    await addMember(org.id, viewer.userId, "viewer");
    await expect(startOAuth(viewer, org.id, "meta_ads")).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("sincronización", () => {
  it("sincroniza Meta: escribe métricas, campañas, cobertura y agregados; es idempotente", async () => {
    installMock();
    const acc = await selectAccount(ana, org.id, "111", { from: "2026-10-01", to: "2026-10-10" });
    const s1 = await runSyncCycle({ workerId: "w1", enqueue: false, sleep: async () => undefined });
    expect(s1.outcomes.completed).toBe(1);
    const first = await counts(acc);
    expect(first.ads).toBe(20); // 10 días × 2 campañas
    expect(first.coverage).toBe(10);
    expect(Number(first.spend)).toBeCloseTo(20 * 100.25);
    const camp = await admin.query("select name, status from nexo.campaigns where provider_account_id = $1 order by external_id", [acc]);
    expect(camp.rows.map((r) => r.status)).toEqual(["ACTIVE", "PAUSED"]);

    // Segunda ejecución del MISMO periodo: no duplica.
    await admin.query(`insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to) values ($1, $2, 'manual', '2026-10-01', '2026-10-10')`, [org.id, acc]);
    await runSyncCycle({ workerId: "w1", enqueue: false, sleep: async () => undefined });
    expect(await counts(acc)).toEqual(first);

    const job = (await admin.query("select status, rows_written from nexo.sync_jobs where provider_account_id = $1 order by created_at desc limit 1", [acc])).rows[0];
    expect(job.status).toBe("completed");
    const run = (await admin.query("select stats from nexo.sync_runs where job_id in (select id from nexo.sync_jobs where provider_account_id = $1) order by started_at desc limit 1", [acc])).rows[0];
    expect(run.stats.provider_calls).toBeGreaterThan(0);
  });

  it("reconciliación: filas eliminadas en el proveedor desaparecen al reconsultar el periodo", async () => {
    const acc = (await admin.query("select id from nexo.provider_accounts where organization_id = $1 and external_id = '111'", [org.id])).rows[0].id;
    installMock({ metaRemovedCampaigns: new Set(["c2"]) });
    await admin.query(`insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to) values ($1, $2, 'manual', '2026-10-01', '2026-10-05')`, [org.id, acc]);
    await runSyncCycle({ workerId: "w1", enqueue: false, sleep: async () => undefined });
    const rows = await admin.query("select campaign_external_id, count(*)::int n from nexo.ad_campaign_daily where provider_account_id = $1 group by 1 order by 1", [acc]);
    // c2 solo queda en los días fuera del periodo reconsultado (06–10).
    expect(rows.rows).toEqual([{ campaign_external_id: "c1", n: 10 }, { campaign_external_id: "c2", n: 5 }]);
  });

  it("dos trabajadores no toman el mismo trabajo (lease)", async () => {
    const acc = (await admin.query("select id from nexo.provider_accounts where organization_id = $1 and external_id = '111'", [org.id])).rows[0].id;
    await admin.query(`insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to) values ($1, $2, 'manual', '2026-10-01', '2026-10-02')`, [org.id, acc]);
    // Un segundo trabajo activo para la misma cuenta está prohibido.
    const dup = await expectDbError(admin.query(`insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to) values ($1, $2, 'manual', '2026-10-01', '2026-10-02')`, [org.id, acc]));
    expect(dup.code).toBe("23505");
    const [a, b] = await Promise.all([claimJob("wA", 60), claimJob("wB", 60)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const job = (a ?? b)!;
    installMock();
    expect(await processJob(job, { workerId: a ? "wA" : "wB", sleep: async () => undefined })).toBe("completed");
  });

  it("un trabajo interrumpido se recupera desde su checkpoint sin duplicar datos", async () => {
    const acc = (await admin.query("select id from nexo.provider_accounts where organization_id = $1 and external_id = '111'", [org.id])).rows[0].id;
    const before = await counts(acc);
    await admin.query(`insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to) values ($1, $2, 'manual', '2026-09-01', '2026-09-21')`, [org.id, acc]);
    const job = (await claimJob("crashy", 60))!;
    const m1 = installMock();
    expect(await processJob(job, { workerId: "crashy", crashAfterChunks: 1, sleep: async () => undefined })).toBe("lease_lost"); // simula caída tras el bloque 1 de 3
    const mid = (await admin.query("select status, checkpoint from nexo.sync_jobs where id = $1", [job.id])).rows[0];
    expect(mid.status).toBe("running");
    expect(mid.checkpoint.nextChunk).toBe(1);
    // Pasa el lease: la recuperación lo devuelve a la cola.
    await admin.query("update nexo.sync_jobs set lease_expires_at = now() - interval '1 second' where id = $1", [job.id]);
    const m2 = installMock();
    const s = await runSyncCycle({ workerId: "w2", enqueue: false, sleep: async () => undefined });
    expect(s.recovered).toBe(1);
    expect(s.outcomes.completed).toBe(1);
    const after = await counts(acc);
    expect(after.ads).toBe(before.ads + 21 * 2);
    // La segunda ejecución no volvió a pedir el primer bloque (2026-09-01..07).
    const ranges = m2.calls.filter((c) => c.url.pathname.endsWith("/insights") && c.url.searchParams.get("level") === "campaign").map((c) => JSON.parse(c.url.searchParams.get("time_range")!).since);
    expect(ranges).not.toContain("2026-09-01");
    expect(m1.calls.length).toBeGreaterThan(0);
    const runs = await admin.query("select status, error_code from nexo.sync_runs where job_id = $1 order by started_at", [job.id]);
    expect(runs.rows.map((r) => r.error_code ?? r.status)).toEqual(["interrupted", "completed"]);
  });

  it("límite del proveedor: el trabajo se reprograma con espera y sin duplicar", async () => {
    const acc = (await admin.query("select id from nexo.provider_accounts where organization_id = $1 and external_id = '111'", [org.id])).rows[0].id;
    const before = await counts(acc);
    installMock({ failNext: [{ match: /insights/, status: 400, body: { error: { code: 17, message: "User request limit reached" } }, headers: { "x-business-use-case-usage": JSON.stringify({ "111": [{ estimated_time_to_regain_access: 30 }] }) }, times: 10 }] });
    await admin.query(`insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to) values ($1, $2, 'manual', '2026-10-01', '2026-10-03')`, [org.id, acc]);
    const s = await runSyncCycle({ workerId: "w3", enqueue: false, sleep: async () => undefined });
    expect(s.outcomes.rescheduled).toBe(1);
    const job = (await admin.query("select status, run_after > now() + interval '25 minutes' as later, error_code from nexo.sync_jobs where provider_account_id = $1 and status = 'pending'", [acc])).rows[0];
    expect(job).toMatchObject({ status: "pending", later: true });
    expect(job.error_code).toMatch(/rate_limited/);
    expect(await counts(acc)).toEqual(before);
    await admin.query("update nexo.sync_jobs set status = 'cancelled' where provider_account_id = $1 and status = 'pending'", [acc]);
  });

  it("token de Google caducado (invalid_grant): integración pasa a 'requiere reconexión' sin consultar datos", async () => {
    const r = await connect(ana, org.id, "google_analytics");
    const acc = await selectAccount(ana, org.id, "123", { from: "2026-10-01", to: "2026-10-02" });
    // Forzamos el vencimiento del access token almacenado.
    const { loadCredentials, saveCredentials } = await import("@/lib/integrations/credentials");
    const { withPrivilegedDb } = await import("@/lib/db/privileged");
    await withPrivilegedDb(async (db) => {
      const t = (await loadCredentials(db, r.integrationId, org.id))!;
      await saveCredentials(db, { integrationId: r.integrationId, organizationId: org.id, tokens: { ...t, expiresAt: new Date(Date.now() - 1000).toISOString() } });
    });
    const m = installMock({ googleRefreshInvalid: true });
    const s = await runSyncCycle({ workerId: "w4", enqueue: false, sleep: async () => undefined });
    expect(s.outcomes.failed).toBe(1);
    expect((await admin.query("select status from nexo.integrations where id = $1", [r.integrationId])).rows[0].status).toBe("needs_reauth");
    expect(m.calls.some((c) => c.url.hostname === "analyticsdata.googleapis.com")).toBe(false);
    // No se programan nuevas sincronizaciones mientras requiera reconexión.
    await admin.query("select nexo.enqueue_scheduled_sync_jobs()");
    expect((await admin.query("select count(*)::int n from nexo.sync_jobs where provider_account_id = $1 and status = 'pending'", [acc])).rows[0].n).toBe(0);
  });

  it("GA4 con renovación válida sincroniza reportes web y agregados no aditivos", async () => {
    const r = await connect(ana, org.id, "google_analytics"); // reconexión
    expect((await admin.query("select status from nexo.integrations where id = $1", [r.integrationId])).rows[0].status).toBe("connected");
    const acc = (await admin.query("select id from nexo.provider_accounts where organization_id = $1 and external_id = '123'", [org.id])).rows[0].id;
    await admin.query(`insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to) values ($1, $2, 'manual', '2026-10-01', '2026-10-03')`, [org.id, acc]);
    installMock();
    const s = await runSyncCycle({ workerId: "w5", enqueue: false, sleep: async () => undefined });
    expect(s.outcomes.completed).toBe(1);
    const web = await admin.query("select breakdown, count(*)::int n from nexo.web_daily where provider_account_id = $1 group by 1 order by 1", [acc]);
    expect(web.rows).toEqual([
      { breakdown: "campaign", n: 3 },
      { breakdown: "device", n: 6 },
      { breakdown: "landing_page", n: 6 },
      { breakdown: "source_medium", n: 6 },
      { breakdown: "total", n: 3 },
    ]);
    const flags = await admin.query("select quality_flags from nexo.data_coverage where provider_account_id = $1 and dataset = 'web_landing_page' limit 1", [acc]);
    expect(flags.rows[0].quality_flags.thresholded).toBe(true);
    const acct = (await admin.query("select currency, timezone from nexo.provider_accounts where id = $1", [acc])).rows[0];
    expect(acct).toEqual({ currency: "MXN", timezone: "America/Mexico_City" });
    // El repositorio (bajo RLS) entrega los datos a Ana pero no a Luis.
    expect((await createDbRepository(ana, org.id).load({ from: "2026-10-01", to: "2026-10-03" }, [acc])).webRows.length).toBe(24);
    expect((await createDbRepository(luis, org.id).load({ from: "2026-10-01", to: "2026-10-03" }, [acc])).webRows.length).toBe(0);
  });

  it("un usuario de otra empresa no puede disparar sincronizaciones de esta", async () => {
    const acc = (await admin.query("select id from nexo.provider_accounts where organization_id = $1 and external_id = '111'", [org.id])).rows[0].id;
    await asUser(luis, async (c) => {
      expect((await expectDbError(c.query("select nexo.request_manual_sync($1)", [acc]))).code).toBe("42501");
    });
  });

  it("límite de frecuencia de la actualización manual", async () => {
    const acc = (await admin.query("select id from nexo.provider_accounts where organization_id = $1 and external_id = '111'", [org.id])).rows[0].id;
    await admin.query("update nexo.sync_jobs set created_at = now() - interval '1 hour' where provider_account_id = $1", [acc]);
    await asUser(ana, (c) => c.query("select nexo.request_manual_sync($1)", [acc]));
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("select nexo.request_manual_sync($1)", [acc]))).message).toBe("sync_already_active");
    });
    await admin.query("update nexo.sync_jobs set status = 'completed', finished_at = now() where provider_account_id = $1 and status = 'pending'", [acc]);
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("select nexo.request_manual_sync($1)", [acc]))).message).toBe("sync_rate_limited");
    });
  });

  it("al desconectar se revoca, se eliminan credenciales y no se hacen nuevas consultas", async () => {
    const integ = (await admin.query("select id from nexo.integrations where organization_id = $1 and provider = 'meta_ads' and status = 'connected'", [org.id])).rows[0].id;
    const acc = (await admin.query("select id from nexo.provider_accounts where organization_id = $1 and external_id = '111'", [org.id])).rows[0].id;
    const before = await counts(acc);
    // Un trabajo quedó pendiente antes de desconectar.
    await admin.query("update nexo.sync_jobs set created_at = now() - interval '1 hour' where provider_account_id = $1", [acc]);
    const m = installMock();
    await expect(disconnectIntegration(luis, integ)).rejects.toMatchObject({ code: "forbidden" });
    const r = await disconnectIntegration(ana, integ);
    expect(r.revoked).toBe(true);
    expect(m.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect((await admin.query("select count(*)::int n from nexo_private.integration_credentials where integration_id = $1", [integ])).rows[0].n).toBe(0);
    // Aunque alguien inserte un trabajo a mano, el trabajador no consulta al proveedor.
    await admin.query(`insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to) values ($1, $2, 'manual', '2026-10-01', '2026-10-02')`, [org.id, acc]);
    await admin.query("update nexo.provider_accounts set is_selected = true where id = $1", [acc]);
    await admin.query("update nexo.integrations set status = 'connected' where id = $1", [integ]); // incluso con estado inconsistente
    const m2 = installMock();
    const s = await runSyncCycle({ workerId: "w6", enqueue: false, sleep: async () => undefined });
    expect(s.outcomes.failed).toBe(1);
    expect(m2.calls).toHaveLength(0);
    expect(await counts(acc)).toEqual(before); // histórico conservado
    expect((await admin.query("select status from nexo.integrations where id = $1", [integ])).rows[0].status).toBe("needs_reauth");
  });
});
