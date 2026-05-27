import { Module } from '@nestjs/common'
import { EventsController } from './events.controller.js'
import { InboundWebhookService } from './inbound-webhook.service.js'
import { OutboundMessagesService } from './outbound-messages.service.js'
import { MessagesController } from './messages.controller.js'
import { WhatsappService } from './whatsapp.service.js'

@Module({
   controllers: [EventsController, MessagesController],
   providers: [WhatsappService, InboundWebhookService, OutboundMessagesService]
})
export class WhatsappModule {}
