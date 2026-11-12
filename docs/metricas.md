# Métricas, fórmulas y reglas de calidad de datos

Definiciones de la interfaz: `src/lib/metrics/definitions.ts` (cada KPI tiene ayuda con definición, fuente, fórmula y límites). Cálculo: `src/lib/reports/builder.ts`. Pruebas: `tests/unit/metrics.test.ts`.

## Estados de un valor

| Estado | Significado | Se muestra |
| --- | --- | --- |
| valor | Número calculado (puede ser cero real) | El número; si la cobertura es parcial, aviso "Datos incompletos: X de Y días-cuenta" |
| sin datos | Ningún día del periodo fue sincronizado | "Sin datos" |
| pendiente | La cuenta está seleccionada y su primera importación no terminó | "Pendiente" |
| no disponible | La fuente no ofrece la métrica o no puede agregarse correctamente | "No disponible" + motivo |
| indefinido | Ratio con denominador cero | "—" + explicación |

Un día consultado con éxito sin filas es **cero real** (los proveedores omiten filas en cero). Un día no consultado es **ausente** y aparece como hueco en las gráficas. Los errores nunca se convierten en ceros: si una consulta falla, no se escribe nada.

## Publicidad (Meta Ads) — por moneda de cuenta

| Indicador | Fórmula / campo | Unidad |
| --- | --- | --- |
| Inversión | Σ `spend` | moneda de la cuenta |
| Impresiones | Σ `impressions` | conteo |
| Clics (todos) | Σ `clicks` | conteo |
| Clics en enlaces | Σ `inline_link_clicks` | conteo |
| CTR (enlaces) | Σ clics en enlaces ÷ Σ impresiones | % |
| CPC (enlaces) | Σ inversión ÷ Σ clics en enlaces | moneda |
| CPM | Σ inversión ÷ Σ impresiones × 1 000 | moneda |
| Prospectos (Meta) | Σ `actions.value` del tipo configurado (uno solo) | conteo |
| Costo por prospecto | Σ inversión ÷ prospectos (Meta) | moneda |
| Valor de conversión atribuido | Σ `action_values.value` del tipo de compra configurado | moneda |
| ROAS atribuido | Valor atribuido ÷ inversión | × (no es ROI) |
| Alcance | `reach` consultado para el periodo exacto, una cuenta | personas estimadas (no aditivo) |

## Sitio web (GA4) — por propiedad o sumando propiedades cuando es aditivo

| Indicador | Fórmula / campo |
| --- | --- |
| Sesiones | Σ `sessions` |
| Sesiones con interacción | Σ `engagedSessions` |
| Tasa de interacción | Σ con interacción ÷ Σ sesiones |
| Vistas de página | Σ `screenPageViews` |
| Eventos clave | Σ `keyEvents` |
| Prospectos (GA4) | Σ `keyEvents` del evento configurado |
| Usuarios | `totalUsers` del periodo exacto (presets 7/28/90 y periodo anterior) o de un solo día, para una sola propiedad |

## Reglas aplicadas

1. Conversiones de GA4 y resultados de Meta **nunca** se suman: se muestran en bloques separados con aviso.
2. Se conserva fuente, definición y `attribution_setting` (mostrado en el dashboard y exportado).
3. Clics totales y clics en enlaces son métricas separadas; CTR y CPC usan clics en enlaces.
4. Sesiones y usuarios son métricas separadas.
5. Usuarios y alcance **no se suman** entre días, cuentas ni plataformas: solo agregados exactos del proveedor.
6–8. No se suman monedas. Moneda y zona horaria se guardan por cuenta. Sin conversión de divisas, los resultados se muestran por moneda.
9–10. Ausente ≠ cero ≠ pendiente ≠ no compatible (tabla de estados).
11. Ratios desde componentes (ponderados), nunca promedio de ratios diarios.
12. División segura con estado "indefinido".
13. Frescura visible: última sincronización por cuenta y la más antigua.
14. Base cero en comparaciones: "Nuevo" o "Sin cambio", nunca porcentajes infinitos.
15. Campañas y cuentas se calculan desde la misma tabla de nivel campaña; no se combinan totales de cuenta con totales de campaña.

Comparación: periodo inmediatamente anterior de igual duración (`previousPeriod`). Presets "últimos N días" terminan ayer (días completos). Fechas en la zona horaria de cada cuenta.
