/** Configuración de entorno para pruebas de integración con PostgreSQL real. */
export const TEST_DB_ADMIN_URL = process.env.TEST_DB_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? "nexo_test";
export const TEST_DATABASE_URL = TEST_DB_ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB_NAME}`);

export function applyTestEnv() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL: "http://localhost:3000",
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_SSL: "disable",
    // Clave de prueba (32 bytes en base64). Solo para pruebas.
    TOKEN_ENCRYPTION_KEYS: "test1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "test1",
    GOOGLE_OAUTH_CLIENT_ID: "test-google-client.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-google-secret",
    META_APP_ID: "1234567890",
    META_APP_SECRET: "test-meta-secret",
    META_GRAPH_API_VERSION: "v25.0",
  });
}
