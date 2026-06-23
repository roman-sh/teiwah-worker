import { Injectable } from '@nestjs/common'
import type { WAMessage } from '@whiskeysockets/baileys'
import { LRUCache } from 'lru-cache'

/** Max messages held at once; oldest-accessed are evicted past this. */
const MAX_ENTRIES = 5_000

/** Entry lifetime — comfortably longer than any realistic reply gap. */
const TTL_MS = 1000 * 60 * 60 * 48 // 48h

/**
 * Recent-message cache, keyed by native WhatsApp message id (`msg.key.id`).
 *
 * Sole purpose today: resolve an outbound `quoteMessageId` back into the full
 * WAMessage that Baileys needs to build a quoted reply — Baileys reads the
 * original message's key *and* content to render the quote, not just an id, so
 * we must keep the object around (this Baileys version ships no built-in store).
 *
 * In-memory and best-effort by design. Quoting is recency-biased (people reply
 * to recent messages), so an LRU keeps exactly the window that might be quoted
 * and evicts the rest — bounded memory, no cleanup cron. Lost on restart: a
 * quote to an evicted/expired/pre-restart id resolves to `undefined` and the
 * message simply sends unquoted. Per-worker (one session, one pod), so there's
 * nothing to share across processes.
 *
 * Memory: each entry is the raw WAMessage, which holds only media *references*
 * (url/directPath/mediaKey) plus a small inline jpegThumbnail — never the file
 * bytes (Baileys downloads on demand), and never our outbound `ptt` base64
 * (that's added downstream, not stored here). So entries are KB-scale even for
 * media, and MAX_ENTRIES * (worst-case thumbnail) stays well bounded.
 */
@Injectable()
export class MessageStore {
   private readonly cache = new LRUCache<string, WAMessage>({
      max: MAX_ENTRIES,
      ttl: TTL_MS
   })

   /** Remember a message by its native id. No-op when the message carries no id. */
   remember(msg: WAMessage): void {
      const id = msg.key.id
      if (id) this.cache.set(id, msg)
   }

   /** Resolve a previously-seen message by id, or undefined if unknown/evicted. */
   get(id: string): WAMessage | undefined {
      return this.cache.get(id)
   }
}
