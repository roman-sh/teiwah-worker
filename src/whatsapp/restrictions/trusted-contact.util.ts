/**
 * Trusted-contact gate.
 *
 * WhatsApp issues a per-contact "Trusted Contact" token (`tctoken`) once a peer
 * has engaged us (inbound `privacy_token`) or it arrives via history sync. A
 * contact with a live token is the one class the server reliably lets us message
 * — cold reach-outs to *untrusted* contacts are exactly what trips the account
 * reach-out lock (`463` / `reachoutTimeLock`). See `RESTRICTIONS.md`.
 *
 * This mirrors Baileys' own send-path read (`buildTcTokenFromJid` in
 * `Utils/tc-token-utils`): resolve the destination to its LID (the token store is
 * LID-keyed), read through the auth API, and treat a non-empty, non-expired token
 * as trusted. We deep-import the two predicates because Baileys does not re-export
 * them from the package root; pinning to the installed source keeps our notion of
 * "trusted" identical to what the library actually puts on the wire.
 */
import { ForbiddenException } from '@nestjs/common'
import {
   isHostedLidUser,
   isHostedPnUser,
   isJidGroup,
   isLidUser,
   isPnUser,
   type WASocket
} from '@whiskeysockets/baileys'
import {
   isTcTokenExpired,
   resolveTcTokenJid
} from '@whiskeysockets/baileys/lib/Utils/tc-token-utils.js'

/**
 * True when `jid` addresses a single person (so the tctoken gate applies).
 *
 * The trusted-contact protocol is structurally 1:1-only — Baileys never attaches
 * a tctoken to group/status/newsletter sends (`is1on1Send` in `messages-send`),
 * and the store has no per-group key. Groups are therefore never gated here.
 *
 * Note: DMing a *group participant* (their `@lid`/PN as the chatId) is a 1:1 send
 * and IS gated — that's the cold-reach-out shape that caused case-001.
 */
export function is1to1UserJid(jid: string): boolean {
   if (isJidGroup(jid)) return false
   return Boolean(
      isPnUser(jid) || isLidUser(jid) || isHostedPnUser(jid) || isHostedLidUser(jid)
   )
}

/**
 * True when we hold a live Trusted-Contact token for `jid`.
 *
 * Trusted iff a `tctoken` entry exists with a non-empty `token` that is not
 * expired (rolling ~28-day window). A missing entry, an empty token (we reached
 * out but the peer never issued one back), or an expired token all read as
 * untrusted — i.e. a cold reach-out.
 *
 * Caller is responsible for restricting this to 1:1 sends via `is1to1UserJid`.
 */
export async function isTrustedContact(jid: string, sock: WASocket): Promise<boolean> {
   const getLIDForPN = sock.signalRepository.lidMapping.getLIDForPN.bind(
      sock.signalRepository.lidMapping
   )

   // The token store is LID-keyed; a PN lookup silently misses. resolveTcTokenJid
   // falls back to the input jid when no LID mapping exists, which then misses the
   // store and reads as untrusted — the correct outcome for an unmapped contact.
   const storageJid = await resolveTcTokenJid(jid, getLIDForPN)

   const data = await sock.authState.keys.get('tctoken', [storageJid])
   const entry = data[storageJid]

   return !!entry?.token?.length && !isTcTokenExpired(entry.timestamp)
}

/**
 * Pre-send guard: throw unless `jid` is safe to message.
 *
 * No-op for non-1:1 destinations (groups etc.) — they aren't gated. For a 1:1
 * destination we hold no live token for, throws `403 Forbidden` so the send
 * never hits the wire. It's a Nest `HttpException`, so `MessagesController`
 * surfaces it to the caller verbatim with the standard error envelope.
 */
export async function assertTrustedContact(jid: string, sock: WASocket): Promise<void> {
   if (!is1to1UserJid(jid)) return
   if (await isTrustedContact(jid, sock)) return

   log.warn(
      { chatId: jid, reason: 'untrusted_contact' },
      '[Restriction] Blocked outbound send to untrusted contact'
   )
   throw new ForbiddenException(
      'Cannot start a new conversation with this contact; they must message you first'
   )
}
