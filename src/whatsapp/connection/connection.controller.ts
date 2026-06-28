import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { WhatsappService } from './whatsapp.service.js'

/**
 * Connection lifecycle actions.
 *
 * Dashboard calls via Traefik:
 *   POST http://localhost:8080/sessions/:sessionId/reconnect
 *   POST http://localhost:8080/sessions/:sessionId/disconnect
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

   /**
    * User-initiated logout: unlink the device, wipe auth, and idle. The session
    * lands in `disconnected` (reason `manual`) over the SSE stream; a later
    * Reconnect produces a fresh QR. Fire and forget like reconnect.
    */
   @Post('disconnect')
   @HttpCode(HttpStatus.ACCEPTED)
   async disconnect(): Promise<{ ok: true }> {
      await this.whatsappService.disconnect()
      return { ok: true }
   }
}
