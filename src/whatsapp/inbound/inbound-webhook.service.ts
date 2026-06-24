import { Injectable } from '@nestjs/common'
import type { BaileysEventMap, WAMessage } from '@whiskeysockets/baileys'
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
   constructor(private readonly controlAppClient: ControlAppClient) {}

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
