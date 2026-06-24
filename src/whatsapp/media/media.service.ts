import { Injectable, NotFoundException } from '@nestjs/common'
import {
   downloadMediaMessage,
   normalizeMessageContent,
   type WAMessage
} from '@whiskeysockets/baileys'
import { create as createContentDisposition } from 'content-disposition'
import mime from 'mime-types'
import { WaSocketRegistry } from '../connection/wa-socket.registry.js'
import { extractMedia } from '../inbound/inbound-media.adapter.js'
import { MessageStore } from '../store/message-store.service.js'

/** Bytes plus the headers a caller needs to stream them straight back. */
export interface DownloadedMedia {
   buffer: Buffer
   mimeType: string
   /** Ready-to-send Content-Disposition value (RFC 5987-safe filename). */
   contentDisposition: string
}

/**
 * Download-on-demand for inbound media (API.md §6.1, served at GET /media/:id).
 *
 * We don't persist file bytes — the recent-message store keeps only the
 * WAMessage (media *references* + keys). On request we resolve that message by
 * its native id and let Baileys fetch+decrypt from WhatsApp's CDN, reuploading
 * via the live socket if the CDN copy has expired. So this shares the send
 * contract: a 503 when the session is offline, a 404 when the id is unknown
 * (never seen or evicted from the cache) or carries no media.
 */
@Injectable()
export class MediaService {
   constructor(
      // Read the socket from the registry (not WhatsappService) so we don't
      // import it: the webhook injects us to inline ptt base64, and WhatsappService
      // injects the webhook — importing it here would close an ESM/DI cycle.
      private readonly socketRegistry: WaSocketRegistry,
      private readonly messageStore: MessageStore
   ) {}

   async download(messageId: string): Promise<DownloadedMedia> {
      const msg = this.messageStore.get(messageId)
      if (!msg)
         throw new NotFoundException(
            `Unknown messageId (not in recent cache): ${messageId}`
         )

      const content = normalizeMessageContent(msg.message)
      const media = content ? extractMedia(content) : undefined
      if (!media)
         throw new NotFoundException(
            `Message ${messageId} carries no downloadable media`
         )

      const buffer = await this.downloadBuffer(msg)

      const mimeType = media.mimeType ?? 'application/octet-stream'
      // mime.extension() strips any ;params and maps unknowns to false → 'bin'.
      const filename =
         media.filename ?? `${messageId}.${mime.extension(mimeType) || 'bin'}`

      log.info(
         { messageId, mediaType: media.type, bytes: buffer.length },
         'Served media'
      )

      return {
         buffer,
         mimeType,
         contentDisposition: createContentDisposition(filename, { type: 'inline' })
      }
   }

   /**
    * Download + decrypt a message's media bytes via Baileys: fetch from
    * WhatsApp's CDN, reuploading through the live socket if the CDN copy
    * expired. Throws 503 when the session is offline (connectedSocket).
    *
    * Shared by GET /media (above) and the webhook's ptt base64 inlining, both of
    * which already have the WAMessage in hand — so this takes the message, not an
    * id, and does no store lookup of its own.
    */
   async downloadBuffer(msg: WAMessage): Promise<Buffer> {
      const socket = this.socketRegistry.connectedSocket
      return downloadMediaMessage(
         msg,
         'buffer',
         {}, // MediaDownloadOptions (e.g. byte range) — none, fetch the whole file
         { logger: log, reuploadRequest: socket.updateMediaMessage }
      )
   }
}
