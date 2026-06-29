// Must load first — sets global `log` (pino-pretty) and validated `env`.
import './logger.js'
import './env.js'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module.js'

/**
 * Last-resort visibility for a crashing process. `uncaughtExceptionMonitor`
 * observes only — it does NOT swallow the error, so Node still prints its stack
 * to stderr (captured by k8s) and crashes with the normal exit code, and k8s
 * restarts the pod (auth is durable → reconnects on boot).
 *
 * Covers both fatal synchronous throws and unhandled promise rejections: on
 * Node's default `--unhandled-rejections=throw`, a rejection with no
 * `unhandledRejection` listener is promoted to an uncaught exception. So do NOT
 * register an `unhandledRejection` handler — that would intercept rejections
 * before they reach this monitor.
 *
 * The Pino `fatal` line is best-effort: the @logtail transport runs in a worker
 * thread and sends over HTTP, so it may not reach Better Stack before the
 * process dies — Node's synchronous stderr dump is the reliable record.
 */
process.on('uncaughtExceptionMonitor', (error, origin) => {
   log.fatal(error, `Fatal: ${origin}`)
})

// Nest entrypoint: create the application from AppModule and start HTTP server.
async function bootstrap() {
   // bufferLogs holds startup logs until our Pino logger is wired in below.
   const app = await NestFactory.create(AppModule, { bufferLogs: true })

   // Route Nest's framework logs (incl. its exception logging) through the same
   // Pino instance, instead of suppressing them with logger: false.
   app.useLogger(app.get(Logger))

   app.enableCors()

   // Run lifecycle hooks (e.g. MessageStore's DB close) on SIGTERM/SIGINT —
   // k8s sends SIGTERM on pod shutdown, so this checkpoints SQLite cleanly.
   app.enableShutdownHooks()

   await app.listen(env.PORT)
   log.info(`HTTP server listening on port ${env.PORT}`)
}

bootstrap().catch((err: unknown) => {
   log.error(err, 'Failed to start application')
})
