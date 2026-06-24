import { Module } from '@nestjs/common'
import { ChatActionsController } from './actions/chat-actions.controller.js'
import { ChatActionsService } from './actions/chat-actions.service.js'
import { EventsController } from './connection/events.controller.js'
import { WhatsappService } from './connection/whatsapp.service.js'
import { ControlAppClient } from './control/control-app.client.js'
import { InboundWebhookService } from './inbound/inbound-webhook.service.js'
import { MessagesController } from './outbound/messages.controller.js'
import { OutboundMessagesService } from './outbound/outbound-messages.service.js'
import { MessageStore } from './store/message-store.service.js'

@Module({
   controllers: [EventsController, MessagesController, ChatActionsController],
   providers: [
      WhatsappService,
      ControlAppClient,
      InboundWebhookService,
      OutboundMessagesService,
      ChatActionsService,
      MessageStore
   ]
})
export class WhatsappModule {}
