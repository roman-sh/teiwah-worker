import {
   Body,
   Controller,
   HttpException,
   Post,
   ServiceUnavailableException,
   UsePipes,
   ValidationPipe
} from '@nestjs/common'
import { OutboundMessagesService } from './outbound-messages.service.js'
import { OutboundMessageDto } from './outbound-message.dto.js'

/**
 * Outbound WhatsApp messages — sent directly via Baileys (no control app).
 *
 * Auth is NOT checked here. Production: Zuplo validates the per-session API key
 * before routing to this pod. Local milestone: Traefik → worker with no auth
 * (same as SSE). The API key is scoped to one session, so no extra ownership
 * check is needed on the worker.
 *
 * Local URL (via Traefik):
 *   POST http://localhost:8080/sessions/:sessionId/messages
 *   Body: { "chatId": "972...@s.whatsapp.net", "text": "hello" }
 *
 * Production (via Zuplo):
 *   POST https://api.teiwah.com/sessions/:sessionId/messages
 *   Authorization: Bearer <session-api-key>
 *
 * Use the inbound webhook `chatId` field as `chatId` when replying in 1:1 chats.
 *
 * ---
 * Nest validation (pipe + DTO are separate layers):
 *
 * - ValidationPipe (on this controller) = HOW to validate any body on this controller
 *     transform: true  → plain JSON becomes a class instance; @Transform decorators run
 *     whitelist: true → strip extra JSON fields not declared on the DTO
 *
 * - OutboundMessageDto (on each @Body() param) = WHAT to validate for that specific route
 *     Nest picks the DTO from the handler signature — add more routes with different
 *     DTOs later; same pipe applies to all of them.
 *
 * We put the pipe on this controller only — not global in main.ts — because
 * EventsController (SSE) has no request body and does not need validation.
 */
@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class MessagesController {
   constructor(private readonly outboundMessagesService: OutboundMessagesService) {}

   @Post('messages')
   /** `@Body() body: OutboundMessageDto` — type here tells ValidationPipe which DTO to use. */
   async sendMessage(@Body() body: OutboundMessageDto) {
      try {
         await this.outboundMessagesService.sendMessage(body)
      } catch (error) {
         // Let intentional HTTP errors through with their status (e.g. 501 media
         // not implemented, 503 session not connected); only wrap unexpected ones.
         if (error instanceof HttpException) throw error
         log.error(error, 'Failed to send WhatsApp message')
         throw new ServiceUnavailableException('Failed to send message')
      }

      return { success: true }
   }
}
