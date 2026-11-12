import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import { requirePlatformAdmin } from "@/lib/platform/admin";
import { withUserDb } from "@/lib/db/user-db";
import { ROLE_LABELS, type OrgRole } from "@/lib/authz/permissions";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Usuarios" };

export default async function Page() {
  const identity = await requirePlatformAdmin();
  const users = await withUserDb(identity, async (db) =>
    (
      await db.query(
        `select p.id, p.email, p.full_name, p.created_at,
                exists (select 1 from nexo.platform_admins pa where pa.user_id = p.id) as is_admin,
                coalesce(json_agg(json_build_object('org', o.name, 'role', m.role, 'status', o.status)) filter (where o.id is not null), '[]') as memberships
           from nexo.profiles p
           left join nexo.organization_members m on m.user_id = p.id
           left join nexo.organizations o on o.id = m.organization_id
          group by p.id order by p.email limit 500`,
      )
    ).rows,
  );
  return (
    <>
      <PageHeader title="Usuarios" description="Cuentas y sus membresías. Las contraseñas las gestiona Supabase Auth; aquí no se almacenan. El rol de plataforma solo se asigna con el procedimiento documentado (docs/primer-administrador.md)." />
      <Card>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Usuarios">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted"><tr><th className="p-2">Usuario</th><th className="p-2">Alta</th><th className="p-2">Empresas</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line align-top">
                  <td className="p-2"><p className="font-medium">{u.full_name ?? u.email}</p><p className="text-xs text-muted">{u.email}</p>{u.is_admin && <Badge tone="warn">Platform admin</Badge>}</td>
                  <td className="p-2">{formatDate(u.created_at.toISOString().slice(0, 10))}</td>
                  <td className="p-2">
                    {(u.memberships as Array<{ org: string; role: OrgRole; status: string }>).length === 0 ? <span className="text-muted">Sin empresas</span> :
                      <ul className="space-y-0.5">{(u.memberships as Array<{ org: string; role: OrgRole; status: string }>).map((m, i) => <li key={i}>{m.org} · {ROLE_LABELS[m.role]}{m.status === "suspended" && " (suspendida)"}</li>)}</ul>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
