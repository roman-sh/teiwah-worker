/**
 * Request body shape + validation rules for POST /messages.
 *
 * Nest does NOT run this file by itself. It works together with ValidationPipe
 * on MessagesController:
 *
 *   1. Client sends JSON: { "to": "...", "text": "..." }
 *   2. ValidationPipe (transform: true) converts JSON → SendMessageDto instance
 *   3. @Transform runs first (trim whitespace on each field)
 *   4. @IsString / @IsNotEmpty run next — fail → Nest returns 400 automatically
 *   5. Controller receives a validated `body` — no manual if-checks needed
 *
 * Decorators (@Transform, @IsString, …) are TypeScript metadata read at runtime
 * by class-transformer and class-validator (requires experimentalDecorators in tsconfig).
 *
 * `to!: string` — the `!` tells TypeScript "Nest fills this from the HTTP body at
 * runtime; don't require a constructor assignment."
 */
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString } from 'class-validator'

export class SendMessageDto {
   /** 1:1 chat JID — same as inbound webhook `from` (e.g. 972...@s.whatsapp.net). */
   @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
   @IsString()
   @IsNotEmpty()
   to!: string

   @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
   @IsString()
   @IsNotEmpty()
   text!: string
}
