import type { AnyMediaMessageContent } from '@whiskeysockets/baileys'
import contentDisposition from 'content-disposition'
import { fileTypeFromStream } from 'file-type'
import mime from 'mime-types'
import type { MediaDto } from './outbound-message.dto.js'

/** Bytes sniffed for magic-number detection — file-type's recommended sample. */
const SNIFF_BYTES = 4100

/** Timeout for the best-effort metadata/reachability fetches. */
const FETCH_TIMEOUT_MS = 4000

/**
 * Maps a validated MediaDto into the Baileys media content for sendMessage.
 *
 * Media is always referenced by URL (API.md §6) — we hand Baileys `{ url }` and
 * it downloads, encrypts, uploads to WhatsApp's CDN, and generates thumbnails.
 * Our only job is the right shape per `type`, plus best-effort mimetype/filename
 * so files (esp. documents) aren't mislabeled by Baileys' coarse per-type
 * defaults (every typeless document would otherwise become "file"/application/pdf).
 *
 * Async because resolving a document's type may require a small network read —
 * see resolveMediaMeta. The common (extension-bearing) path stays network-free.
 */
export async function buildMediaContent(
   media: MediaDto
): Promise<AnyMediaMessageContent> {
   const url = media.mediaUrl
   const { mimetype, filename } = await resolveMediaMeta(media)

   switch (media.type) {
      case 'image':
         return { image: { url }, caption: media.caption, mimetype }
      case 'video':
         return { video: { url }, caption: media.caption, mimetype }
      case 'audio':
         return { audio: { url }, mimetype }
      case 'ptt':
         // Voice note: force ptt and let Baileys default the mimetype to opus
         // (audio/ogg; codecs=opus) — overriding it can break voice-note rendering.
         return { audio: { url }, ptt: true }
      case 'document':
         return {
            document: { url },
            fileName: filename,
            // Document mimetype is required by Baileys and drives the file icon /
            // how it opens, so never leave it to the wrong "application/pdf" default.
            mimetype: mimetype ?? 'application/octet-stream',
            caption: media.caption
         }
   }
}

/**
 * Resolve `mimetype` and `filename`, cheapest signal first:
 *   1. caller-provided value (trusted, free)
 *   2. URL extension via mime-types + the URL basename (free)
 *   3. inspect the file: one ranged GET → magic-number sniff (file-type) with
 *      Content-Type / Content-Disposition as fallbacks (~4 KB off the wire)
 *
 * Step 3 is gated to documents whose extension lookup failed: only documents are
 * harmed by a wrong/missing mimetype (image/video/audio fall back to a fine
 * per-type Baileys default and are transcoded by WhatsApp anyway), so that's the
 * only case worth a network read.
 */
async function resolveMediaMeta(
   media: MediaDto
): Promise<{ mimetype: string | undefined; filename: string | undefined }> {
   let filename = media.filename ?? basenameFromUrl(media.mediaUrl)
   let mimetype =
      media.mimeType ?? mimeFromName(filename) ?? mimeFromName(media.mediaUrl)

   if (media.type === 'document' && !mimetype) {
      const inspected = await inspectMedia(media.mediaUrl)
      mimetype = inspected.mimetype
      filename = filename ?? inspected.filename
   }

   return { mimetype, filename }
}

/**
 * Best-effort liveness check for a media URL: a tiny ranged GET (no body read),
 * true on any success status. Used only on the send-failure path to decide
 * whether an opaque Baileys error was caused by an unfetchable mediaUrl, so it
 * never adds latency to a successful send. A network error / timeout → false.
 */
export async function isMediaUrlReachable(url: string): Promise<boolean> {
   const controller = new AbortController()
   const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
   try {
      const res = await fetch(url, {
         headers: { Range: 'bytes=0-0' },
         signal: controller.signal
      })
      return res.ok || res.status === 206
   } catch {
      return false
   } finally {
      clearTimeout(timer)
      controller.abort() // we only needed the status line; release the connection
   }
}

/** mime-types lookup → mimetype string, or undefined when it can't be determined. */
function mimeFromName(name: string | undefined): string | undefined {
   if (!name) return undefined
   return mime.lookup(name) || undefined
}

/** Last path segment of a URL (decoded), or undefined when there isn't one. */
function basenameFromUrl(url: string): string | undefined {
   try {
      const base = new URL(url).pathname.split('/').pop()
      return base ? decodeURIComponent(base) : undefined
   } catch {
      return undefined
   }
}

/**
 * Best-effort content inspection without downloading the whole file: a single
 * ranged GET, from which we both
 *   - magic-number sniff the body (file-type — authoritative for binaries), and
 *   - read Content-Type / Content-Disposition (server's claim + filename).
 *
 * file-type's `fileTypeFromStream` reads only the bytes its detectors need, so
 * even a server that ignores `Range` (replies 200) is never fully streamed. The
 * shared AbortController bounds the whole thing with a timeout and, in `finally`,
 * cancels the body to release the connection. Any failure resolves to empty so
 * the caller falls back to a default rather than erroring the whole send.
 */
async function inspectMedia(
   url: string
): Promise<{ mimetype: string | undefined; filename: string | undefined }> {
   const empty = { mimetype: undefined, filename: undefined }
   const controller = new AbortController()
   const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
   try {
      const res = await fetch(url, {
         headers: { Range: `bytes=0-${SNIFF_BYTES}` },
         signal: controller.signal
      })
      if ((!res.ok && res.status !== 206) || !res.body) return empty

      const sniffed = await fileTypeFromStream(res.body, {
         signal: controller.signal
      })
      const headerType = res.headers.get('content-type')?.split(';')[0].trim()

      return {
         mimetype: sniffed?.mime ?? headerType ?? undefined,
         filename: filenameFromDisposition(res.headers.get('content-disposition'))
      }
   } catch {
      return empty
   } finally {
      clearTimeout(timer)
      controller.abort()
   }
}

/** Parse the filename from a Content-Disposition header (RFC 5987 aware). */
function filenameFromDisposition(header: string | null): string | undefined {
   if (!header) return undefined
   try {
      const filename = contentDisposition.parse(header).parameters.filename
      return typeof filename === 'string' ? filename : undefined
   } catch {
      return undefined
   }
}
