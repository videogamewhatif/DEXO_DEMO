export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">Cargando…</span>
      <div className="h-8 w-48 animate-pulse rounded bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2" />)}</div>
    </div>
  );
}
