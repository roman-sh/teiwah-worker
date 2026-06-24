import { z } from 'zod'

export const envSchema = z.object({
   // Mirrors teiwah-control. The cluster injects 'production' (k8s.service.ts);
   // local dev sets 'development'. Drives dev-only behavior like terminal QR.
   NODE_ENV: z.enum(['development', 'production']),
   PORT: z.string(),
   SESSION_ID: z.string(),
   CONTROL_APP_BASE_URL: z.string(),
   SESSION_STORAGE_PATH: z.string(),

   // Logging (see LOGGING.md). The Better Stack pair is REQUIRED: every env
   // (dev + prod) ships to its own source, and in prod teiwah-control injects
   // these into the pod (k8s.service.ts). LOG_LEVEL stays optional (default info).
   // Note: logger.ts reads these from process.env directly (it loads before env
   // parsing); they're declared here for documentation and validation only.
   LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .optional(),
   BETTERSTACK_SOURCE_TOKEN: z.string(),
   BETTERSTACK_INGESTING_HOST: z.string()
})

export type Env = z.infer<typeof envSchema>
