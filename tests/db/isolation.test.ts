import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, admin, asUser, createOrg, createUser, expectDbError, makePlatformAdmin, seedAdAccount, type TestUser } from "./helpers";
import { createDbRepository } from "@/lib/reports/db-repository";
import { closePool } from "@/lib/db/pool";
import { ROLE_PERMISSIONS } from "@/lib/authz/permissions";
import { sha256Hex } from "@/lib/security/crypto";

/**
 * Pruebas de aislamiento multiempresa contra PostgreSQL real (migraciones reales,
 * rol `authenticated`, RLS). Supabase Auth se sustituye por un shim mínimo de
 * auth.users/auth.uid() (tests/db/sql/supabase-auth-shim.sql).
 */

let orgA: { id: string; slug: string };
let orgB: { id: string; slug: string };
let ana: TestUser; // admin de A
let luis: TestUser; // admin de B
let pedro: TestUser; // viewer de A
let accA: { integrationId: string; accountId: string };
let accB: { integrationId: string; accountId: string };

const TENANT_TABLES = [
  "nexo.organizations",
  "nexo.organization_members",
  "nexo.invitations",
  "nexo.integrations",
  "nexo.provider_accounts",
  "nexo.campaigns",
  "nexo.ad_campaign_daily",
  "nexo.ad_campaign_daily_actions",
  "nexo.web_daily",
  "nexo.web_daily_key_events",
  "nexo.metric_snapshots",
  "nexo.data_coverage",
  "nexo.sync_jobs",
  "nexo.sync_runs",
  "nexo.audit_logs",
];

async function seedMetrics(orgId: string, accountId: string) {
  await admin.query(
    `insert into nexo.campaigns (organization_id, provider_account_id, external_id, name) values ($1, $2, 'c1', 'Campaña')`,
    [orgId, accountId],
  );
  await admin.query(
    `insert into nexo.ad_campaign_daily (organization_id, provider_account_id, campaign_external_id, date, currency, spend, impressions, clicks, link_clicks)
     values ($1, $2, 'c1', '2026-10-01', 'MXN', 100.50, 1000, 30, 20)`,
    [orgId, accountId],
  );
  await admin.query(
    `insert into nexo.ad_campaign_daily_actions (organization_id, provider_account_id, campaign_external_id, date, action_type, value)
     values ($1, $2, 'c1', '2026-10-01', 'lead', 3)`,
    [orgId, accountId],
  );
  await admin.query(
    `insert into nexo.web_daily (organization_id, provider_account_id, date, breakdown, dimension_value, sessions) values ($1, $2, '2026-10-01', 'total', '', 50)`,
    [orgId, accountId],
  );
  await admin.query(
    `insert into nexo.web_daily_key_events (organization_id, provider_account_id, date, event_name, key_events) values ($1, $2, '2026-10-01', 'generate_lead', 2)`,
    [orgId, accountId],
  );
  await admin.query(
    `insert into nexo.metric_snapshots (organization_id, provider_account_id, metric, date_from, date_to, value) values ($1, $2, 'reach', '2026-10-01', '2026-10-07', 500)`,
    [orgId, accountId],
  );
  await admin.query(
    `insert into nexo.data_coverage (organization_id, provider_account_id, dataset, date) values ($1, $2, 'ads_campaign_daily', '2026-10-01')`,
    [orgId, accountId],
  );
  const job = await admin.query<{ id: string }>(
    `insert into nexo.sync_jobs (organization_id, provider_account_id, kind, status, date_from, date_to, finished_at)
     values ($1, $2, 'initial', 'completed', '2026-10-01', '2026-10-07', now()) returning id`,
    [orgId, accountId],
  );
  await admin.query(`insert into nexo.sync_runs (job_id, organization_id, attempt, worker_id, status) values ($1, $2, 1, 'w', 'completed')`, [
    job.rows[0]!.id,
    orgId,
  ]);
  await admin.query(`insert into nexo.audit_logs (organization_id, actor_type, action) values ($1, 'system', 'test.event')`, [orgId]);
  await admin.query(
    `insert into nexo.invitations (organization_id, email, role, token_hash, expires_at) values ($1, $2, 'viewer', $3, now() + interval '1 day')`,
    [orgId, `pending-${orgId.slice(0, 6)}@test.example`, sha256Hex(`tok-${orgId}`)],
  );
}

beforeAll(async () => {
  orgA = await createOrg("Empresa A");
  orgB = await createOrg("Empresa B");
  ana = await createUser("ana");
  luis = await createUser("luis");
  pedro = await createUser("pedro");
  await addMember(orgA.id, ana.userId, "org_admin");
  await addMember(orgA.id, pedro.userId, "viewer");
  await addMember(orgB.id, luis.userId, "org_admin");
  accA = await seedAdAccount(orgA.id);
  accB = await seedAdAccount(orgB.id);
  await seedMetrics(orgA.id, accA.accountId);
  await seedMetrics(orgB.id, accB.accountId);
});

afterAll(async () => {
  await admin.end();
  await closePool();
});

describe("lectura (SELECT)", () => {
  it("Ana ve su empresa y NO ve filas de la Empresa B en ninguna tabla", async () => {
    await asUser(ana, async (c) => {
      for (const t of TENANT_TABLES) {
        const col = t === "nexo.organizations" ? "id" : "organization_id";
        const own = await c.query(`select count(*)::int n from ${t} where ${col} = $1`, [orgA.id]);
        const other = await c.query(`select count(*)::int n from ${t} where ${col} = $1`, [orgB.id]);
        expect(other.rows[0].n, `${t} filtra Empresa B`).toBe(0);
        expect(own.rows[0].n, `${t} muestra Empresa A`).toBeGreaterThan(0);
      }
    });
  });

  it("Luis no ve datos de la Empresa A", async () => {
    await asUser(luis, async (c) => {
      const r = await c.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [orgA.id]);
      expect(r.rows[0].n).toBe(0);
      const all = await c.query("select distinct organization_id from nexo.ad_campaign_daily");
      expect(all.rows.map((x) => x.organization_id)).toEqual([orgB.id]);
    });
  });

  it("las credenciales y estados OAuth son inaccesibles para usuarios", async () => {
    await asUser(ana, async (c) => {
      const e = await expectDbError(c.query("select * from nexo_private.integration_credentials"));
      expect(e.code).toBe("42501");
    });
    await asUser(ana, async (c) => {
      const e = await expectDbError(c.query("select * from nexo_private.oauth_states"));
      expect(e.code).toBe("42501");
    });
  });

  it("el hash del token de invitación no es legible ni para el administrador", async () => {
    await asUser(ana, async (c) => {
      const e = await expectDbError(c.query("select token_hash from nexo.invitations"));
      expect(e.code).toBe("42501");
    });
  });

  it("el repositorio de reportes no devuelve datos de otra empresa aunque se pidan sus IDs", async () => {
    const repo = createDbRepository(ana, orgB.id);
    const raw = await repo.load({ from: "2026-09-01", to: "2026-10-31" }, [accB.accountId]);
    expect(raw.adRows).toHaveLength(0);
    expect(raw.webRows).toHaveLength(0);
    expect(raw.accounts).toHaveLength(0);
    await expect(repo.settings()).rejects.toThrow();
  });
});

describe("escritura (INSERT / UPDATE / DELETE)", () => {
  it("no puede insertar métricas en la Empresa B (ni en la suya: solo el trabajador escribe)", async () => {
    for (const org of [orgB, orgA]) {
      const acc = org === orgB ? accB : accA;
      await asUser(ana, async (c) => {
        const e = await expectDbError(
          c.query(
            `insert into nexo.ad_campaign_daily (organization_id, provider_account_id, campaign_external_id, date, currency, spend) values ($1, $2, 'x', '2026-10-02', 'MXN', 1)`,
            [org.id, acc.accountId],
          ),
        );
        expect(e.code).toBe("42501");
      });
    }
  });

  it("no puede actualizar ni borrar filas de la Empresa B", async () => {
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("update nexo.ad_campaign_daily set spend = 0 where organization_id = $1", [orgB.id]))).code).toBe("42501");
    });
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("delete from nexo.ad_campaign_daily where organization_id = $1", [orgB.id]))).code).toBe("42501");
    });
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("delete from nexo.organization_members where organization_id = $1", [orgB.id]))).code).toBe("42501");
    });
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("update nexo.organizations set name = 'hack' where id = $1", [orgB.id]))).code).toBe("42501");
    });
    const still = await admin.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [orgB.id]);
    expect(still.rows[0].n).toBe(1);
  });

  it("no puede insertarse una membresía en otra empresa", async () => {
    await asUser(ana, async (c) => {
      const e = await expectDbError(c.query("insert into nexo.organization_members (organization_id, user_id, role) values ($1, $2, 'org_admin')", [orgB.id, ana.userId]));
      expect(e.code).toBe("42501");
    });
  });

  it("organization_id es inmutable incluso con acceso privilegiado (no se pueden apropiar registros)", async () => {
    const e = await expectDbError(admin.query("update nexo.campaigns set organization_id = $1 where organization_id = $2", [orgA.id, orgB.id]));
    expect(e.message).toMatch(/inmutable/);
    const e2 = await expectDbError(admin.query("update nexo.provider_accounts set organization_id = $1 where id = $2", [orgA.id, accB.accountId]));
    expect(e2.message).toMatch(/inmutable/);
  });

  it("las claves foráneas compuestas impiden relacionar registros de empresas distintas", async () => {
    const e = await expectDbError(
      admin.query(
        `insert into nexo.ad_campaign_daily (organization_id, provider_account_id, campaign_external_id, date, currency) values ($1, $2, 'x', '2026-10-03', 'MXN')`,
        [orgA.id, accB.accountId],
      ),
    );
    expect(e.code).toBe("23503");
    const e2 = await expectDbError(
      admin.query(`insert into nexo_private.integration_credentials (integration_id, organization_id, key_id, ciphertext) values ($1, $2, 'k', 'x')`, [
        accB.integrationId,
        orgA.id,
      ]),
    );
    expect(e2.code).toBe("23503");
  });
});

describe("roles", () => {
  it("un viewer no puede invitar, ni gestionar integraciones, ni sincronizar, ni cambiar configuración", async () => {
    await asUser(pedro, async (c) => {
      expect((await expectDbError(c.query("select nexo.create_invitation($1, 'x@test.example', 'viewer', $2)", [orgA.id, sha256Hex("p1")]))).code).toBe("42501");
    });
    await asUser(pedro, async (c) => {
      expect((await expectDbError(c.query("select nexo.set_account_selection($1, true)", [accA.accountId]))).code).toBe("42501");
    });
    await asUser(pedro, async (c) => {
      expect((await expectDbError(c.query("select nexo.request_manual_sync($1)", [accA.accountId]))).code).toBe("42501");
    });
    await asUser(pedro, async (c) => {
      expect(
        (await expectDbError(c.query("select nexo.update_organization_settings($1,'X',null,null,'UTC',null,null,null,24,7)", [orgA.id]))).code,
      ).toBe("42501");
    });
    await asUser(pedro, async (c) => {
      expect((await expectDbError(c.query("select nexo.update_member_role($1, $2, 'org_admin')", [orgA.id, pedro.userId]))).code).toBe("42501");
    });
  });

  it("un viewer no ve invitaciones, integraciones ni el registro de actividad", async () => {
    await asUser(pedro, async (c) => {
      for (const t of ["nexo.invitations", "nexo.integrations", "nexo.audit_logs", "nexo.sync_jobs"]) {
        const r = await c.query(`select count(*)::int n from ${t}`);
        expect(r.rows[0].n, t).toBe(0);
      }
      const data = await c.query("select count(*)::int n from nexo.ad_campaign_daily");
      expect(data.rows[0].n).toBeGreaterThan(0);
    });
  });

  it("un administrador no puede solicitar sincronizaciones de otra empresa", async () => {
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("select nexo.request_manual_sync($1)", [accB.accountId]))).code).toBe("42501");
    });
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("select nexo.set_account_selection($1, false)", [accB.accountId]))).code).toBe("42501");
    });
  });

  it("nadie puede auto-asignarse platform admin", async () => {
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("insert into nexo.platform_admins (user_id, granted_by) values ($1, 'yo')", [ana.userId]))).code).toBe("42501");
    });
    // Los metadatos de registro no otorgan roles.
    const meta = await admin.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('evil@test.example', '{"role":"platform_admin"}', '{"role":"platform_admin"}') returning id`,
    );
    await asUser({ userId: meta.rows[0]!.id, email: "evil@test.example" }, async (c) => {
      expect((await c.query("select nexo.is_platform_admin() ok")).rows[0].ok).toBe(false);
      expect((await c.query("select count(*)::int n from nexo.organizations")).rows[0].n).toBe(0);
    });
  });

  it("la matriz de permisos de la base de datos coincide con la de la aplicación", async () => {
    const { rows } = await admin.query<{ role: string; permission: string }>("select role, permission from nexo.role_permissions");
    const db: Record<string, string[]> = {};
    for (const r of rows) (db[r.role] ??= []).push(r.permission);
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      expect([...(db[role] ?? [])].sort(), role).toEqual([...perms].sort());
    }
    expect(Object.keys(db).sort()).toEqual(Object.keys(ROLE_PERMISSIONS).sort());
  });
});

describe("ciclo de vida de membresías y empresas", () => {
  it("un usuario retirado pierde el acceso aunque conozca los identificadores", async () => {
    const temp = await createUser("temp");
    await addMember(orgA.id, temp.userId, "analyst");
    await asUser(temp, async (c) => {
      expect((await c.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [orgA.id])).rows[0].n).toBe(1);
    });
    await asUser(ana, (c) => c.query("select nexo.remove_member($1, $2)", [orgA.id, temp.userId]));
    await asUser(temp, async (c) => {
      expect((await c.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [orgA.id])).rows[0].n).toBe(0);
      expect((await c.query("select count(*)::int n from nexo.provider_accounts where id = $1", [accA.accountId])).rows[0].n).toBe(0);
      expect((await expectDbError(c.query("select nexo.request_manual_sync($1)", [accA.accountId]))).code).toBe("42501");
    });
    const repo = createDbRepository(temp, orgA.id);
    expect((await repo.load({ from: "2026-09-01", to: "2026-10-31" }, [accA.accountId])).adRows).toHaveLength(0);
  });

  it("no se puede eliminar ni degradar al último administrador", async () => {
    await asUser(luis, async (c) => {
      const e = await expectDbError(c.query("select nexo.update_member_role($1, $2, 'viewer')", [orgB.id, luis.userId]));
      expect((e as { hint?: string }).hint).toBe("last_org_admin");
    });
    await asUser(luis, async (c) => {
      const e = await expectDbError(c.query("select nexo.remove_member($1, $2)", [orgB.id, luis.userId]));
      expect((e as { hint?: string }).hint).toBe("last_org_admin");
    });
    // También por la vía privilegiada (trigger).
    const e = await expectDbError(admin.query("delete from nexo.organization_members where organization_id = $1 and user_id = $2", [orgB.id, luis.userId]));
    expect((e as { hint?: string }).hint).toBe("last_org_admin");
  });

  it("una empresa suspendida no puede operar y conserva su histórico", async () => {
    const org = await createOrg("Suspendida");
    const u = await createUser("susp");
    const pa = await createUser("pa");
    await makePlatformAdmin(pa.userId);
    await addMember(org.id, u.userId, "org_admin");
    const acc = await seedAdAccount(org.id);
    await seedMetrics(org.id, acc.accountId);

    await asUser(pa, (c) => c.query("select nexo.platform_set_organization_status($1, 'suspended', 'Falta de pago de prueba')", [org.id]));

    await asUser(u, async (c) => {
      expect((await c.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [org.id])).rows[0].n).toBe(0);
    });
    await asUser(u, async (c) => {
      expect((await expectDbError(c.query("select nexo.request_manual_sync($1)", [acc.accountId]))).code).toBe("42501");
    });
    await asUser(u, async (c) => {
      const mine = await c.query("select status from nexo.my_organizations() where id = $1", [org.id]);
      expect(mine.rows[0].status).toBe("suspended");
    });
    await admin.query(
      `insert into nexo.sync_jobs (organization_id, provider_account_id, kind, date_from, date_to) values ($1, $2, 'manual', '2026-10-01', '2026-10-02')`,
      [org.id, acc.accountId],
    );
    const claimed = await admin.query("select * from nexo.claim_next_sync_job('w-test', 60) where organization_id = $1", [org.id]);
    expect(claimed.rows).toHaveLength(0);
    const enq = await admin.query("select nexo.enqueue_scheduled_sync_jobs() as n");
    expect(await admin.query("select count(*)::int n from nexo.sync_jobs where organization_id = $1 and kind = 'scheduled'", [org.id]).then((r) => r.rows[0].n)).toBe(0);
    expect(enq.rows).toHaveLength(1);
    const kept = await admin.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [org.id]);
    expect(kept.rows[0].n).toBe(1);

    await asUser(pa, (c) => c.query("select nexo.platform_set_organization_status($1, 'active', null)", [org.id]));
    await asUser(u, async (c) => {
      expect((await c.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [org.id])).rows[0].n).toBe(1);
    });
  });

  it("el platform admin no lee datos de clientes salvo con sesión de soporte explícita y auditada", async () => {
    const pa = await createUser("pa2");
    await makePlatformAdmin(pa.userId);
    await asUser(pa, async (c) => {
      expect((await c.query("select count(*)::int n from nexo.organizations where id = $1", [orgA.id])).rows[0].n).toBe(1);
      expect((await c.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [orgA.id])).rows[0].n).toBe(0);
    });
    const sid = await asUser(pa, async (c) => (await c.query("select nexo.start_support_session($1, 'Revisión solicitada por el cliente', 30) id", [orgA.id])).rows[0].id);
    await asUser(pa, async (c) => {
      expect((await c.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [orgA.id])).rows[0].n).toBe(1);
      expect((await c.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [orgB.id])).rows[0].n).toBe(0);
      // Soporte es solo lectura.
      expect((await expectDbError(c.query("select nexo.request_manual_sync($1)", [accA.accountId]))).code).toBe("42501");
    });
    await asUser(ana, async (c) => {
      const log = await c.query("select count(*)::int n from nexo.audit_logs where organization_id = $1 and action = 'support.session_started'", [orgA.id]);
      expect(log.rows[0].n).toBeGreaterThan(0);
      const visible = await c.query("select count(*)::int n from nexo.support_sessions where id = $1", [sid]);
      expect(visible.rows[0].n).toBe(1);
    });
    await asUser(pa, (c) => c.query("select nexo.end_support_session($1)", [sid]));
    await asUser(pa, async (c) => {
      expect((await c.query("select count(*)::int n from nexo.ad_campaign_daily where organization_id = $1", [orgA.id])).rows[0].n).toBe(0);
    });
  });
});

describe("invitaciones", () => {
  async function invite(by: TestUser, orgId: string, email: string, role = "viewer", ttl = 24) {
    const token = `token-${Math.random()}`;
    await asUser(by, (c) => c.query("select nexo.create_invitation($1, $2, $3, $4, $5)", [orgId, email, role, sha256Hex(token), ttl]));
    return token;
  }

  it("una invitación válida se acepta una sola vez y solo por el correo invitado", async () => {
    const invited = await createUser("inv");
    const other = await createUser("other");
    const token = await invite(ana, orgA.id, invited.email, "analyst");

    await asUser(other, async (c) => {
      const e = await expectDbError(c.query("select nexo.accept_invitation($1)", [sha256Hex(token)]));
      expect(e.message).toBe("invitation_email_mismatch");
    });
    const org = await asUser(invited, async (c) => (await c.query("select nexo.accept_invitation($1) org", [sha256Hex(token)])).rows[0].org);
    expect(org).toBe(orgA.id);
    await asUser(invited, async (c) => {
      const e = await expectDbError(c.query("select nexo.accept_invitation($1)", [sha256Hex(token)]));
      expect(e.message).toBe("invitation_used");
    });
    const role = await admin.query("select role from nexo.organization_members where organization_id = $1 and user_id = $2", [orgA.id, invited.userId]);
    expect(role.rows[0].role).toBe("analyst");
  });

  it("las invitaciones vencidas o revocadas no se pueden usar", async () => {
    const u1 = await createUser("exp");
    const t1 = await invite(ana, orgA.id, u1.email);
    await admin.query("update nexo.invitations set expires_at = now() - interval '1 minute' where token_hash = $1", [sha256Hex(t1)]);
    await asUser(u1, async (c) => {
      expect((await expectDbError(c.query("select nexo.accept_invitation($1)", [sha256Hex(t1)]))).message).toBe("invitation_expired");
    });

    const u2 = await createUser("rev");
    const t2 = await invite(ana, orgA.id, u2.email);
    const id = (await admin.query("select id from nexo.invitations where token_hash = $1", [sha256Hex(t2)])).rows[0].id;
    await asUser(ana, (c) => c.query("select nexo.revoke_invitation($1)", [id]));
    await asUser(u2, async (c) => {
      expect((await expectDbError(c.query("select nexo.accept_invitation($1)", [sha256Hex(t2)]))).message).toBe("invitation_revoked");
    });
  });

  it("un administrador no puede crear invitaciones para otra empresa", async () => {
    await asUser(ana, async (c) => {
      expect((await expectDbError(c.query("select nexo.create_invitation($1, 'z@test.example', 'org_admin', $2)", [orgB.id, sha256Hex("zz")]))).code).toBe("42501");
    });
  });
});
