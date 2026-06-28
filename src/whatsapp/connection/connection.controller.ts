import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { WhatsappService } from './whatsapp.service.js'

/**
 * Connection lifecycle actions.
 *
 * Dashboard calls via Traefik:
 *   POST http://localhost:8080/sessions/:sessionId/reconnect
 */
@Controller()
export class ConnectionController {
   constructor(private readonly whatsappService: WhatsappService) {}

   /**
    * Re-initiate the Baileys connection after a logout. Auth was wiped on the
    * invalidating close, so this surfaces a fresh QR over the SSE stream. Fire
    * and forget: progress is observed via GET /events, not this response.
    */
   @Post('reconnect')
   @HttpCode(HttpStatus.ACCEPTED)
   async reconnect(): Promise<{ ok: true }> {
      await this.whatsappService.reconnect()
      return { ok: true }
   }
}
