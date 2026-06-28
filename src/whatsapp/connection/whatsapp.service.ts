import { Injectable, OnModuleInit } from '@nestjs/common'
import { rm } from 'node:fs/promises'
import { AUTH_PATH } from '../../config.js'
import { ControlAppClient } from '../control/control-app.client.js'
import { InboundWebhookService } from '../inbound/inbound-webhook.service.js'
import {
   logErroredSendAcks,
   logMessageCappingUpdate
} from '../restrictions/restriction-log.util.js'
import { MessageStore } from '../store/message-store.service.js'
import {
   ReachoutTimeLock,
   SessionState,
   toSessionDisconnectReason
} from './session-state.js'
import { WaSocketRegistry } from './wa-socket.registry.js'
import makeWASocket, {
   Browsers,
   DisconnectReason,
   jidDecode,
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

/**
 * Owns the worker's single WhatsApp connection end to end. There is exactly one
 * pod (and one socket) per session, so this service is the whole connection
 * lifecycle: it bootstraps the Baileys socket, reacts to every `connection.update`,
 * and publishes a `SessionState` on `state$` that the dashboard consumes over SSE
 * (via EventsController) and that gates outbound sends (via WaSocketRegistry).
 *
 * Reading guide — the class is organized top to bottom as:
 *   1. Public state          — `state$` (the SSE source of truth) + the socket.
 *   2. Nest lifecycle        — `onModuleInit` kicks off the first connection.
 *   3. Socket bootstrap       — `createSocket` / `reconnect` / `disposeCurrentSocket`
 *                               / `wipeAuth`: create, replace, and tear down the
 *                               disposable socket; auth (AUTH_PATH) is durable.
 *   4. Event binding          — `bindSocketEvents` wires the Baileys event stream.
 *   5. Connection events      — `handleConnectionUpdate` and its per-signal
 *                               handlers; this is the core state machine.
 *
 * The state vocabulary it emits (`SessionState`, `SessionDisconnectReason`) and
 * the pure Baileys→reason mapping live in ./session-state.ts.
 *
 * Nest wiring: @Injectable() + listing in WhatsappModule means Nest constructs
 * it and injects its dependencies automatically; we never `new` it ourselves.
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
      phoneNumber: null,
      disconnectReason: null
   })

   /** Current active socket instance (disposable) */
   private sock: WASocket | null = null

   /**
    * Whether WhatsApp's reachout time-lock (account restriction / 463) is
    * currently active. Set from the connection.update side-channel; the close
    * that drops us arrives separately and reads this to report `restricted`
    * rather than a generic `logged_out`. Reset once we reconnect cleanly.
    */
   private reachoutLockActive = false

   /**
    * Active Baileys socket when the session is connected.
    * Throws 503 if not connected — used by OutboundMessagesService to send messages.
    * Delegates to the registry, the single source of truth shared with consumers
    * (e.g. MediaService) that can't import this service without a cycle.
    */
   get connectedSocket(): WASocket {
      return this.socketRegistry.connectedSocket
   }

   constructor(
      private readonly inboundWebhookService: InboundWebhookService,
      private readonly controlAppClient: ControlAppClient,
      private readonly messageStore: MessageStore,
      private readonly socketRegistry: WaSocketRegistry
   ) {
      // Automatically log every state change with the global logger, and mirror
      // the connection gate into the registry so socket consumers see it.
      this.state$.subscribe((state) => {
         this.socketRegistry.setConnected(state.status === 'connected')
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
      // Discard any prior socket first so a stale one (e.g. a double Reconnect,
      // or a late close from the previous socket) can't emit into our handlers
      // and spin up a competing socket.
      this.disposeCurrentSocket()

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_PATH)

      const sock = makeWASocket({
         auth: state,
         logger: pino({
            level: 'silent'
         }),
         browser: Browsers.macOS('Desktop'),
         syncFullHistory: false
      })

      this.sock = sock
      this.socketRegistry.setSocket(sock)

      this.bindSocketEvents(sock, saveCreds)
   }

   /**
    * Re-initiate the Baileys connection. Public entry for POST /reconnect.
    *
    * After a logout the worker wipes auth and idles; this re-runs the socket
    * bootstrap, which reads the now-empty auth and surfaces a fresh QR over SSE.
    * Calling it on a live session simply bounces the socket (reconnects with the
    * existing creds — no re-scan).
    */
   async reconnect(): Promise<void> {
      await this.createSocket()
   }

   /**
    * Detach our listeners from the current socket and close it. Listeners are
    * removed BEFORE end() so the resulting close can't re-enter our handlers and
    * trigger another reconnect. Also drops the registry reference (→ 503 until a
    * new socket connects). No-op when there is no socket.
    */
   private disposeCurrentSocket() {
      const sock = this.sock
      if (!sock) return

      sock.ev.removeAllListeners('creds.update')
      sock.ev.removeAllListeners('connection.update')
      sock.ev.removeAllListeners('messages.upsert')
      sock.ev.removeAllListeners('message-capping.update')
      sock.ev.removeAllListeners('messages.update')

      try {
         sock.end(undefined)
      } catch {
         // end() can throw if the ws is already torn down — disposal either way.
      }

      this.sock = null
      this.socketRegistry.setSocket(null)
   }

   /**
    * Wipe auth and park the session in `disconnected` with a reason, awaiting an
    * explicit POST /reconnect. The terminal outcome for a dead-creds close —
    * known invalidating codes (401/403/500/411) or an active restriction.
    * Disposes the socket first so a trailing creds.update can't rewrite
    * creds.json after the wipe.
    */
   private async wipeAndIdle(
      disconnectReason: SessionState['disconnectReason']
   ): Promise<void> {
      this.disposeCurrentSocket()
      await this.wipeAuth()

      this.state$.next({
         status: 'disconnected',
         qr: null,
         phoneNumber: null,
         disconnectReason
      })
   }

   /**
    * Delete the Baileys auth directory after WhatsApp invalidates the linked
    * device. Scoped to AUTH_PATH (the `auth/` subdir) — never the parent storage
    * volume, so the recent-message store survives. Best-effort: a failure is
    * logged, not thrown (the reconnect will still produce a fresh QR).
    */
   private async wipeAuth(): Promise<void> {
      try {
         await rm(AUTH_PATH, { recursive: true, force: true })
         log.info({ authPath: AUTH_PATH }, 'Wiped auth state after device logout')
      } catch (error) {
         log.error(error, 'Failed to wipe auth state')
      }
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
         for (const msg of update.messages) this.messageStore.put(msg)
         void this.inboundWebhookService.processInboundMessages(update)
      })

      // Restriction telemetry (pure logging, see restriction-log.util.ts):
      // graded new-chat cap warnings, and error acks for rejected sends.
      sock.ev.on('message-capping.update', logMessageCappingUpdate)
      sock.ev.on('messages.update', logErroredSendAcks)
   }

   /* -------------------------------------------------------------------------- */
   /* Connection events                                                          */
   /* -------------------------------------------------------------------------- */

   /**
    * The heart of the session lifecycle. Baileys funnels everything — pairing,
    * login, drops, account restrictions — through this single `connection.update`
    * event, and our entire SSE state machine is driven from here.
    *
    * Key fact: the four fields below are INDEPENDENT and a given update carries
    * only the subset that changed. They are not mutually exclusive and have no
    * guaranteed ordering, so each is dispatched on its own `if` (not `else if`)
    * rather than switched on a single discriminant:
    *
    *  - `reachoutTimeLock` — account-restriction edge (463). Not a connection
    *    state of its own: it arrives on its own update slightly BEFORE the close
    *    that actually drops us. We record it (so the following close can report
    *    `restricted` instead of a bare `logged_out`) and log it.
    *  - `qr` — a new pairing code to surface for scanning (→ `waiting_qr`).
    *  - `connection === 'open'` — login succeeded (→ `connected`).
    *  - `connection === 'close'` — the socket dropped; the branch decides
    *    between wipe-auth-and-idle (dead creds) and silent auto-reconnect.
    *
    * Order matters: `reachoutTimeLock` is handled first so its flag is already
    * set if the same update also carries the `close` that consumes it.
    */
   private async handleConnectionUpdate({
      connection,
      qr,
      lastDisconnect,
      reachoutTimeLock
   }: {
      connection?: string
      qr?: string
      lastDisconnect?: { error?: unknown }
      reachoutTimeLock?: ReachoutTimeLock
   }) {
      if (reachoutTimeLock) this.handleReachoutTimeLock(reachoutTimeLock)
      if (qr) this.handleQr(qr)
      if (connection === 'open') this.handleConnectionOpen()
      if (connection === 'close') await this.handleConnectionClose(lastDisconnect)
   }

   /**
    * Reachout time-lock = the actual "account restricted" / 463 state. Baileys
    * pushes it on connection.update and fires again with isActive:false when it
    * lifts. Record the active edge so the close that follows can report
    * `restricted`, and log both edges so restriction windows are queryable.
    */
   private handleReachoutTimeLock(reachoutTimeLock: ReachoutTimeLock) {
      this.reachoutLockActive = Boolean(reachoutTimeLock.isActive)

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

   /** New pairing QR — publish it for the dashboard (and print it in dev). */
   private handleQr(qr: string) {
      this.state$.next({
         status: 'waiting_qr',
         qr,
         phoneNumber: null,
         disconnectReason: null
      })

      // Local-dev only: render the QR in the terminal so it can be scanned
      // without the dashboard. Off in production — there the QR is delivered
      // via the dashboard SSE, and printing it would dump a large
      // non-structured block into the logs on each rotation.
      if (env.NODE_ENV === 'development') {
         qrcodeTerminal.generate(qr, { small: true })
      }
   }

   /** Connection established — publish the bare phone number and persist it. */
   private handleConnectionOpen() {
      // A clean connection means any prior restriction has lifted.
      this.reachoutLockActive = false

      // sock.user.id is the full JID, e.g. 972501234567:1@s.whatsapp.net.
      // jidDecode strips the device suffix (:1) and server to give the bare number.
      const phoneNumber = jidDecode(this.sock!.user!.id)!.user

      this.state$.next({
         status: 'connected',
         qr: null,
         phoneNumber,
         disconnectReason: null
      })

      // Insert phone number into control app DB (dashboard reads it from GET /sessions)
      void this.controlAppClient.insertPhoneNumber(phoneNumber)
   }

   /**
    * The socket dropped. Two outcomes:
    *  - definitive dead creds (401/403/500/411, or an active restriction) →
    *    reconnecting can't help → wipe + idle for an explicit POST /reconnect.
    *  - anything else (transient drop, network blip, or the normal post-pair
    *    restart 515) → reconnect immediately. A failed attempt just closes again
    *    and loops back here, naturally paced by each attempt's own connect
    *    latency, so a persistent outage self-heals once connectivity returns.
    */
   private async handleConnectionClose(lastDisconnect?: { error?: unknown }) {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode

      // Decode the numeric status to its Baileys reason name (e.g. 401 →
      // 'loggedOut') so the cause is queryable — key for spotting forced
      // logouts from account restrictions vs ordinary reconnects.
      const reason =
         (typeof statusCode === 'number'
            ? (DisconnectReason as Record<number, string>)[statusCode]
            : undefined) ?? 'unknown'

      // Dead creds. A reachout time-lock seen just before this close means the
      // kick is an account restriction (463 → 401 on linked devices); report it
      // distinctly instead of an indistinguishable `logged_out`. 411 (multidevice
      // mismatch) maps to `bad_session`.
      const deadCredsReason = this.reachoutLockActive
         ? 'restricted'
         : toSessionDisconnectReason(statusCode)
      if (deadCredsReason) {
         log.warn(
            { statusCode, reason },
            `[Restriction] Credentials invalidated (${deadCredsReason}); wiping auth and idling for reconnect`
         )
         await this.wipeAndIdle(deadCredsReason)
         return
      }

      // Transient: reconnect. Only show pairing after a real post-scan restart
      // (515) — not every reconnect while a QR is already on screen.
      const isAuthenticating = statusCode === DisconnectReason.restartRequired
      this.state$.next({
         ...this.state$.value,
         status: isAuthenticating ? 'authenticating' : 'disconnected',
         qr: isAuthenticating ? null : this.state$.value.qr,
         disconnectReason: null
      })

      log.warn({ statusCode, reason }, 'Connection closed; reconnecting')
      void this.createSocket()
   }
}
