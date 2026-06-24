import { z } from 'zod'

/**
 * Worker env contract. Validated at boot → global `env`.
 *
 * In prod/k8s every var is injected by teiwah-control (k8s.service.ts).
 * Values and local vs prod: teiwah-control/.env.example (canonical runbook).
 * Local standalone worker: nestwaileys/.env.example.
 */
export const envSchema = z.object({
   NODE_ENV: z.enum(['development', 'production']),
   PORT: z.string(),
   SESSION_ID: z.string(),
   CONTROL_APP_BASE_URL: z.string(),
   SESSION_STORAGE_PATH: z.string(),
   PUBLIC_API_BASE_URL: z.string(),

   // Logging — see LOGGING.md. logger.ts reads process.env before this schema loads.
   LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .optional(),
   BETTERSTACK_SOURCE_TOKEN: z.string(),
   BETTERSTACK_INGESTING_HOST: z.string()
})

export type Env = z.infer<typeof envSchema>
