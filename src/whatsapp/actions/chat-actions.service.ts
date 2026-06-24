import { Injectable, NotFoundException } from '@nestjs/common'
import { WhatsappService } from '../connection/whatsapp.service.js'
import { chatIdToJid } from '../outbound/chat-id.util.js'
import { MessageStore } from '../store/message-store.service.js'

/**
 * Chat actions that are not messages: the typing indicator and read receipts.
 *
 * Both go through the active Baileys socket (WhatsappService.connectedSocket),
 * so they fail with 503 when the session is offline — same contract as sending.
 */
@Injectable()
export class ChatActionsService {
   constructor(
      private readonly whatsappService: WhatsappService,
      private readonly messageStore: MessageStore
   ) {}

   /**
    * Show the "typing…" indicator in a chat. WhatsApp clears it automatically
    * (after ~25s, or the instant a message is sent), so there is deliberately no
    * "stop" — call this right before replying to look responsive.
    */
   async setTyping(chatId: string): Promise<void> {
      const jid = chatIdToJid(chatId)
      const socket = this.whatsappService.connectedSocket
      await socket.sendPresenceUpdate('composing', jid)
      log.info({ chatId: jid }, 'Sent typing indicator')
   }

   /**
    * Mark a received message as read (blue ticks). Read receipts target a
    * specific message, and Baileys needs its full key (remoteJid + id +
    * participant) — which we recover from the recent-message cache by id, so the
    * caller only echoes back the inbound webhook `id`. An unknown/too-old id
    * (never seen or already evicted from the cache) is a 404.
    */
   async markRead(messageId: string): Promise<void> {
      const msg = this.messageStore.get(messageId)
      if (!msg)
         throw new NotFoundException(
            `Unknown messageId (not in recent cache): ${messageId}`
         )

      const socket = this.whatsappService.connectedSocket
      await socket.readMessages([msg.key])
      log.info({ messageId, chatId: msg.key.remoteJid }, 'Marked message read')
   }
}
