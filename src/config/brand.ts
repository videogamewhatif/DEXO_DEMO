/**
 * Identidad visual centralizada. Sustituye nombre, logotipo y colores aquí.
 * Los colores se exponen como variables CSS en src/app/globals.css (bloque :root),
 * generadas a partir de estos valores en src/app/layout.tsx.
 */
export const brand = {
  name: "Nexo Analytics",
  shortName: "Nexo",
  tagline: "Reportes de marketing digital para cada empresa",
  /** Ruta pública del logotipo (SVG en /public). */
  logoPath: "/brand/logo.svg",
  supportEmail: "soporte@example.com",
  colors: {
    primary: "#4338ca",
    primaryForeground: "#ffffff",
    accent: "#0e7490",
  },
  /** Colores para series de gráficas (contraste verificado sobre fondo blanco y oscuro). */
  chartColors: ["#4338ca", "#0e7490", "#b45309", "#be185d", "#15803d", "#6d28d9"],
  locale: "es-MX",
} as const;

export type Brand = typeof brand;
