import { Body, Controller, Post, UsePipes, ValidationPipe } from '@nestjs/common'
import { ReadReceiptDto, TypingDto } from './chat-actions.dto.js'
import { ChatActionsService } from './chat-actions.service.js'

/**
 * Chat actions that are not messages: typing indicator + read receipts.
 *
 * Auth model matches MessagesController — Zuplo validates the per-session API
 * key upstream and routes to this pod; the worker trusts the routed request
 * (the key is scoped to one session, so no ownership check is needed here).
 *
 * Local URLs (via Traefik):
 *   POST http://localhost:8080/sessions/:sessionId/typing  { "chatId": "..." }
 *   POST http://localhost:8080/sessions/:sessionId/read    { "messageId": "..." }
 *
 * Production (via Zuplo):
 *   POST https://api.teiwah.com/sessions/:sessionId/{typing,read}
 *   Authorization: Bearer <session-api-key>
 */
@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ChatActionsController {
   constructor(private readonly chatActionsService: ChatActionsService) {}

   /** Show the "typing…" indicator in a chat (auto-clears — call before replying). */
   @Post('typing')
   async typing(@Body() body: TypingDto) {
      await this.chatActionsService.setTyping(body.chatId)
      return { success: true }
   }

   /** Mark a received message read (blue ticks), addressed by its native id. */
   @Post('read')
   async read(@Body() body: ReadReceiptDto) {
      await this.chatActionsService.markRead(body.messageId)
      return { success: true }
   }
}
