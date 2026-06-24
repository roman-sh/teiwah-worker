import { getContentType, type WAMessageContent } from '@whiskeysockets/baileys'
import type { MediaType } from '../outbound/outbound-message.dto.js'

/**
 * Media descriptor on an inbound webhook (API.md §5/§6.1).
 *
 * Holds only what's intrinsic to the WhatsApp message. The Teiwah `url`
 * (GET /media/:id) and, for `ptt`, the inline `base64` are NOT set here — they
 * are added by the delivery layer (they depend on app config / a download),
 * mirroring how `sessionId`/`raw` are envelope concerns, not mapping concerns.
 */
export interface InboundMedia {
   /** Send-shape discriminator, shared with the outbound contract. */
   type: MediaType
   /**
    * Teiwah download URL (`GET /media/:id`). Set by the delivery layer, not the
    * adapter — see InboundWebhookService. Optional in the type only because the
    * pure adapter doesn't build it; it is always present in the delivered webhook.
    */
   url?: string
   /**
    * Inline media bytes, base64. Set by the delivery layer (it requires a
    * download), `ptt` only: voice notes are eagerly inlined so transcription
    * flows skip the GET /media round-trip (API.md §6.1). Absent on every other
    * type, and may be absent on a `ptt` too if the eager download failed (the
    * `url` remains the fallback).
    */
   base64?: string
   /** WhatsApp-provided MIME (e.g. `image/jpeg`, `audio/ogg; codecs=opus`), or null. */
   mimeType: string | null
   /** Original file name — documents only; null/absent otherwise. */
   filename?: string | null
   /** Caption text — image/video/document only; null/absent otherwise. */
   caption?: string | null
}

/**
 * Map a Baileys media content node to our `media` descriptor, or null when the
 * content isn't a media kind we expose. Only the documented inbound types are
 * handled (API.md §2): image, video, audio/ptt, document. Stickers, location,
 * contacts, etc. are intentionally not forwarded yet. Content is assumed already
 * unwrapped (ephemeral/view-once) by the caller.
 */
export function extractMedia(content: WAMessageContent): InboundMedia | undefined {
   switch (getContentType(content)) {
      case 'imageMessage':
         return {
            type: 'image',
            mimeType: content.imageMessage?.mimetype ?? null,
            caption: content.imageMessage?.caption ?? null
         }
      case 'videoMessage':
         return {
            type: 'video',
            mimeType: content.videoMessage?.mimetype ?? null,
            caption: content.videoMessage?.caption ?? null
         }
      case 'audioMessage':
         return {
            type: content.audioMessage?.ptt ? 'ptt' : 'audio',
            mimeType: content.audioMessage?.mimetype ?? null
         }
      // documentWithCaptionMessage wraps a documentMessage that carries a caption.
      case 'documentMessage':
      case 'documentWithCaptionMessage': {
         const document =
            content.documentMessage ??
            content.documentWithCaptionMessage?.message?.documentMessage
         if (document)
            return {
               type: 'document',
               mimeType: document.mimetype ?? null,
               filename: document.fileName ?? null,
               caption: document.caption ?? null
            }
      }
   }
}
