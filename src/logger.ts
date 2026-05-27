import pino from 'pino'

/**
 * Shared app logger.
 * We attach it to globalThis so files can use `log` without importing.
 */
globalThis.log = pino({
   level: 'info',
   transport: {
      target: 'pino-pretty',
      options: {
         colorize: true,
         translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
         ignore: 'pid,hostname'
      }
   }
})
