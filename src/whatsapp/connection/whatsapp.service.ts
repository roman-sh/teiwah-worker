import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { AUTH_PATH } from '../../constants.js'
import { ControlAppClient } from '../control/control-app.client.js'
import { InboundWebhookService } from '../inbound/inbound-webhook.service.js'
import { MessageStore } from '../store/message-store.service.js'
import makeWASocket, {
   Browsers,
   DisconnectReason,
   WAMessageStatus,
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

      // New-chat message cap: WhatsApp's graded early warning before a hard
      // restriction (NONE → FIRST_WARNING → SECOND_WARNING → CAPPED). Push-only,
      // so log the full payload to inspect quota/cycle behavior later.
      sock.ev.on('message-capping.update', (info) => {
         log.warn(
            {
               cappingStatus: info.capping_status,
               usedQuota: info.used_quota,
               totalQuota: info.total_quota,
               cycleStartTimestamp: info.cycle_start_timestamp,
               cycleEndTimestamp: info.cycle_end_timestamp,
               serverSentTimestamp: info.server_sent_timestamp,
               oteStatus: info.ote_status,
               mvStatus: info.mv_status
            },
            `[Restriction] New-chat message cap update: ${info.capping_status ?? 'unknown'}`
         )
      })

      // Outbound send acks: log ONLY error acks (status ERROR), which is how a
      // *rejected* send surfaces — e.g. 463 / reachout-timelocked. The error code
      // (and ACCOUNT_RESTRICTED_TEXT for the reachout case) rides in
      // messageStubParameters. Normal delivery/read acks are skipped to avoid
      // flooding logs and Better Stack.
      sock.ev.on('messages.update', (updates) => {
         for (const { key, update } of updates) {
            if (update.status !== WAMessageStatus.ERROR) continue
            log.warn(
               {
                  id: key.id,
                  remoteJid: key.remoteJid,
                  fromMe: key.fromMe,
                  error: update.messageStubParameters
               },
               '[Restriction] Outbound send rejected (error ack)'
            )
         }
      })
   }

   /* -------------------------------------------------------------------------- */
   /* Connection events                                                          */
   /* -------------------------------------------------------------------------- */

   private async handleConnectionUpdate({
      connection,
      qr,
      lastDisconnect,
      reachoutTimeLock
   }: {
      connection?: string
      qr?: string
      lastDisconnect?: { error?: unknown }
      reachoutTimeLock?: {
         isActive?: boolean
         timeEnforcementEnds?: Date
         enforcementType?: string
      }
   }) {
      // Reachout time-lock = the actual "account restricted" / 463 state. Baileys
      // pushes it on connection.update and fires again with isActive:false when it
      // lifts. Log both edges so restriction windows are queryable later.
      if (reachoutTimeLock) {
         log.warn(
            {
               isActive: reachoutTimeLock.isActive,
               timeEnforcementEnds: reachoutTimeLock.timeEnforcementEnds,
               enforcementType: reachoutTimeLock.enforcementType
            },
            reachoutTimeLock.isActive
               ? '[Restriction] Reachout time-lock ACTIVE — account restricted'
               : '[Restriction] Reachout time-lock lifted'
         )
      }

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

         // Decode the numeric status to its Baileys reason name (e.g. 401 →
         // 'loggedOut') so the cause is queryable — key for spotting forced
         // logouts from account restrictions vs ordinary reconnects.
         const reason =
            (typeof statusCode === 'number'
               ? (DisconnectReason as Record<number, string>)[statusCode]
               : undefined) ?? 'unknown'

         log.warn({ statusCode, reason, shouldReconnect }, 'Connection closed')

         if (shouldReconnect) {
            void this.createSocket()
         } else {
            log.warn(`Logged out. Clear ${AUTH_PATH} and scan again.`)
         }
      }
   }
}
