import type { WAMessageContent } from '@whiskeysockets/baileys'

/**
 * Plain-text body of a message, or undefined when it carries none.
 *
 * Two shapes count as text: a bare `conversation` (simple message), and
 * `extendedTextMessage.text` (text with a link preview, mention, or inline
 * reply context). Content is assumed already unwrapped (ephemeral/view-once)
 * by the caller. A media caption is NOT text — it lives on the media object.
 */
export function extractText(content: WAMessageContent): string | undefined {
   // Trailing `|| undefined` collapses the proto's nullable text (string | null
   // | undefined) to undefined — `?.` only guards a missing extendedTextMessage.
   return content.conversation || content.extendedTextMessage?.text || undefined
}
