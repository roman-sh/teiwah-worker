import { z } from 'zod'

export const envSchema = z.object({
   // Mirrors teiwah-control. The cluster injects 'production' (k8s.service.ts);
   // local dev sets 'development'. Drives dev-only behavior like terminal QR.
   NODE_ENV: z.enum(['development', 'production']),
   PORT: z.string(),
   SESSION_ID: z.string(),
   CONTROL_APP_BASE_URL: z.string(),
   SESSION_STORAGE_PATH: z.string()
})

export type Env = z.infer<typeof envSchema>
