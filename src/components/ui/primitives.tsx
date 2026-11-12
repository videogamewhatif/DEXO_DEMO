import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 min-h-10";
export const buttonStyles = {
  primary: `${btnBase} bg-brand text-brand-fg hover:brightness-110`,
  secondary: `${btnBase} border border-line bg-surface text-fg hover:bg-surface-2`,
  danger: `${btnBase} border border-danger/40 bg-surface text-danger hover:bg-danger/10`,
  ghost: `${btnBase} text-fg hover:bg-surface-2`,
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return <button {...props} className={cx(buttonStyles[variant], className)} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link {...props} className={cx(buttonStyles[variant], className)} />;
}

export function Card({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx("min-w-0 rounded-lg border border-line bg-surface p-4 sm:p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "brand";
const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  ok: "bg-ok/10 text-ok border-ok/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  info: "bg-info/10 text-info border-info/30",
  brand: "bg-brand/10 text-brand border-brand/30",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", toneClasses[tone])}>{children}</span>;
}

export function Alert({ tone = "info", title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2.5 text-sm", toneClasses[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface p-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Ayuda breve accesible (definición, fuente, límites). */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group relative inline-block align-middle">
      <summary aria-label={`Ayuda: ${label}`} className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-line text-[11px] font-semibold text-muted hover:bg-surface-2">
        ?
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-72 rounded-md border border-line bg-surface p-3 text-left text-xs font-normal leading-relaxed text-fg shadow-lg sm:w-80">
        {children}
      </div>
    </details>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputClass = "min-h-10 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted";

export function ComingSoon({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface p-4" aria-label={`${name}: próximamente`}>
      <div>
        <p className="font-medium">{name}</p>
        <p className="mt-0.5 text-sm text-muted">{description}</p>
      </div>
      <Badge>Próximamente</Badge>
    </div>
  );
}
