import {
   isJidGroup,
   jidNormalizedUser,
   normalizeMessageContent,
   type WAMessage
} from '@whiskeysockets/baileys'
import { extractMedia, type InboundMedia } from './inbound-media.adapter.js'
import { extractText } from './inbound-text.adapter.js'
import { extractContact, toUnixSeconds, type InboundContact } from './inbound-message.util.js'

/**
 * Inbound message payload, per API.md §5. A message is either **text** (top-level
 * `text`) or **media** (a `media` object) — never both. The fields are optional
 * here and the "exactly one" rule is an adapter invariant (mirrors the outbound
 * DTO, where a validator enforces it). `sessionId` is added by the delivery
 * envelope, not here — see InboundWebhookService.deliver.
 */
export interface InboundMessage {
   /**
    * Native WhatsApp/Baileys message id (`msg.key.id`), exposed as-is. Use it
    * for dedup, logging, and correlation, and pass it back as `quoteMessageId`
    * to reply-quote this message, as the `/read` messageId, or as the
    * `/media/:id` key to download its media.
    */
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
   /** Sender identity metadata (see InboundContact) — never a send target. */
   contact: InboundContact
   timestamp: number
   /** Present on a text message; absent on media (a caption lives in `media`). */
   text?: string
   /** Present on a media message; absent on text. */
   media?: InboundMedia
}

/**
 * Anti-corruption layer between Baileys' raw proto message model and our API
 * contract shape. Pure (no I/O) so it's trivially unit-testable.
 *
 * Reads as gather → require → shape: unwrap any envelope (ephemeral/view-once),
 * delegate the body to extractText / extractMedia, require the always-present
 * fields, then build either a text or a media payload. Returns null when the
 * message should not be forwarded: our own echo, empty, or a kind we don't
 * expose (reactions, polls, stickers, location, contacts, protocol messages, …).
 */
export function toInboundMessage(msg: WAMessage): InboundMessage | null {
   // Skip our own echoes (loop prevention).
   if (msg.key.fromMe) return null

   // Unwrap ephemeral / view-once / edited wrappers to the real content.
   const content = normalizeMessageContent(msg.message)
   if (!content) return null

   // Gather — nullable where WhatsApp may omit the field.
   const id = msg.key.id
   const chatId = msg.key.remoteJid
   const timestamp = toUnixSeconds(msg.messageTimestamp)
   const text = extractText(content)
   const media = extractMedia(content)

   // Require the envelope fields plus at least one forwardable body.
   if (!id || !chatId || timestamp == null) return null
   if (!text && !media) return null

   // In a group the sender is a distinct participant; in a 1:1 the sender is the
   // chat itself (so participant is null). Normalized → a sendable chatId.
   const participant =
      isJidGroup(chatId) && msg.key.participant
         ? jidNormalizedUser(msg.key.participant)
         : null

   const base = { id, chatId, participant, contact: extractContact(msg), timestamp }

   // Shape — media wins if both somehow appear (a caption is media, not text).
   switch (true) {
      case !!media:
         return { ...base, media }
      case !!text:
         return { ...base, text }
      default:
         return null // unreachable: the guard above ensures text or media is set
   }
}
