import { Injectable } from '@nestjs/common'
import { SendMessageDto } from './send-message.dto.js'
import { WhatsappService } from './whatsapp.service.js'

/**
 * Sends outbound WhatsApp messages via the active Baileys socket.
 *
 * HTTP entry point: MessagesController POST /messages
 * No control app involved — uses WhatsappService.connectedSocket getter.
 */
@Injectable()
export class OutboundMessagesService {
   constructor(private readonly whatsappService: WhatsappService) {}

   async sendTextMessage({ to, text }: SendMessageDto): Promise<void> {
      await this.whatsappService.connectedSocket.sendMessage(to, { text })
      log.info({ to, text }, 'Sent WhatsApp message')
   }
}
