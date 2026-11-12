import { setDemoRole } from "@/app/demo/actions";
import { ROLE_LABELS, ORG_ROLES, type OrgRole } from "@/lib/authz/permissions";
import { DemoRoleSelect } from "./DemoRoleSelect";

export function DemoBanner({ role }: { role: OrgRole }) {
  return (
    <div className="border-b border-warn/50 bg-warn/15 px-4 py-2 text-sm" role="region" aria-label="Aviso de demostración">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2">
        <p>
          <strong>Datos de demostración.</strong> Empresas, cuentas y cifras ficticias generadas en memoria. Nada se guarda ni se conecta con Google o Meta.
        </p>
        <form action={setDemoRole} className="flex items-center gap-2">
          <label htmlFor="demo-role" className="text-xs">Simular rol (solo visual):</label>
          <DemoRoleSelect id="demo-role" defaultValue={role} options={ORG_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
        </form>
      </div>
    </div>
  );
}
