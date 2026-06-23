import { Module } from '@nestjs/common'
import { EventsController } from './connection/events.controller.js'
import { WhatsappService } from './connection/whatsapp.service.js'
import { InboundWebhookService } from './inbound/inbound-webhook.service.js'
import { MessagesController } from './outbound/messages.controller.js'
import { OutboundMessagesService } from './outbound/outbound-messages.service.js'

@Module({
   controllers: [EventsController, MessagesController],
   providers: [WhatsappService, InboundWebhookService, OutboundMessagesService]
})
export class WhatsappModule {}
