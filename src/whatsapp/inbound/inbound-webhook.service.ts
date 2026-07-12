import { Injectable } from '@nestjs/common'
import type { BaileysEventMap, WAMessage } from '@whiskeysockets/baileys'
import { Subject } from 'rxjs'
import { MEDIA_BASE_URL } from '../../config.js'
import { MediaService } from '../media/media.service.js'
import { ControlAppClient } from '../control/control-app.client.js'
import {
   toInboundMessage,
   type InboundMessage
} from './inbound-message.adapter.js'

export type InboundMessageEvent = Pick<
   InboundMessage,
   'chatId' | 'contact' | 'timestamp'
>

/**
 * Publishes sanitized inbound-message metadata to SSE and forwards the complete
 * normalized message to the customer's configured webhook URL.
 *
 * This is not an HTTP controller — nothing hits our worker for inbound messages.
 * Baileys fires messages.upsert → WhatsappService delegates here → we POST to
 * the customer's webhook (e.g. n8n) that they saved in the dashboard.
 *
 * The work is split into three steps so the flow reads top-to-bottom:
 *   controlAppClient.getWebhookUrl — where to send (teiwah-control coupling)
 *   toInboundMessage               — what to send  (raw Baileys → our shape)
 *   deliver                        — send it       (transport + error handling)
 */
@Injectable()
export class InboundWebhookService {
   /**
    * Sanitized inbound-message notifications shared with the worker SSE stream.
    * Message content is deliberately excluded; consumers only learn who sent a
    * message, when it arrived, and which chat can be used for a reply.
    */
   readonly inboundMessages$ = new Subject<InboundMessageEvent>()

   constructor(
      private readonly controlAppClient: ControlAppClient,
      private readonly mediaService: MediaService
   ) {}

   /**
    * Handle a Baileys messages.upsert batch, publish metadata for each eligible
    * message, and forward the complete normalized messages when a webhook exists.
    *
    * Only `type === 'notify'` is forwarded: that's live, real-time delivery.
    * Other types (history sync, append, etc.) are not customer-facing inbound.
    */
   async processInboundMessages({
      messages,
      type
   }: BaileysEventMap['messages.upsert']): Promise<void> {
      if (type !== 'notify') return

      const webhookUrl = await this.controlAppClient.getWebhookUrl()

      for (const msg of messages) {
         const webhookMessage = toInboundMessage(msg)
         if (!webhookMessage) continue

         const { chatId, contact, timestamp } = webhookMessage
         this.inboundMessages$.next({ chatId, contact, timestamp })

         if (!webhookUrl) continue

         // Enrich media with delivery-layer fields the pure adapter omits.
         // Keyed by the native message id.
         if (webhookMessage.media) {
            // Download URL (GET /media/:id) — present on every media type.
            webhookMessage.media.url = `${MEDIA_BASE_URL}/${webhookMessage.id}`
            // Voice notes must be delivered with inline base64. A URL-only PTT
            // would violate the webhook contract and break transcription flows,
            // so skip this message if the eager download/decrypt fails. Keep the
            // rest of the Baileys batch moving.
            if (webhookMessage.media.type === 'ptt') {
               try {
                  webhookMessage.media.base64 = await this.inlinePttBase64(msg)
               } catch (error) {
                  log.error(
                     { error, messageId: webhookMessage.id },
                     'Failed to inline ptt base64; skipping inbound ptt webhook'
                  )
                  continue
               }
            }
         }

         log.info(
            {
               chatId: webhookMessage.chatId,
               participant: webhookMessage.participant,
               phoneNumber: webhookMessage.contact.phoneNumber,
               // Never log message content (privacy): the media type for media,
               // else the text length for a text message.
               mediaType: webhookMessage.media?.type,
               textLength: webhookMessage.text?.length
            },
            'Received message'
         )
         // Fire-and-forget: don't wait for the customer webhook (e.g. n8n may run
         // the full automation before HTTP 200). deliver() logs errors internally.
         void this.deliver(webhookUrl, webhookMessage, msg)
      }
   }

   /**
    * Eagerly download a voice note and return it as base64 (API.md §6.1).
    *
    * The delivered PTT contract requires base64. Failures propagate to the
    * per-message handler above, which logs and skips that webhook without
    * aborting the rest of the batch. PTT clips are small, so holding one in
    * memory is fine.
    */
   private async inlinePttBase64(msg: WAMessage): Promise<string> {
      const buffer = await this.mediaService.downloadBuffer(msg)
      return buffer.toString('base64')
   }

   /**
    * POST one inbound message to the customer webhook (fire-and-forget from the
    * caller's perspective — one attempt, no retries).
    *
    * Never throws: failures are logged and swallowed.
    *
    * Envelope fields added here (not part of the mapped message):
    * - `sessionId` — lets a shared endpoint fan in multiple sessions.
    * - `raw`       — original Baileys payload (API.md §5). UNSTABLE escape hatch,
    *                 not part of the contract; shape may change across Baileys
    *                 upgrades. Kept off the clean `InboundMessage` type on purpose.
    */
   private async deliver(
      webhookUrl: string,
      message: InboundMessage,
      raw: WAMessage
   ): Promise<void> {
      try {
         const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: env.SESSION_ID, ...message, raw })
         })

         if (!res.ok) {
            log.error(
               { status: res.status, chatId: message.chatId },
               'Webhook returned non-2xx'
            )
         }
      } catch (error) {
         log.error(error, 'Failed to deliver inbound message to webhook')
      }
   }
}
