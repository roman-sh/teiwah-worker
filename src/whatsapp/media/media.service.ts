import { Injectable, NotFoundException } from '@nestjs/common'
import {
   downloadMediaMessage,
   normalizeMessageContent
} from '@whiskeysockets/baileys'
import { create as createContentDisposition } from 'content-disposition'
import mime from 'mime-types'
import { WhatsappService } from '../connection/whatsapp.service.js'
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
      private readonly whatsappService: WhatsappService,
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

      // connectedSocket throws 503 when offline; its updateMediaMessage handles
      // the re-upload when WhatsApp's CDN copy has expired.
      const socket = this.whatsappService.connectedSocket
      const buffer = await downloadMediaMessage(
         msg,
         'buffer',
         {}, // MediaDownloadOptions (e.g. byte range) — none, fetch the whole file
         { logger: log, reuploadRequest: socket.updateMediaMessage }
      )

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
}
