import { Module } from '@nestjs/common'
import { ChatActionsController } from './actions/chat-actions.controller.js'
import { ChatActionsService } from './actions/chat-actions.service.js'
import { EventsController } from './connection/events.controller.js'
import { WhatsappService } from './connection/whatsapp.service.js'
import { ControlAppClient } from './control/control-app.client.js'
import { InboundWebhookService } from './inbound/inbound-webhook.service.js'
import { MediaController } from './media/media.controller.js'
import { MediaService } from './media/media.service.js'
import { MessagesController } from './outbound/messages.controller.js'
import { OutboundMessagesService } from './outbound/outbound-messages.service.js'
import { MessageStore } from './store/message-store.service.js'
import { MESSAGE_DB_PATH } from '../config.js'

@Module({
   controllers: [
      EventsController,
      MessagesController,
      ChatActionsController,
      MediaController
   ],
   providers: [
      WhatsappService,
      ControlAppClient,
      InboundWebhookService,
      OutboundMessagesService,
      ChatActionsService,
      MediaService,
      // Factory so the portable store receives its per-session db path here,
      // keeping it free of app globals (env/config) for later extraction.
      {
         provide: MessageStore,
         useFactory: () => new MessageStore({ dbPath: MESSAGE_DB_PATH })
      }
   ]
})
export class WhatsappModule {}
