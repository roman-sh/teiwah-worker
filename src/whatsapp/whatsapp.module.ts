import { Module } from '@nestjs/common'
import { EventsController } from './connection/events.controller.js'
import { WhatsappService } from './connection/whatsapp.service.js'
import { ControlAppClient } from './control/control-app.client.js'
import { InboundWebhookService } from './inbound/inbound-webhook.service.js'
import { MessagesController } from './outbound/messages.controller.js'
import { OutboundMessagesService } from './outbound/outbound-messages.service.js'
import { MessageStore } from './store/message-store.service.js'

@Module({
   controllers: [EventsController, MessagesController],
   providers: [
      WhatsappService,
      ControlAppClient,
      InboundWebhookService,
      OutboundMessagesService,
      MessageStore
   ]
})
export class WhatsappModule {}
