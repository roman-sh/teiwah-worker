import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import type { WASocket } from '@whiskeysockets/baileys'

/**
 * Holds the current Baileys socket and the "connected" gate, so socket
 * consumers don't have to depend on WhatsappService directly.
 *
 * Why this exists: WhatsappService owns the socket *and* drives inbound webhook
 * delivery (it injects InboundWebhookService). The webhook in turn inlines ptt
 * base64 via MediaService, which needs the socket to download. If MediaService
 * imported WhatsappService for that, it would close a cycle
 * (WhatsappService → InboundWebhookService → MediaService → WhatsappService) —
 * fatal under ESM (the emitted design:paramtypes hits a TDZ on load).
 *
 * This dependency-free registry is the sink of that graph instead: WhatsappService
 * is the sole writer (set on socket create, gate driven by its state stream),
 * and consumers (MediaService, and anyone else later) only read. No cycle.
 */
@Injectable()
export class WaSocketRegistry {
   private sock: WASocket | null = null
   private connected = false

   /** Replace the active socket (WhatsappService calls this on each create). */
   setSocket(sock: WASocket | null): void {
      this.sock = sock
   }

   /** Track the connection gate (driven by WhatsappService's state stream). */
   setConnected(connected: boolean): void {
      this.connected = connected
   }

   /**
    * The active socket, or a 503 when the session isn't connected — the shared
    * contract for sending, chat actions, and media download.
    */
   get connectedSocket(): WASocket {
      if (!this.connected || !this.sock)
         throw new ServiceUnavailableException('Session is not connected')

      return this.sock
   }
}
