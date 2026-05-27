import type pino from 'pino'
import type { Env } from './env.schema.js'

declare global {
   var log: pino.Logger
   var env: Env
}

export {}
