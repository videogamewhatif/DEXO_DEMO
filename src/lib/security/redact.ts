/**
 * Elimina secretos de textos que podrían terminar en logs, errores persistidos
 * o la interfaz. Se aplica a todo mensaje de error de proveedores.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/([?&](?:access_token|refresh_token|client_secret|code|appsecret_proof|fb_exchange_token|token|code_verifier)=)[^&\s"']+/gi, "$1[REDACTADO]"],
  [/("(?:access_token|refresh_token|client_secret|id_token|code|appsecret_proof|code_verifier)"\s*:\s*")[^"]*(")/gi, "$1[REDACTADO]$2"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTADO]"],
  [/\bya29\.[A-Za-z0-9._-]+/g, "[REDACTADO]"],
  [/\b1\/\/[A-Za-z0-9._-]{10,}/g, "[REDACTADO]"],
  [/\bEAA[A-Za-z0-9]{20,}/g, "[REDACTADO]"],
  [/\bsb_secret_[A-Za-z0-9_-]+/g, "[REDACTADO]"],
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function safeErrorMessage(err: unknown, max = 500): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Error desconocido";
  return redactSecrets(raw).slice(0, max);
}
