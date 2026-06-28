import { Controller, Sse } from '@nestjs/common'
import { map, Observable } from 'rxjs'
import { SessionState } from './session-state.js'
import { WhatsappService } from './whatsapp.service.js'

/**
 * SSE stream for session status and QR code.
 *
 * Dashboard connects via Traefik:
 *   GET http://localhost:8080/sessions/:sessionId/events
 */
@Controller()
export class EventsController {
   constructor(private readonly whatsappService: WhatsappService) {}

   @Sse('events')
   streamEvents(): Observable<{ data: SessionState }> {
      // BehaviorSubject emits current state on subscribe, then every change.
      return this.whatsappService.state$.pipe(map((state) => ({ data: state })))
   }
}
