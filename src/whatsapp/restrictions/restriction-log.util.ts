import type { BaileysEventMap } from '@whiskeysockets/baileys'
import { WAMessageStatus } from '@whiskeysockets/baileys'

/**
 * Push-only restriction telemetry. Both handlers are pure logging — no socket
 * or session state — so they live outside WhatsappService. See RESTRICTIONS.md.
 */

/**
 * New-chat message cap: WhatsApp's graded early warning before a hard
 * restriction (NONE → FIRST_WARNING → SECOND_WARNING → CAPPED). Push-only, so
 * log the full payload to inspect quota/cycle behavior later.
 */
export function logMessageCappingUpdate(
   info: BaileysEventMap['message-capping.update']
) {
   log.warn(
      {
         cappingStatus: info.capping_status,
         usedQuota: info.used_quota,
         totalQuota: info.total_quota,
         cycleStartTimestamp: info.cycle_start_timestamp,
         cycleEndTimestamp: info.cycle_end_timestamp,
         serverSentTimestamp: info.server_sent_timestamp,
         oteStatus: info.ote_status,
         mvStatus: info.mv_status
      },
      `[Restriction] New-chat message cap update: ${info.capping_status ?? 'unknown'}`
   )
}

/**
 * Outbound send acks: log ONLY error acks (status ERROR), which is how a
 * *rejected* send surfaces — e.g. 463 / reachout-timelocked. The error code
 * (and ACCOUNT_RESTRICTED_TEXT for the reachout case) rides in
 * messageStubParameters. Normal delivery/read acks are skipped to avoid
 * flooding logs and Better Stack.
 */
export function logErroredSendAcks(updates: BaileysEventMap['messages.update']) {
   for (const { key, update } of updates) {
      if (update.status !== WAMessageStatus.ERROR) continue
      log.warn(
         {
            id: key.id,
            remoteJid: key.remoteJid,
            fromMe: key.fromMe,
            error: update.messageStubParameters
         },
         '[Restriction] Outbound send rejected (error ack)'
      )
   }
}
