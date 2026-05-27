import { Injectable } from '@nestjs/common'
import { SESSION_CONFIG_URL } from '../constants.js'

/**
 * Forwards inbound WhatsApp messages to the user's configured webhook URL.
 *
 * This is not an HTTP controller — nothing hits our worker for inbound messages.
 * Baileys fires messages.upsert → WhatsappService delegates here → we POST to
 * the user's webhook (e.g. n8n) that they saved in the dashboard.
 */
@Injectable()
export class InboundWebhookService {
   /**
    * Handle a Baileys messages.upsert event and forward eligible messages.
    *
    * Flow:
    * 1. Fetch session config from teiwah-control (GET SESSION_CONFIG_URL)
    * 2. Read webhookUrl — if missing, log info and skip (user may not have configured yet)
    * 3. For each live inbound text message, POST JSON payload to webhookUrl
    *
    * Logging levels (for Better Stack / support):
    * - error: control app unreachable or returned non-2xx
    * - info:  no webhookUrl configured (helps debug "connected but no webhook hits")
    * - info:  each message received and forwarded
    */
   async forwardMessagesUpsert({
      messages,
      type
   }: {
      messages: any[]
      type?: string
   }): Promise<void> {
      // Ignore non-live/history/internal events — only forward real-time inbound messages.
      if (type !== 'notify') return

      // Fetch webhookUrl from control app. Fresh on every upsert (no cache).
      let configRes: Response
      try {
         configRes = await fetch(SESSION_CONFIG_URL)
      } catch (error) {
         // Network/DNS failure reaching teiwah-control — messages will not be forwarded.
         log.error(error, 'Failed to fetch session config')
         return
      }

      if (!configRes.ok) {
         // Control app returned 404/500 etc. — messages will not be forwarded.
         log.error({ status: configRes.status }, 'Failed to fetch session config')
         return
      }

      const session = (await configRes.json()) as { webhookUrl?: string | null }
      const webhookUrl = session.webhookUrl?.trim()

      if (!webhookUrl) {
         // Session is connected but user hasn't saved a webhook URL in the dashboard yet.
         // Info (not error) — visible in centralized logs for support triage.
         log.info(
            { sessionId: env.SESSION_ID },
            'No webhookUrl configured; skipping inbound forward'
         )
         return
      }

      // Process all incoming messages in this upsert batch.
      for (const msg of messages) {
         // Ignore our own outgoing messages (prevent reply loops).
         if (msg.key.fromMe) continue

         // Ignore malformed/empty messages.
         if (!msg.message) continue

         // WhatsApp chat identifier (e.g. 972546313551@s.whatsapp.net)
         const jid = msg.key.remoteJid
         if (!jid) continue

         const messageId = msg.key.id
         if (!messageId) continue

         // WhatsApp protocol timestamp — Unix seconds, not milliseconds (same as wwebjs).
         if (msg.messageTimestamp == null) continue
         const timestamp = Number(msg.messageTimestamp)

         // WhatsApp supports multiple text formats — extract plain text only for now.
         const text =
            msg.message.conversation || msg.message.extendedTextMessage?.text
         if (!text) continue

         log.info({ jid, text }, 'Received message')

         // POST inbound message payload to the user's configured webhook (e.g. n8n).
         await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               sessionId: env.SESSION_ID,
               from: jid,
               text,
               messageId,
               timestamp
            })
         })
      }
   }
}
