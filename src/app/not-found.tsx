import { LinkButton } from "@/components/ui/primitives";
export default function NotFound() {
  return (
    <main id="contenido" className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Página no encontrada</h1>
      <p className="mt-2 text-muted">La página no existe o no tienes acceso a ella.</p>
      <div className="mt-6 flex justify-center"><LinkButton href="/app">Ir a mis empresas</LinkButton></div>
    </main>
  );
}
