import { isJidGroup, isPnUser, jidDecode, type WAMessage } from '@whiskeysockets/baileys'

/**
 * Who sent the message — descriptive metadata only, NEVER a send target
 * (reply via `chatId`, DM via `participant`).
 */
export interface InboundContact {
   /** Self-set WhatsApp display name (pushName). Best-effort, may be null. */
   name: string | null
   /**
    * Bare phone number (e.g. "972546313551"), or null when WhatsApp didn't
    * provide a PN mapping — the human-friendly id for matching a CRM etc.
    */
   phoneNumber: string | null
}

/**
 * WhatsApp protocol timestamp → Unix seconds. Arrives as a number on live
 * events but is typed number | Long, so normalize either way. Null if absent.
 */
export function toUnixSeconds(ts: WAMessage['messageTimestamp']): number | null {
   if (ts == null) return null
   return typeof ts === 'number' ? ts : ts.toNumber()
}

/**
 * Sender identity metadata. The sender is the `participant` in a group, or the
 * chat itself (`remoteJid`) in a 1:1. WhatsApp v7 is LID-first, so the
 * phone-number JID may be the primary slot or the alt — pick whichever is the
 * PN and decode to bare digits. name/phoneNumber are null when WhatsApp didn't
 * provide them.
 */
export function extractContact(msg: WAMessage): InboundContact {
   const pnCandidates = isJidGroup(msg.key.remoteJid ?? undefined)
      ? [msg.key.participant, msg.key.participantAlt]
      : [msg.key.remoteJid, msg.key.remoteJidAlt]

   const pnJid = pnCandidates.find(
      (jid): jid is string => !!jid && isPnUser(jid) === true
   )

   return {
      name: msg.pushName ?? null,
      phoneNumber: pnJid ? (jidDecode(pnJid)?.user ?? null) : null
   }
}
