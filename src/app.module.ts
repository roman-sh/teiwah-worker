import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Module, RequestMethod } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'
import { WhatsappModule } from './whatsapp/whatsapp.module.js'

/** First non-empty value of a header that may arrive as string | string[]. */
function headerValue(value: string | string[] | undefined): string | undefined {
   return Array.isArray(value) ? value[0] : value
}

@Module({
   imports: [
      // Reuse the single Pino instance from logger.ts so direct `log.*` calls,
      // Nest framework logs (incl. its exception filter), and per-request HTTP
      // logs all share one config. sessionId is already bound on the base logger
      // (single-session worker), so we only add cross-service requestId here.
      LoggerModule.forRoot({
         // SSE stream — long-lived and reconnect-prone; pinoHttp would only log
         // it on close, which is noise with no signal.
         exclude: [{ method: RequestMethod.ALL, path: 'events' }],
         pinoHttp: {
            logger: globalThis.log,
            // Reuse the upstream x-request-id (LOGGING.md §5) or mint one, and
            // echo it back so the board → Zuplo → control → worker chain shares
            // one correlation id.
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
               const id = headerValue(req.headers['x-request-id']) ?? randomUUID()
               res.setHeader('x-request-id', id)
               return id
            }
         }
      }),
      WhatsappModule
   ]
})
export class AppModule {}
