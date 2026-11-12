"use client";
import { useRouter, usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PRESET_LABELS } from "@/lib/metrics/periods";
import { inputClass } from "@/components/ui/primitives";

export interface FilterAccountOption {
  id: string;
  name: string;
  provider: "meta_ads" | "google_analytics";
}

const PROVIDER_LABEL = { meta_ads: "Meta Ads", google_analytics: "GA4" } as const;

export function FilterBar(props: {
  preset: string;
  from: string;
  to: string;
  compare: boolean;
  source: string;
  accountIds: string[];
  accounts: FilterAccountOption[];
  showSource?: boolean;
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [preset, setPreset] = useState(props.preset);
  const [from, setFrom] = useState(props.from);
  const [to, setTo] = useState(props.to);
  const [compare, setCompare] = useState(props.compare);
  const [source, setSource] = useState(props.source);
  const [accounts, setAccounts] = useState<string[]>(props.accountIds);

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    q.set("preset", preset);
    if (preset === "custom") {
      q.set("from", from);
      q.set("to", to);
    }
    if (!compare) q.set("compare", "0");
    if (source !== "all") q.set("source", source);
    for (const a of accounts) q.append("account", a);
    router.push(`${pathname}?${q.toString()}`);
  }

  const visibleAccounts = props.accounts.filter((a) => source === "all" || a.provider === source);

  return (
    <form onSubmit={submit} className="mb-5 rounded-lg border border-line bg-surface p-3" aria-label="Filtros del reporte">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="f-preset" className="text-xs font-medium text-muted">Periodo</label>
          <select id="f-preset" className={inputClass} value={preset} onChange={(e) => setPreset(e.target.value)}>
            {Object.entries(PRESET_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-from" className="text-xs font-medium text-muted">Desde</label>
          <input id="f-from" type="date" className={inputClass} value={from} max={props.today}
            onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="f-to" className="text-xs font-medium text-muted">Hasta</label>
          <input id="f-to" type="date" className={inputClass} value={to} max={props.today}
            onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} />
        </div>
        {props.showSource !== false ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="f-source" className="text-xs font-medium text-muted">Fuente</label>
            <select id="f-source" className={inputClass} value={source} onChange={(e) => { setSource(e.target.value); setAccounts([]); }}>
              <option value="all">Todas</option>
              <option value="meta_ads">Meta Ads</option>
              <option value="google_analytics">Google Analytics 4</option>
            </select>
          </div>
        ) : <div />}
        <fieldset className="flex flex-col gap-1">
          <legend className="text-xs font-medium text-muted">Cuentas</legend>
          <details className="relative">
            <summary className={`${inputClass} flex items-center justify-between`}>
              <span>{accounts.length === 0 ? "Todas" : `${accounts.length} seleccionada(s)`}</span>
              <span aria-hidden>▾</span>
            </summary>
            <div className="absolute z-20 mt-1 max-h-64 w-72 overflow-auto rounded-md border border-line bg-surface p-2 shadow-lg">
              {visibleAccounts.length === 0 && <p className="p-2 text-sm text-muted">No hay cuentas.</p>}
              {visibleAccounts.map((a) => (
                <label key={a.id} className="flex items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2">
                  <input type="checkbox" className="mt-0.5" checked={accounts.includes(a.id)}
                    onChange={(e) => setAccounts((prev) => (e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id)))} />
                  <span><span className="font-medium">{a.name}</span> <span className="text-muted">· {PROVIDER_LABEL[a.provider]}</span></span>
                </label>
              ))}
            </div>
          </details>
        </fieldset>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            Comparar con periodo anterior
          </label>
          <button type="submit" className="min-h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">Aplicar</button>
        </div>
      </div>
    </form>
  );
}
