/**
 * `chatId` validation.
 *
 * A `chatId` is either a bare phone number (validated with libphonenumber-js)
 * or a full WhatsApp address — a PN JID ("…@s.whatsapp.net"), a LID ("…@lid"),
 * or a group ("…@g.us") — validated with Baileys' own predicates so device
 * suffixes, server domains, and protocol changes (LIDs, the upcoming @username
 * system) stay correct. Other JIDs (broadcast, status) are rejected. Groups are
 * accepted so a customer can reply to a group conversation by its `chatId`.
 * See https://baileys.wiki/docs/migration/to-v7.0.0
 */
import { isJidGroup, isLidUser, isPnUser } from '@whiskeysockets/baileys'
import { registerDecorator, type ValidationOptions } from 'class-validator'
import { phoneToE164Digits } from './chat-id.util.js'

/**
 * True if value is a valid WhatsApp address (PN JID, LID, or group JID) when it
 * contains "@", or a valid bare phone number otherwise.
 *
 * Branch on "@" first: an address with "@" is a JID/LID/group and must be
 * validated as such — never run phone parsing on it (it could be a LID).
 */
export function isValidChatId(value: string): boolean {
   if (value.includes('@'))
      return Boolean(isPnUser(value) || isLidUser(value) || isJidGroup(value))
   return phoneToE164Digits(value) != null
}

/** class-validator decorator: field must be a valid chatId (phone, JID/LID, or group). */
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
               return 'chatId must be a valid phone number or WhatsApp address (PN JID …@s.whatsapp.net, LID …@lid, or group …@g.us)'
            }
         }
      })
   }
}
