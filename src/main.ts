// Must load first — sets global `log` (pino-pretty) and validated `env`.
import './logger.js'
import './env.js'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'

// Nest entrypoint: create the application from AppModule and start HTTP server.
async function bootstrap() {
   // logger: false — we use global `log` from logger.ts, not Nest's built-in logger.
   const app = await NestFactory.create(AppModule, {
      logger: false
   })

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
