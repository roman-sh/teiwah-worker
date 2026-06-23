import { Injectable } from '@nestjs/common'
import { PHONE_INSERT_URL, SESSION_CONFIG_URL } from '../../constants.js'

/**
 * HTTP client for teiwah-control — the single boundary to the control app.
 *
 * Every call the worker makes to the control app lives here, so base URLs,
 * error handling, and (later) auth/retries stay in one place instead of being
 * hand-rolled across the connection and inbound services.
 *
 * SESSION_ID and CONTROL_APP_BASE_URL are injected into the pod by
 * teiwah-control/k8s.service.ts; the URLs are resolved in constants.ts.
 */
@Injectable()
export class ControlAppClient {
   /**
    * Persist the connected phone number (PATCH /sessions/:id/phone) so the
    * dashboard can show it (GET /sessions). Called once when Baileys reports the
    * connection open.
    *
    * Fire-and-forget: failures are logged and swallowed so a control hiccup
    * never crashes the worker or breaks the WhatsApp connection.
    */
   async insertPhoneNumber(phoneNumber: string): Promise<void> {
      try {
         const res = await fetch(PHONE_INSERT_URL, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber })
         })

         if (!res.ok) {
            log.error({ status: res.status, phoneNumber }, 'Failed to insert phone number')
            return
         }

         log.info({ phoneNumber }, 'Inserted phone number into control app DB')
      } catch (error) {
         log.error(error, 'Failed to insert phone number into control app')
      }
   }

   /**
    * Look up this session's configured webhook URL (GET /sessions/:id).
    *
    * Fetched fresh per call (no cache) so dashboard edits take effect
    * immediately. Returns null — caller skips forwarding — when control is
    * unreachable, returns non-2xx, or no webhook is configured yet.
    *
    * Logging (for Better Stack / support):
    * - error: control unreachable or non-2xx
    * - info:  connected but no webhookUrl saved (explains "no webhook hits")
    */
   async getWebhookUrl(): Promise<string | null> {
      let res: Response
      try {
         res = await fetch(SESSION_CONFIG_URL)
      } catch (error) {
         log.error(error, 'Failed to fetch session config')
         return null
      }

      if (!res.ok) {
         log.error({ status: res.status }, 'Failed to fetch session config')
         return null
      }

      const session = (await res.json()) as { webhookUrl?: string | null }
      const webhookUrl = session.webhookUrl?.trim()

      if (!webhookUrl) {
         log.info(
            { sessionId: env.SESSION_ID },
            'No webhookUrl configured; skipping inbound forward'
         )
         return null
      }

      return webhookUrl
   }
}
