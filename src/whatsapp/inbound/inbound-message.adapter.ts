import {
   isJidGroup,
   isPnUser,
   jidDecode,
   jidNormalizedUser,
   type WAMessage
} from '@whiskeysockets/baileys'

/**
 * Inbound message payload, per API.md §5 (text-only for now; inbound media is a
 * later milestone). `sessionId` is added by the delivery envelope, not here —
 * see InboundWebhookService.deliver.
 */
export interface InboundMessage {
   id: string
   /**
    * Reply address for the conversation: pass this back as `chatId` on
    * POST /messages to reply. The group JID for a group, the contact for a 1:1.
    * In v7 a 1:1 is often a LID, not a phone — still the correct reply target.
    */
   chatId: string
   /**
    * In a GROUP, the sender's own address — message that person directly with
    * this. `null` in a 1:1 (there the sender *is* the chat, so reply via
    * `chatId`). Its presence is also the group-vs-direct signal. Normalized
    * (device suffix stripped), so it's directly usable as a `chatId` to send.
    */
   participant: string | null
   /**
    * Who sent the message — descriptive metadata only, NEVER a send target
    * (reply via `chatId`, DM via `participant`).
    */
   contact: {
      /** Self-set WhatsApp display name (pushName). Best-effort, may be null. */
      name: string | null
      /**
       * Bare phone number (e.g. "972546313551"), or null when WhatsApp didn't
       * provide a PN mapping — the human-friendly id for matching a CRM etc.
       */
      phoneNumber: string | null
   }
   timestamp: number
   text: string
}

/**
 * Anti-corruption layer between Baileys' raw proto message model and our API
 * contract shape. Pure (no I/O) so it's trivially unit-testable.
 *
 * Reads as gather → require → shape: pull every candidate, run a single guard
 * for the fields the contract needs, then build the payload. Returns null when
 * the message should not be forwarded (our own echo, empty, or not plain text
 * yet). When inbound media (#3) lands, it slots into the "shape" step.
 */
export function toInboundMessage(msg: WAMessage): InboundMessage | null {
   // Skip what we never forward: our own echoes (loop prevention) and empties.
   if (msg.key.fromMe || !msg.message) return null

   // Gather — nullable where WhatsApp may omit the field.
   const id = msg.key.id
   const chatId = msg.key.remoteJid
   const text = msg.message.conversation || msg.message.extendedTextMessage?.text
   const timestamp = toUnixSeconds(msg.messageTimestamp)

   // Require — one guard for everything the contract needs (text-only for now).
   if (!id || !chatId || !text || timestamp == null) return null

   // In a group the sender is a distinct participant; in a 1:1 the sender is the
   // chat itself (so participant is null). Normalized → a sendable chatId.
   const participant =
      isJidGroup(chatId) && msg.key.participant
         ? jidNormalizedUser(msg.key.participant)
         : null

   // Shape.
   return { id, chatId, participant, contact: extractContact(msg), timestamp, text }
}

/**
 * WhatsApp protocol timestamp → Unix seconds. Arrives as a number on live
 * events but is typed number | Long, so normalize either way. Null if absent.
 */
function toUnixSeconds(ts: WAMessage['messageTimestamp']): number | null {
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
function extractContact(msg: WAMessage): InboundMessage['contact'] {
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
