import { Controller, Sse, type MessageEvent } from '@nestjs/common'
import { interval, map, merge, Observable } from 'rxjs'
import { InboundWebhookService } from '../inbound/inbound-webhook.service.js'
import { WhatsappService } from './whatsapp.service.js'

const SSE_KEEPALIVE_MS = 20_000

/**
 * SSE stream for session state, keepalives, and inbound-message metadata.
 *
 * Dashboard connects via Traefik:
 *   GET http://localhost:8080/sessions/:sessionId/events
 */
@Controller()
export class EventsController {
   constructor(
      private readonly whatsappService: WhatsappService,
      private readonly inboundWebhookService: InboundWebhookService
   ) {}

   @Sse('events')
   streamEvents(): Observable<MessageEvent> {
      // BehaviorSubject emits current state on subscribe, then every change.
      const stateEvents$ = this.whatsappService.state$.pipe(
         map((state): MessageEvent => ({ data: state }))
      )

      const keepaliveEvents$ = interval(SSE_KEEPALIVE_MS).pipe(
         map(
            (): MessageEvent => ({
               type: 'keepalive',
               data: { timestamp: Date.now() }
            })
         )
      )

      const inboundMessageEvents$ =
         this.inboundWebhookService.inboundMessages$.pipe(
            map(
               (message): MessageEvent => ({
                  type: 'inbound_message',
                  data: message
               })
            )
         )

      return merge(stateEvents$, keepaliveEvents$, inboundMessageEvents$)
   }
}
