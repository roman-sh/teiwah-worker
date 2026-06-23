import {
   BadRequestException,
   Injectable,
   NotImplementedException
} from '@nestjs/common'
import { WhatsappService } from '../connection/whatsapp.service.js'
import { chatIdToJid } from './chat-id.util.js'
import { OutboundMessageDto } from './outbound-message.dto.js'

/**
 * Sends outbound WhatsApp messages via the active Baileys socket.
 *
 * HTTP entry point: MessagesController POST /messages
 * No control app involved — uses WhatsappService.connectedSocket getter.
 */
@Injectable()
export class OutboundMessagesService {
   constructor(private readonly whatsappService: WhatsappService) {}

   async sendMessage({ chatId, text, media }: OutboundMessageDto): Promise<void> {
      const jid = chatIdToJid(chatId)
      const socket = this.whatsappService.connectedSocket

      switch (true) {
         case !!media:
            // TODO(M3): map media.type -> Baileys send payload
            throw new NotImplementedException('Sending media is not yet implemented')

         case !!text:
            await socket.sendMessage(jid, { text })
            log.info({ chatId: jid }, 'Sent WhatsApp text message')
            break

         // case !!location:
         //    throw new NotImplementedException('Sending location is not yet implemented')

         default:
            throw new BadRequestException('Exactly one of text or media must be provided')
      }
   }
}
