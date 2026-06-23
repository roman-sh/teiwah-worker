import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { AUTH_PATH } from '../../constants.js'
import { ControlAppClient } from '../control/control-app.client.js'
import { InboundWebhookService } from '../inbound/inbound-webhook.service.js'
import { MessageStore } from '../store/message-store.service.js'
import makeWASocket, {
   Browsers,
   DisconnectReason,
   WASocket,
   useMultiFileAuthState
} from '@whiskeysockets/baileys'
// Default import: qrcode-terminal is CommonJS, so its `generate` lives on the
// default export (module.exports), not as a namespace member. `import * as`
// leaves generate under `.default` and breaks at runtime.
import qrcodeTerminal from 'qrcode-terminal'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import { BehaviorSubject } from 'rxjs'

export interface SessionState {
   status:
      | 'starting'
      | 'waiting_qr'
      | 'authenticating'
      | 'connected'
      | 'disconnected'
   qr: string | null
   phoneNumber: string | null
}

/**
 * Nest magic:
 * - @Injectable() registers this class in Nest's DI container
 * - Because this service is in AppModule.providers, Nest creates it
 *   automatically and injects it where needed
 */
@Injectable()
export class WhatsappService implements OnModuleInit {
   /* -------------------------------------------------------------------------- */
   /* Public state                                                               */
   /* -------------------------------------------------------------------------- */

   /** Real-time state stream for SSE and status checks */
   public readonly state$ = new BehaviorSubject<SessionState>({
      status: 'starting',
      qr: null,
      phoneNumber: null
   })

   /** Current active socket instance (disposable) */
   private sock: WASocket | null = null

   /**
    * Active Baileys socket when the session is connected.
    * Throws 503 if not connected — used by OutboundMessagesService to send messages.
    */
   get connectedSocket(): WASocket {
      if (this.state$.value.status !== 'connected' || !this.sock)
         throw new ServiceUnavailableException('Session is not connected')

      return this.sock
   }

   constructor(
      private readonly inboundWebhookService: InboundWebhookService,
      private readonly controlAppClient: ControlAppClient,
      private readonly messageStore: MessageStore
   ) {
      // Automatically log every state change with the global logger
      this.state$.subscribe((state) => {
         log.info(
            { status: state.status, phoneNumber: state.phoneNumber },
            `[Session Status] Changed to: ${state.status}`
         )
      })
   }

   /* -------------------------------------------------------------------------- */
   /* Nest lifecycle                                                             */
   /* -------------------------------------------------------------------------- */

   /**
    * More Nest magic:
    * onModuleInit() is called by Nest after provider construction
    * so we don't call this manually from main.ts
    */
   async onModuleInit() {
      await this.createSocket()
   }

   /* -------------------------------------------------------------------------- */
   /* Socket bootstrap                                                           */
   /* -------------------------------------------------------------------------- */

   /**
    * Creates a NEW Baileys socket
    *
    * IMPORTANT:
    * - socket is disposable
    * - auth state (AUTH_PATH) is durable across in-place pod restarts
    */
   private async createSocket() {
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH)

      const sock = makeWASocket({
         auth: state,
         logger: pino({
            level: 'silent'
         }),
         // Second arg is the label shown in WhatsApp → Linked Devices.
         browser: Browsers.macOS('Teiwah'),
         syncFullHistory: false
      })

      this.sock = sock

      this.bindSocketEvents(sock, saveCreds)
   }

   /**
    * Wires all socket event listeners in one place
    */
   private bindSocketEvents(sock: WASocket, saveCreds: () => Promise<void>) {
      // Persist auth state whenever creds rotate
      sock.ev.on('creds.update', saveCreds)

      // Connection lifecycle events (QR, open, close, reconnect)
      sock.ev.on('connection.update', (update) => {
         void this.handleConnectionUpdate(update)
      })

      // Incoming messages: cache them (so they can later be quoted by id) and
      // forward to the customer's webhook. Caching runs for every upsert, even
      // when no webhook is configured, so quoting works independently.
      sock.ev.on('messages.upsert', (update) => {
         for (const msg of update.messages) this.messageStore.remember(msg)
         void this.inboundWebhookService.processInboundMessages(update)
      })
   }

   /* -------------------------------------------------------------------------- */
   /* Connection events                                                          */
   /* -------------------------------------------------------------------------- */

   private async handleConnectionUpdate({
      connection,
      qr,
      lastDisconnect
   }: {
      connection?: string
      qr?: string
      lastDisconnect?: { error?: unknown }
   }) {
      if (qr) {
         this.state$.next({
            status: 'waiting_qr',
            qr: qr,
            phoneNumber: null
         })

         // Local-dev only: render the QR in the terminal so it can be scanned
         // without the dashboard. Off in production — there the QR is delivered
         // via the dashboard SSE, and printing it would dump a large
         // non-structured block into the logs on each rotation.
         if (env.NODE_ENV === 'development') {
            qrcodeTerminal.generate(qr, { small: true })
         }
      }

      if (connection === 'open') {
         // Baileys exposes the logged-in user on sock.user.id, e.g. 972501234567:1@s.whatsapp.net
         // Strip the device suffix (:1) and domain (@s.whatsapp.net) to get the bare phone number
         const phoneNumber = this.sock!.user!.id.split(':')[0].split('@')[0]

         this.state$.next({
            status: 'connected',
            qr: null,
            phoneNumber
         })

         // Insert phone number into control app DB (dashboard reads it from GET /sessions)
         void this.controlAppClient.insertPhoneNumber(phoneNumber)
      }

      if (connection === 'close') {
         const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
         const shouldReconnect = statusCode !== DisconnectReason.loggedOut

         // Only show pairing after a real post-scan restart — not every reconnect while QR is showing
         const isAuthenticating = statusCode === DisconnectReason.restartRequired

         this.state$.next({
            ...this.state$.value,
            status: isAuthenticating ? 'authenticating' : 'disconnected',
            ...(isAuthenticating ? { qr: null } : {})
         })

         log.warn({ statusCode, shouldReconnect }, 'Connection closed')

         if (shouldReconnect) {
            void this.createSocket()
         } else {
            log.warn(`Logged out. Clear ${AUTH_PATH} and scan again.`)
         }
      }
   }
}
