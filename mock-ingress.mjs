/**
 * Mock k3s Traefik ingress for LOCAL worker development.
 *
 * Zuplo forwarders call ${INGRESS_URL}/sessions/:sessionId/... — in prod that
 * hits Traefik, which strips the /sessions/:sessionId prefix and forwards to
 * the pod. This script mimics that strip + proxy so local Zuplo can target the
 * standalone worker without k8s.
 *
 *   Zuplo  →  mock-ingress (:8080)  →  worker (:5335)
 *             strips prefix              /media/:id, /messages, /events, …
 *
 * Run (with worker on :5335):
 *   npm run mock:ingress
 *   # or:
 *   MOCK_INGRESS_PORT=8080 WORKER_URL=http://127.0.0.1:5335 node mock-ingress.mjs
 *
 * Then in teiwah-zuplo/.env (restart `npm run dev`):
 *   INGRESS_URL=http://127.0.0.1:8080
 *
 * Pair with mock-control + nest start --watch --env-file .env for a full local
 * stack. Toggle INGRESS_URL back to https://k3s.teiwah.cloud for cluster sessions.
 */
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const PORT = Number(process.env.MOCK_INGRESS_PORT ?? 8080)
const WORKER_URL = process.env.WORKER_URL ?? 'http://127.0.0.1:5335'

/** Same rule as k8s Traefik stripPrefixRegex: ^/sessions/${sessionId} */
const SESSION_PREFIX = /^\/sessions\/[^/]+/

const server = createServer((req, res) => {
   void handle(req, res)
})

async function handle(req, res) {
   const incoming = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
   if (!SESSION_PREFIX.test(incoming.pathname)) {
      return json(res, 404, {
         error: 'expected path /sessions/:sessionId/...'
      })
   }

   const stripped = incoming.pathname.replace(SESSION_PREFIX, '') || '/'
   const target = new URL(stripped + incoming.search, WORKER_URL)

   log(req.method, incoming.pathname, target.href)

   const headers = new Headers()
   for (const [name, value] of Object.entries(req.headers)) {
      if (value == null) continue
      const key = name.toLowerCase()
      if (key === 'host' || key === 'connection') continue
      headers.set(name, Array.isArray(value) ? value.join(', ') : value)
   }

   const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? 'GET')

   let upstream
   try {
      upstream = await fetch(target, {
         method: req.method,
         headers,
         ...(hasBody ? { body: req, duplex: 'half' } : {})
      })
   } catch (error) {
      console.error('[mock-ingress] upstream error:', error)
      return json(res, 502, { error: 'worker unreachable', worker: WORKER_URL })
   }

   res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()))

   if (!upstream.body) {
      res.end()
      return
   }

   try {
      await pipeline(Readable.fromWeb(upstream.body), res)
   } catch (error) {
      if (!res.writableEnded) {
         console.error('[mock-ingress] stream error:', error)
         res.end()
      }
   }
}

function json(res, status, payload) {
   res.writeHead(status, { 'Content-Type': 'application/json' })
   res.end(JSON.stringify(payload))
}

function log(method, from, to) {
   console.log(`[mock-ingress] ${method} ${from} → ${to}`)
}

server.listen(PORT, () => {
   console.log(`[mock-ingress] listening on http://127.0.0.1:${PORT}`)
   console.log(`[mock-ingress] strip /sessions/:id → ${WORKER_URL}`)
})
