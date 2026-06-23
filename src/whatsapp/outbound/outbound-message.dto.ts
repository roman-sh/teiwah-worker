/**
 * Request body shape + validation rules for POST /messages.
 *
 * Shape (see API.md §1/§4): a message is addressed by `chatId` and is either
 * text or media:
 *
 *   text:  { "chatId": "...", "text": "Hello" }
 *   media: { "chatId": "...", "media": { "type": "image", "mediaUrl": "..." } }
 *
 * Exactly one of `text` / `media` is required (enforced by @ExactlyOneOf).
 *
 * Runs together with the ValidationPipe on MessagesController:
 *   1. transform: true  → JSON becomes an OutboundMessageDto instance (and nested MediaDto)
 *   2. @Transform runs   → trims string fields
 *   3. validators run    → fail → Nest returns 400 automatically
 *
 * Notes:
 * - Workers only ever operate on `mediaUrl` (API.md §6). Outbound base64 is
 *   normalized to a `mediaUrl` by Zuplo before it reaches this worker, so there
 *   is no `base64` field here.
 * - `location` is intentionally not yet a media type (it has no `mediaUrl`); its
 *   shape is still undecided. Add it when resolved.
 */
import { Transform, Type } from 'class-transformer'
import {
   IsIn,
   IsNotEmpty,
   IsObject,
   IsOptional,
   IsString,
   IsUrl,
   ValidateNested
} from 'class-validator'
import { IsChatId } from './chat-id.validator.js'
import { ExactlyOneOf } from './exactly-one-of.validator.js'

export const MEDIA_TYPES = ['image', 'ptt', 'audio', 'video', 'document'] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

const trim = ({ value }: { value: unknown }) =>
   typeof value === 'string' ? value.trim() : value

export class MediaDto {
   @IsIn(MEDIA_TYPES)
   type!: MediaType

   /** Media is always referenced by URL at the worker; Baileys fetches it. */
   @Transform(trim)
   @IsUrl({ require_tld: false })
   mediaUrl!: string

   @IsOptional()
   @Transform(trim)
   @IsString()
   caption?: string

   @IsOptional()
   @Transform(trim)
   @IsString()
   mimeType?: string

   @IsOptional()
   @Transform(trim)
   @IsString()
   filename?: string
}

export class OutboundMessageDto {
   /**
    * 1:1 chat address. Outbound accepts a bare phone number or a full JID/LID
    * (e.g. 972...@s.whatsapp.net). Same value delivered as inbound `chatId`.
    *
    * @ExactlyOneOf is attached here (an always-present field) so the
    * text-vs-media presence check always runs.
    */
   @Transform(trim)
   @IsChatId()
   @ExactlyOneOf(['text', 'media'])
   chatId!: string

   @IsOptional()
   @Transform(trim)
   @IsString()
   @IsNotEmpty()
   text?: string

   @IsOptional()
   @IsObject()
   @ValidateNested()
   @Type(() => MediaDto)
   media?: MediaDto
}
