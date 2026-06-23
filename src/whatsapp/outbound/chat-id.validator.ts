/**
 * `chatId` validation.
 *
 * A `chatId` is either a bare phone number (validated with libphonenumber-js)
 * or a full WhatsApp user address — a PN JID ("…@s.whatsapp.net") or a LID
 * ("…@lid"), validated with Baileys' own `isPnUser` / `isLidUser` predicates so
 * device suffixes, server domains, and protocol changes (LIDs, the upcoming
 * @username system) stay correct. Non-user JIDs (groups, broadcast) are
 * rejected. See https://baileys.wiki/docs/migration/to-v7.0.0
 */
import { isLidUser, isPnUser } from '@whiskeysockets/baileys'
import { registerDecorator, type ValidationOptions } from 'class-validator'
import { phoneToE164Digits } from './chat-id.util.js'

/**
 * True if value is a valid WhatsApp user address (PN JID or LID) when it
 * contains "@", or a valid bare phone number otherwise.
 *
 * Branch on "@" first: an address with "@" is a JID/LID and must be validated
 * as such — never run phone parsing on it (it could be a LID, not a phone).
 */
export function isValidChatId(value: string): boolean {
   if (value.includes('@')) return Boolean(isPnUser(value) || isLidUser(value))
   return phoneToE164Digits(value) != null
}

/** class-validator decorator: field must be a valid chatId (phone or JID/LID). */
export function IsChatId(options?: ValidationOptions) {
   return function (object: object, propertyName: string) {
      registerDecorator({
         name: 'isChatId',
         target: object.constructor,
         propertyName,
         options,
         validator: {
            validate(value: unknown) {
               return typeof value === 'string' && isValidChatId(value)
            },
            defaultMessage() {
               return 'chatId must be a valid phone number or WhatsApp address (PN JID …@s.whatsapp.net or LID …@lid)'
            }
         }
      })
   }
}
