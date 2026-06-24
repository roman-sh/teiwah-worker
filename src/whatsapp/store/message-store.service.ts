import { type OnModuleDestroy } from '@nestjs/common'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { proto, type WAMessage } from '@whiskeysockets/baileys'

/** Max messages retained; rows past this are trimmed (newest-by-insert kept). */
const DEFAULT_MAX_ENTRIES = 1_000

/** Entry lifetime — comfortably longer than any realistic reply gap. */
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 48 // 48h

/** Cadence of the background reaper (expired-row delete + size-cap trim). */
const DEFAULT_REAP_INTERVAL_MS = 1000 * 60 * 10 // 10 min

/**
 * All configuration the store needs, passed in by the composition root — the
 * store reads no app globals (env/constants), so it stays portable enough to
 * lift into a standalone package: its only deps are node:sqlite and Baileys'
 * proto codec.
 */
export interface MessageStoreOptions {
   /** SQLite database file path. Parent directories are created if missing. */
   dbPath: string
   /** Entry lifetime in ms. Default 48h. */
   ttlMs?: number
   /** Max rows retained; the oldest by insert order are trimmed. Default 1000. */
   maxEntries?: number
   /** Background reaper cadence in ms. Default 10 min. */
   reapIntervalMs?: number
}

/**
 * Recent-message store, keyed by native WhatsApp message id (`msg.key.id`).
 *
 * Resolves an outbound `quoteMessageId` (and a `/read` messageId) back into the
 * full WAMessage that Baileys needs — Baileys reads the original message's key
 * *and* content to render a quote / ack a read, not just an id, so we keep the
 * object around (this Baileys version ships no built-in store).
 *
 * Backed by node:sqlite (Node's built-in engine — no native module, works on
 * the Alpine image) on the per-session durable volume beside `auth/`. So unlike
 * the previous in-memory LRU, the working set lives on *disk*, not RAM: memory
 * stays flat regardless of MAX_ENTRIES, and the window survives in-place pod
 * restarts. Each row is the WAMessage serialized with Baileys' own proto
 * encoder (media *references* + small inline thumbnail — never file bytes), so
 * rows are KB-scale.
 *
 * Eviction mimics @keyv/sqlite: an absolute-ms `expires_at` column with a
 * partial-friendly index, reaped by a single indexed `DELETE … WHERE
 * expires_at < now` on an unref'd interval, plus a read-time guard so a stale
 * row is never served between ticks. A second one-statement trim caps the row
 * count. No per-write cost and no full-table deserialization (the trap that
 * makes naive sqlite caches quadratic). Best-effort by design: an unknown,
 * expired, or trimmed id resolves to `undefined` and the caller degrades
 * (sends unquoted / 404s the read). Per-worker (one session, one pod).
 *
 * Self-contained: the only Teiwah coupling is the proto encode/decode and the
 * id key, and all paths/limits arrive via constructor options (no app globals),
 * so it can be lifted into a standalone package untouched. It's registered in
 * WhatsappModule via a factory provider that supplies the per-session dbPath.
 */
export class MessageStore implements OnModuleDestroy {
   private readonly db: DatabaseSync
   private readonly ttlMs: number
   private readonly maxEntries: number
   private readonly putStmt: StatementSync
   private readonly getStmt: StatementSync
   private readonly delStmt: StatementSync
   private readonly reapExpiredStmt: StatementSync
   private readonly reapOverflowStmt: StatementSync
   private readonly reapTimer: NodeJS.Timeout

   constructor(options: MessageStoreOptions) {
      this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
      this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
      const reapIntervalMs = options.reapIntervalMs ?? DEFAULT_REAP_INTERVAL_MS

      mkdirSync(dirname(options.dbPath), { recursive: true })
      this.db = new DatabaseSync(options.dbPath)
      // WAL: better crash resilience and reader/writer separation; safe for a
      // single durable-volume connection.
      this.db.exec('PRAGMA journal_mode = WAL')
      this.db.exec(
         `CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            data BLOB NOT NULL,
            expires_at INTEGER NOT NULL
         )`
      )
      this.db.exec(
         'CREATE INDEX IF NOT EXISTS messages_expires_idx ON messages (expires_at)'
      )

      this.putStmt = this.db.prepare(
         'INSERT OR REPLACE INTO messages (id, data, expires_at) VALUES (?, ?, ?)'
      )
      this.getStmt = this.db.prepare(
         'SELECT data, expires_at AS expiresAt FROM messages WHERE id = ?'
      )
      this.delStmt = this.db.prepare('DELETE FROM messages WHERE id = ?')
      this.reapExpiredStmt = this.db.prepare(
         'DELETE FROM messages WHERE expires_at < ?'
      )
      // INSERT OR REPLACE assigns a fresh rowid on replace, so rowid order
      // tracks insertion recency — keep the newest MAX_ENTRIES, drop the rest.
      this.reapOverflowStmt = this.db.prepare(
         `DELETE FROM messages WHERE rowid NOT IN (
            SELECT rowid FROM messages ORDER BY rowid DESC LIMIT ?
         )`
      )

      this.reap() // clear anything stale carried over from a previous run
      this.reapTimer = setInterval(() => this.reap(), reapIntervalMs)
      this.reapTimer.unref() // the reaper must never keep the process alive
   }

   /** Remember a message by its native id. No-op when the message carries no id. */
   remember(msg: WAMessage): void {
      const id = msg.key.id
      if (!id) return
      const data = proto.WebMessageInfo.encode(msg).finish()
      this.putStmt.run(id, data, Date.now() + this.ttlMs)
   }

   /** Resolve a previously-seen message by id, or undefined if unknown/expired. */
   get(id: string): WAMessage | undefined {
      const row = this.getStmt.get(id) as
         | { data: Uint8Array; expiresAt: number }
         | undefined
      if (!row) return undefined
      // Lazy guard: never serve a row that expired since the last reaper tick.
      if (row.expiresAt <= Date.now()) {
         this.delStmt.run(id)
         return undefined
      }
      // We only ever store messages that had a key (see remember), so the
      // decoded proto's nominally-optional key is always present here.
      return proto.WebMessageInfo.decode(row.data) as WAMessage
   }

   onModuleDestroy(): void {
      clearInterval(this.reapTimer)
      this.db.close()
   }

   private reap(): void {
      this.reapExpiredStmt.run(Date.now())
      this.reapOverflowStmt.run(this.maxEntries)
   }
}
