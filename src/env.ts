import { envSchema } from './env.schema.js'

globalThis.env = envSchema.parse(process.env)
