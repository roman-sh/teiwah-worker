/**
 * chatId normalization helpers.
 *
 * Converts the public `chatId` (a bare phone number or a full WhatsApp address)
 * into the canonical Baileys JID used for sending. Phone parsing uses
 * libphonenumber-js; WhatsApp numbers carry no leading "+", so we prepend one.
 */
import { jidEncode, jidNormalizedUser } from '@whiskeysockets/baileys'
import { parsePhoneNumberFromString } from 'libphonenumber-js'

/**
 * Parse a bare phone number (with or without a leading "+") into E.164 digits
 * with no "+", or null if it is not a valid phone number.
 */
export function phoneToE164Digits(input: string): string | null {
   const candidate = input.startsWith('+') ? input : `+${input}`
   const parsed = parsePhoneNumberFromString(candidate)
   if (!parsed?.isValid()) return null
   return parsed.format('E.164').slice(1) // drop leading "+"
}

/**
 * Normalize a (validated) chatId into a Baileys JID.
 *
 * A JID/LID is normalized (drops any device suffix, preserves the LID domain);
 * a bare phone becomes "<e164digits>@s.whatsapp.net".
 */
export function chatIdToJid(chatId: string): string {
   if (chatId.includes('@')) return jidNormalizedUser(chatId)
   const digits = phoneToE164Digits(chatId)
   // Validation runs before this, so `digits` should never be null; fall back
   // defensively rather than emitting an empty-user JID.
   return jidEncode(digits ?? chatId.replace(/\D/g, ''), 's.whatsapp.net')
}
