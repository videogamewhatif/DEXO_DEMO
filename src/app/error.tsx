"use client";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="contenido" className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Algo salió mal</h1>
      <p className="mt-2 text-muted">Ocurrió un error inesperado. Inténtalo de nuevo; si persiste, contacta a soporte.</p>
      <button onClick={reset} className="mt-6 min-h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-fg">Reintentar</button>
    </main>
  );
}
