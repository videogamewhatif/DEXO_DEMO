"use client";
export function DemoRoleSelect({ id, defaultValue, options }: { id: string; defaultValue: string; options: Array<{ value: string; label: string }> }) {
  return (
    <>
      <select id={id} name="role" defaultValue={defaultValue} className="min-h-9 rounded border border-line bg-surface px-2 text-sm"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <noscript><button type="submit" className="rounded border px-2">Aplicar</button></noscript>
    </>
  );
}
