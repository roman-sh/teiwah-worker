import {
   BadRequestException,
   Injectable,
   UnprocessableEntityException
} from '@nestjs/common'
import { isJidGroup, isLidUser, type WAMessage } from '@whiskeysockets/baileys'
import { WhatsappService } from '../connection/whatsapp.service.js'
import { MessageStore } from '../store/message-store.service.js'
import { chatIdToJid } from './chat-id.util.js'
import { buildMediaContent, isMediaUrlReachable } from './media-content.util.js'
import { OutboundMessageDto } from './outbound-message.dto.js'

/**
 * Sends outbound WhatsApp messages via the active Baileys socket.
 *
 * HTTP entry point: MessagesController POST /messages
 * No control app involved — uses WhatsappService.connectedSocket getter.
 */
@Injectable()
export class OutboundMessagesService {
   constructor(
      private readonly whatsappService: WhatsappService,
      private readonly messageStore: MessageStore
   ) {}

   /** Returns the native id of the sent message (for dedup / quoting it later). */
   async sendMessage({
      chatId,
      text,
      media,
      quoteMessageId
   }: OutboundMessageDto): Promise<string | undefined> {
      const jid = chatIdToJid(chatId)
      const socket = this.whatsappService.connectedSocket

      // Resolve the quoted message (best-effort): an unknown/evicted id yields
      // undefined, which Baileys treats as "no quote" — so it sends unquoted.
      const quoted = quoteMessageId
         ? this.messageStore.get(quoteMessageId)
         : undefined

      // if/else (not switch) so `media`/`text` narrow to their concrete types —
      // buildMediaContent requires a defined MediaDto, which a switch(true) case
      // does not narrow. Exactly-one is guaranteed by the DTO (@ExactlyOneOf).
      let sent: WAMessage | undefined
      if (media) {
         const content = await buildMediaContent(media)
         try {
            sent = await socket.sendMessage(jid, content, { quoted })
         } catch (error) {
            // Baileys' send errors are opaque. The most common client-side cause
            // for media is an unfetchable mediaUrl, so re-check it independently
            // (rather than parse Baileys internals) and surface an actionable 422.
            // If the URL is fine, it was something else — rethrow as-is.
            if (!(await isMediaUrlReachable(media.mediaUrl))) {
               throw new UnprocessableEntityException(
                  `media.mediaUrl could not be fetched: ${media.mediaUrl}`
               )
            }
            throw error
         }
         log.info(
            {
               chatId: jid,
               target: targetType(jid),
               type: 'media',
               mediaType: media.type,
               id: sent?.key?.id,
               quoted: quoted != null
            },
            'Sent WhatsApp media message'
         )
      } else if (text) {
         sent = await socket.sendMessage(jid, { text }, { quoted })
         log.info(
            {
               chatId: jid,
               target: targetType(jid),
               type: 'text',
               // Never log message content (privacy). Length only.
               textLength: text.length,
               id: sent?.key?.id,
               quoted: quoted != null
            },
            'Sent WhatsApp text message'
         )
      } else {
         throw new BadRequestException('Exactly one of text or media must be provided')
      }

      // Cache our own send so the customer can quote it later by the returned id.
      // messages.upsert for fromMe isn't a reliable/timely source, so remember
      // the send result directly.
      if (sent) this.messageStore.remember(sent)
      return sent?.key?.id ?? undefined
   }
}

/**
 * Classify the resolved send target for log analysis: `group` (…@g.us), `lid`
 * (…@lid), or `pn` (phone-number JID). Lets a log query break send volume down
 * by conversation type — useful for spotting messaging patterns (e.g. what
 * triggered an account restriction).
 */
function targetType(jid: string): 'group' | 'lid' | 'pn' {
   if (isJidGroup(jid)) return 'group'
   if (isLidUser(jid)) return 'lid'
   return 'pn'
}
