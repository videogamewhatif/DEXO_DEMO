import { ProviderError, parseRetryAfter } from "./errors";

/**
 * Cliente HTTP restringido por conector. NO es un proxy genérico:
 * - solo HTTPS,
 * - solo a los hosts declarados por el conector,
 * - sin seguir redirecciones,
 * - con tiempo de espera,
 * - y sin registrar URLs ni cuerpos (pueden contener tokens).
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

export interface ProviderHttp {
  request<T = unknown>(
    method: "GET" | "POST" | "DELETE",
    url: string,
    options?: { query?: Record<string, string | undefined>; form?: Record<string, string>; json?: unknown; headers?: Record<string, string> },
  ): Promise<HttpResponse<T>>;
  readonly calls: number;
}

export function createProviderHttp(opts: {
  provider: string;
  allowedHosts: readonly string[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): ProviderHttp {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let calls = 0;

  return {
    get calls() {
      return calls;
    },
    async request<T>(method: "GET" | "POST" | "DELETE", rawUrl: string, options: Parameters<ProviderHttp["request"]>[2] = {}) {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || !opts.allowedHosts.includes(url.hostname)) {
        throw new ProviderError("invalid_request", opts.provider, `Destino no permitido para ${opts.provider}: ${url.hostname}`);
      }
      for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);

      const headers: Record<string, string> = { Accept: "application/json", ...(options.headers ?? {}) };
      let body: string | undefined;
      if (options.form) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = new URLSearchParams(options.form).toString();
      } else if (options.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.json);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      calls += 1;
      try {
        res = await fetchImpl(url.toString(), { method, headers, body, redirect: "manual", signal: controller.signal, cache: "no-store" });
      } catch (err) {
        const aborted = err instanceof Error && err.name === "AbortError";
        throw new ProviderError("transient", opts.provider, aborted ? "Tiempo de espera agotado" : "Error de red al contactar al proveedor");
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { _nonJson: true };
        }
      }
      if (res.status >= 300 && res.status < 400) {
        throw new ProviderError("invalid_request", opts.provider, `Redirección inesperada (${res.status})`, { status: res.status });
      }
      const result = { status: res.status, headers: res.headers, body: parsed as T };
      if (res.status === 429) {
        // El conector puede reinterpretar el cuerpo; aquí se deja un default seguro.
        (result as HttpResponse & { retryAfterMs?: number }).retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      }
      return result;
    },
  };
}
