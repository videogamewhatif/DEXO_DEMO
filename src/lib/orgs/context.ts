import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { withUserDb } from "@/lib/db/user-db";
import type { SessionIdentity } from "@/lib/db/types";
import { requireIdentity } from "@/lib/auth/session";
import type { EffectiveRole } from "@/lib/authz/permissions";

export interface MyOrg {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  role: EffectiveRole;
  logoUrl: string | null;
  access: "member" | "support";
}

export interface OrgDetails {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  displayCurrency: string | null;
  logoUrl: string | null;
  ga4LeadEventName: string | null;
  metaLeadActionType: string | null;
  metaPurchaseActionType: string | null;
  syncFrequencyHours: number;
  attributionRefreshDays: number;
  initialImportDays: number;
}

export const getMyOrganizations = cache(async (identity: SessionIdentity): Promise<MyOrg[]> =>
  withUserDb(identity, async (db) => {
    const { rows } = await db.query<{ id: string; name: string; slug: string; status: MyOrg["status"]; role: EffectiveRole; logo_url: string | null; access: MyOrg["access"] }>(
      "select * from nexo.my_organizations()",
    );
    return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, status: r.status, role: r.role, logoUrl: r.logo_url, access: r.access }));
  }),
);

export const getIsPlatformAdmin = cache(async (identity: SessionIdentity): Promise<boolean> =>
  withUserDb(identity, async (db) => (await db.query<{ ok: boolean }>("select nexo.is_platform_admin() as ok")).rows[0]?.ok === true),
);

export interface OrgContext {
  identity: SessionIdentity;
  org: MyOrg;
  orgs: MyOrg[];
  isPlatformAdmin: boolean;
}

/** Resuelve la empresa por slug SOLO entre las empresas del usuario. Si no es miembro: 404. */
export const requireOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const identity = await requireIdentity(`/app/${slug}`);
  const [orgs, isPlatformAdmin] = await Promise.all([getMyOrganizations(identity), getIsPlatformAdmin(identity)]);
  const org = orgs.find((o) => o.slug === slug);
  if (!org) notFound();
  return { identity, org, orgs, isPlatformAdmin };
});

export async function getOrgDetails(identity: SessionIdentity, orgId: string): Promise<OrgDetails | null> {
  return withUserDb(identity, async (db) => {
    const { rows } = await db.query(
      `select id, name, slug, timezone, display_currency, logo_url, ga4_lead_event_name, meta_lead_action_type, meta_purchase_action_type,
              sync_frequency_hours, attribution_refresh_days, initial_import_days
         from nexo.organizations where id = $1`,
      [orgId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      timezone: r.timezone,
      displayCurrency: r.display_currency,
      logoUrl: r.logo_url,
      ga4LeadEventName: r.ga4_lead_event_name,
      metaLeadActionType: r.meta_lead_action_type,
      metaPurchaseActionType: r.meta_purchase_action_type,
      syncFrequencyHours: r.sync_frequency_hours,
      attributionRefreshDays: r.attribution_refresh_days,
      initialImportDays: r.initial_import_days,
    };
  });
}
