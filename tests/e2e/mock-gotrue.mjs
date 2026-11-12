/**
 * DOBLE DE PRUEBA de Supabase Auth (GoTrue) para Playwright. Solo implementa
 * los endpoints que usa la app (token por contraseña/refresh, user, logout,
 * recover, admin/users) y guarda usuarios en la tabla auth.users de la base de
 * datos de pruebas. NO es Supabase Auth: valida el cableado de la app (cookies,
 * proxy, guardas, RLS), no el comportamiento real del proveedor.
 */
import http from "node:http";
import { createHash, createHmac, randomUUID } from "node:crypto";
import pg from "pg";

const PORT = Number(process.env.MOCK_GOTRUE_PORT ?? 54999);
const SECRET = "e2e-jwt-secret-solo-pruebas";
const pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL });
const refreshTokens = new Map();
const revoked = new Set();

const b64u = (b) => Buffer.from(b).toString("base64url");
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
function verify(token) {
  const [h, p, s] = (token ?? "").split(".");
  if (!h || !p || !s) return null;
  if (createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (payload.exp * 1000 < Date.now() || revoked.has(payload.session_id)) return null;
  return payload;
}
const hash = (pw) => createHash("sha256").update(`e2e:${pw}`).digest("hex");
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString() });

function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const session_id = randomUUID();
  const access_token = sign({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id });
  const refresh_token = randomUUID();
  refreshTokens.set(refresh_token, u);
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token, user: userJson(u) };
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    try {
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
        const { rows } = await pool.query("select id, email, encrypted_password from auth.users where lower(email) = lower($1)", [body.email]);
        const u = rows[0];
        if (!u || u.encrypted_password !== hash(body.password)) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        return send(res, 200, session(u));
      }
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
        const u = refreshTokens.get(body.refresh_token);
        if (!u) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        refreshTokens.delete(body.refresh_token);
        return send(res, 200, session(u));
      }
      if (url.pathname === "/auth/v1/user" && req.method === "GET") {
        const p = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
        if (!p) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
        return send(res, 200, userJson({ id: p.sub, email: p.email }));
      }
      if (url.pathname === "/auth/v1/logout") {
        const p = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
        if (p) revoked.add(p.session_id);
        res.writeHead(204).end();
        return;
      }
      if (url.pathname === "/auth/v1/recover") return send(res, 200, {});
      if (url.pathname === "/auth/v1/admin/users" && req.method === "POST") {
        if (req.headers.apikey !== "sb_secret_e2e") return send(res, 401, { msg: "invalid api key" });
        const { rows } = await pool.query("insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values (lower($1), $2, now(), $3) returning id, email", [body.email, hash(body.password), body.user_metadata ?? {}]);
        return send(res, 200, userJson(rows[0]));
      }
      send(res, 404, { msg: `mock-gotrue: ruta no implementada ${req.method} ${url.pathname}` });
    } catch (err) {
      send(res, 500, { msg: String(err) });
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock-gotrue escuchando en ${PORT}`));

export { hash };
