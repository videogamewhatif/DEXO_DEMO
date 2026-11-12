"use client";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export interface ActionState {
  ok: boolean;
  message: string | null;
  /** Dato adicional que debe mostrarse una sola vez (p. ej. enlace de invitación no enviado). */
  detail?: string | null;
}

export const initialActionState: ActionState = { ok: false, message: null };

export function SubmitButton({ children, variant = "primary", disabledReason }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; disabledReason?: string }) {
  const { pending } = useFormStatus();
  const cls =
    variant === "primary"
      ? "bg-brand text-brand-fg hover:brightness-110"
      : variant === "danger"
        ? "border border-danger/40 text-danger hover:bg-danger/10"
        : "border border-line hover:bg-surface-2";
  return (
    <button type="submit" disabled={pending || Boolean(disabledReason)} title={disabledReason} aria-disabled={pending || Boolean(disabledReason)}
      className={`inline-flex min-h-10 items-center justify-center rounded-md px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}>
      {pending ? "Procesando…" : children}
    </button>
  );
}

export function ActionForm({ action, children, className }: { action: (prev: ActionState, data: FormData) => Promise<ActionState>; children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, initialActionState);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.message && (
        <p role={state.ok ? "status" : "alert"} className={`mt-2 text-sm ${state.ok ? "text-ok" : "text-danger"}`}>
          {state.message}
        </p>
      )}
      {state.detail && (
        <div className="mt-2 rounded border border-line bg-surface-2 p-2 text-xs">
          <label className="block font-medium" htmlFor="action-detail">Enlace para compartir manualmente (se muestra una sola vez):</label>
          <input id="action-detail" readOnly value={state.detail} className="mt-1 w-full rounded border border-line bg-surface px-2 py-1 font-mono" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </form>
  );
}
