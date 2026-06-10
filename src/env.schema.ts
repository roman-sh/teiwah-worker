import { z } from 'zod'

export const envSchema = z.object({
   PORT: z.string(),
   SESSION_ID: z.string(),
   CONTROL_APP_BASE_URL: z.string(),
   SESSION_STORAGE_PATH: z.string()
})

export type Env = z.infer<typeof envSchema>
