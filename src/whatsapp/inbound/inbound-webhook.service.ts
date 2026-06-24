import { Injectable } from '@nestjs/common'
import type { BaileysEventMap, WAMessage } from '@whiskeysockets/baileys'
import { MEDIA_BASE_URL } from '../../config.js'
import { MediaService } from '../media/media.service.js'
import { ControlAppClient } from '../control/control-app.client.js'
import { toInboundMessage, type InboundMessage } from './inbound-message.adapter.js'

/**
 * Forwards inbound WhatsApp messages to the customer's configured webhook URL.
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
   constructor(
      private readonly controlAppClient: ControlAppClient,
      private readonly mediaService: MediaService
   ) {}

   /**
    * Handle a Baileys messages.upsert batch and forward each eligible message.
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
      if (!webhookUrl) return

      for (const msg of messages) {
         const webhookMessage = toInboundMessage(msg)
         if (!webhookMessage) continue

         // Enrich media with delivery-layer fields the pure adapter omits.
         // Keyed by the native message id.
         if (webhookMessage.media) {
            // Download URL (GET /media/:id) — present on every media type.
            webhookMessage.media.url = `${MEDIA_BASE_URL}/${webhookMessage.id}`
            // Voice notes are additionally inlined as base64 (API.md §6.1) so
            // transcription flows skip the extra round-trip.
            if (webhookMessage.media.type === 'ptt')
               webhookMessage.media.base64 = await this.inlinePttBase64(msg)
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
         await this.deliver(webhookUrl, webhookMessage, msg)
      }
   }

   /**
    * Eagerly download a voice note and return it as base64 (API.md §6.1).
    *
    * Best-effort: any failure (offline socket, CDN miss) is logged and resolves
    * to undefined so the message is still delivered — the customer falls back to
    * the `media.url`. ptt clips are small, so holding one in memory is fine.
    */
   private async inlinePttBase64(msg: WAMessage): Promise<string | undefined> {
      try {
         const buffer = await this.mediaService.downloadBuffer(msg)
         return buffer.toString('base64')
      } catch (error) {
         log.warn(error, 'Failed to inline ptt base64; delivering url only')
         return undefined
      }
   }

   /**
    * POST one inbound message to the customer webhook.
    *
    * Never throws: a failing webhook is logged and swallowed so one bad delivery
    * doesn't abort the rest of the upsert batch.
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
