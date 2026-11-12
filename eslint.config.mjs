import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db/privileged",
              message:
                "El acceso privilegiado a la base de datos solo se permite en módulos de servidor autorizados (src/lib/integrations/service.ts, src/lib/sync, src/lib/auth/invitations-service.ts, src/lib/platform). Usa withUserDb.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
