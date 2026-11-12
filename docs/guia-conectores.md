# Añadir un conector

1. **Implementa `Connector`** (`src/lib/integrations/contract.ts`) en `src/lib/integrations/<proveedor>/connector.ts`:
   - `descriptor` con capacidades **reales** (`refresh_token` solo si existe; `long_lived_token` si requiere reconexión manual; `token_revocation`, `period_snapshots`, `async_reports`…).
   - `allowedHosts`: lista cerrada de hosts del proveedor. El cliente HTTP (`http.ts`) rechaza cualquier otro host, HTTP sin TLS y redirecciones. No construyas un "conector universal".
   - `configStatus`, `buildAuthorizationUrl` (state, PKCE si el proveedor lo documenta), `exchangeCode`, `refreshTokens?`, `listAccounts`, `validateAccount`, `planChunks`, `fetchChunk`, `fetchSnapshots?`, `revoke?`.
   - Valida respuestas con Zod; clasifica errores con `ProviderError` (`auth`, `rate_limited` con `retryAfterMs`, `transient`, `permission`, `too_much_data`, `invalid_request`). Los mensajes se depuran de secretos automáticamente.
   - Distingue "sin filas" (cero real, se registra cobertura) de "error" (no se escribe nada).
2. **Regístralo** en `src/lib/integrations/registry.ts` y retíralo de `PLANNED_SOURCES`. Añade su `provider` a `SourceId` si alimenta reportes.
3. **Datos**: si encaja en una familia existente (`ads` → `ad_campaign_daily`, `web` → `web_daily`), devuelve ese `ChunkData`. Si es un tipo nuevo (p. ej. orgánico social), crea una **migración** con su tabla (con `organization_id`, FK compuesta a `provider_accounts`, PK natural para idempotencia, RLS `reports.view`, solo `SELECT` para `authenticated`) y un escritor en `src/lib/sync/writers.ts` que sustituya el rango consultado y registre `data_coverage`. No fuerces datos a una tabla universal.
4. **Métricas**: añade definiciones en `src/lib/metrics/definitions.ts` (definición, fuente, fórmula, límites, si es aditiva) y su cálculo en `src/lib/reports/builder.ts`. No sumes resultados de fuentes distintas ni monedas distintas.
5. **Pruebas**: simulador de respuestas en `tests/support/provider-mocks.ts`, pruebas unitarias del conector (paginación, errores, límites) y de integración del motor (`tests/db/sync.test.ts`).
6. **Documentación**: guía de configuración con redirect URI `APP_URL/api/integrations/<provider>/callback`, permisos mínimos, revisión de la app y fuentes oficiales.

Mientras no esté implementado, el módulo aparece como **Próximamente** sin botón de conexión.
