/**
 * Request bodies + validation for the non-message chat actions:
 *
 *   POST /typing  { "chatId": "..." }      → show the "typing…" indicator
 *   POST /read    { "messageId": "..." }    → mark a received message read
 *
 * Same ValidationPipe contract as OutboundMessageDto (trim → validate → 400).
 */
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString } from 'class-validator'
import { IsChatId } from '../outbound/chat-id.validator.js'

const trim = ({ value }: { value: unknown }) =>
   typeof value === 'string' ? value.trim() : value

export class TypingDto {
   /**
    * Conversation to show typing in — the same value used as `chatId` on
    * POST /messages (an inbound webhook `chatId`). Accepts a phone number,
    * PN JID, LID, or group JID.
    */
   @Transform(trim)
   @IsChatId()
   chatId!: string
}

export class ReadReceiptDto {
   /**
    * Native WhatsApp id of the received message to mark read — the `id` from an
    * inbound webhook. Resolved back to the message's full key (incl. the group
    * `participant`) via the recent-message cache, so the caller sends only this.
    */
   @Transform(trim)
   @IsString()
   @IsNotEmpty()
   messageId!: string
}
