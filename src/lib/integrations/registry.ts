import type { Connector, ConnectorCategory, ProviderId } from "./contract";
import { ga4Connector } from "./ga4/connector";
import { metaAdsConnector } from "./meta/connector";

/**
 * Registro de conectores. Para añadir una fuente: implementar `Connector`,
 * registrarla aquí y, si trae un tipo de dato nuevo, añadir su escritor en
 * src/lib/sync/writers.ts. Ver docs/guia-conectores.md.
 */
const CONNECTORS: Record<ProviderId, Connector> = {
  google_analytics: ga4Connector,
  meta_ads: metaAdsConnector,
};

export function getConnector(id: string): Connector | null {
  return (CONNECTORS as Record<string, Connector>)[id] ?? null;
}

export function listConnectors(): Connector[] {
  return Object.values(CONNECTORS);
}

export function isProviderId(v: string): v is ProviderId {
  return v in CONNECTORS;
}

/** Fuentes planificadas. Solo informativas: no tienen botón de conexión. */
export interface PlannedSource {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
}

export const PLANNED_SOURCES: PlannedSource[] = [
  { id: "google_ads", name: "Google Ads", category: "ads", description: "Inversión y resultados de campañas de búsqueda, display y video." },
  { id: "search_console", name: "Google Search Console", category: "search", description: "Clics, impresiones y posición en resultados orgánicos." },
  { id: "instagram_organic", name: "Instagram orgánico", category: "social", description: "Alcance, interacciones y seguidores de cuentas profesionales." },
  { id: "facebook_pages", name: "Facebook Pages", category: "social", description: "Desempeño orgánico de páginas y publicaciones." },
  { id: "youtube_analytics", name: "YouTube Analytics", category: "social", description: "Vistas, tiempo de reproducción y suscriptores." },
  { id: "tiktok_ads", name: "TikTok Ads", category: "ads", description: "Inversión y resultados de campañas en TikTok." },
  { id: "linkedin_ads", name: "LinkedIn Ads", category: "ads", description: "Inversión y prospectos de campañas en LinkedIn." },
  { id: "crm", name: "CRM, formularios y ventas", category: "crm", description: "Prospectos y ventas confirmadas desde tu CRM." },
  { id: "pdf_reports", name: "Reportes PDF", category: "reporting", description: "Exportación de reportes en PDF." },
  { id: "scheduled_reports", name: "Envío programado de reportes", category: "reporting", description: "Envío periódico por correo." },
];
