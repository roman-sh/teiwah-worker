import { DisconnectReason } from '@whiskeysockets/baileys'

/**
 * Session-state vocabulary: the contract WhatsappService publishes to the
 * dashboard over SSE, plus the pure helpers that produce it. Kept separate from
 * the service so both it and EventsController can import the shape without a
 * dependency cycle, and so this Baileys-facing mapping logic stays unit-testable
 * in isolation. The stateful transitions themselves live in WhatsappService.
 *
 * How it fits together:
 *   - `SessionState` is what the dashboard receives on every change.
 *   - `SessionDisconnectReason` explains a `disconnected` status the user must
 *     act on (Reconnect), vs a transient drop the worker recovers from silently.
 *   - `ReachoutTimeLock` / `toSessionDisconnectReason` translate raw Baileys
 *     connection.update signals into that vocabulary.
 */

/**
 * Why a session is sitting in `disconnected` waiting for the user, rather than
 * auto-reconnecting. Only set for auth-invalidating closes (the linked-device
 * credentials are dead, so a plain reconnect would just fail again) — these are
 * the cases where auth is wiped and the dashboard shows a Reconnect button.
 * Transient drops auto-reconnect and carry no reason.
 *
 * `restricted` is the account-restriction case (reachout time-lock / 463): on
 * linked devices WhatsApp kicks us with a 401 that would otherwise look like a
 * plain unlink, so we tag it distinctly for the frontend.
 */
export type SessionDisconnectReason =
   | 'logged_out'
   | 'forbidden'
   | 'bad_session'
   | 'restricted'

/** Public session state streamed to the dashboard over SSE. */
export interface SessionState {
   status:
      | 'starting'
      | 'waiting_qr'
      | 'authenticating'
      | 'connected'
      | 'disconnected'
   qr: string | null
   phoneNumber: string | null
   disconnectReason: SessionDisconnectReason | null
}

/** Baileys reachout time-lock payload (carried on connection.update). */
export interface ReachoutTimeLock {
   isActive?: boolean
   timeEnforcementEnds?: Date
   enforcementType?: string
}

/**
 * Map a Baileys close status code to a session disconnect reason, or null when
 * the close is transient (should auto-reconnect). The non-null set is exactly
 * the auth-invalidating closes that trigger an auth wipe + idle-for-reconnect.
 */
export function toSessionDisconnectReason(
   statusCode: number | undefined
): SessionDisconnectReason | null {
   switch (statusCode) {
      case DisconnectReason.loggedOut: // 401 — device unlinked / restriction logout
         return 'logged_out'
      case DisconnectReason.forbidden: // 403 — device removed by WhatsApp
         return 'forbidden'
      case DisconnectReason.badSession: // 500 — corrupt local auth
         return 'bad_session'
      case DisconnectReason.multideviceMismatch: // 411 — device keys stale, must re-pair
         return 'bad_session'
      default:
         return null
   }
}
