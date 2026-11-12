import { z } from "zod";

/**
 * Variables de entorno.
 * - Las que empiezan con NEXT_PUBLIC_ se incrustan en el navegador: NUNCA pongas secretos ahí.
 * - Todas las demás son exclusivamente de servidor.
 * Documentación completa: docs/variables-de-entorno.md
 */

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  SUPABASE_SECRET_KEY: optionalString,
  DATABASE_URL: optionalString,
  DATABASE_SSL: z.enum(["require", "disable", "no-verify"]).default("require"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  TOKEN_ENCRYPTION_KEYS: optionalString,
  TOKEN_ENCRYPTION_ACTIVE_KEY_ID: optionalString,
  CRON_SECRET: optionalString,
  DEMO_MODE_ENABLED: z.enum(["true", "false"]).optional(),
  GOOGLE_OAUTH_CLIENT_ID: optionalString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalString,
  GOOGLE_OAUTH_USE_PKCE: z.enum(["true", "false"]).default("true"),
  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d{2}\.0$/)
    .default("v25.0"),
  /** Opcional: configuración de "Facebook Login for Business" (config_id). Si se define, sustituye a `scope`. */
  META_LOGIN_CONFIG_ID: optionalString.refine((v) => v === undefined || /^\d{5,30}$/.test(v), "Debe ser numérico"),
  META_ASYNC_POLL_TIMEOUT_MS: z.coerce.number().int().min(10000).max(3600000).default(600000),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: optionalString,
  SYNC_WORKER_ID: optionalString,
  SYNC_LEASE_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  SYNC_CRON_TIME_BUDGET_MS: z.coerce.number().int().min(5000).max(800000).default(50000),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  // Variables vacías ("VAR=") se tratan como no definidas para aplicar los valores por defecto.
  const source = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuración de entorno inválida: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Solo para pruebas. */
export function resetEnvCache() {
  cached = null;
}

export function isDemoEnabled(): boolean {
  const env = serverEnv();
  if (env.DEMO_MODE_ENABLED) return env.DEMO_MODE_ENABLED === "true";
  return env.NODE_ENV !== "production" || !isAuthConfigured();
}

export function isAuthConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && env.DATABASE_URL);
}

export function isEmailConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.SMTP_HOST && env.SMTP_FROM);
}
