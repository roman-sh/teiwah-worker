/**
 * Mock teiwah-control for LOCAL worker development.
 *
 * The worker (nestwaileys) talks to teiwah-control over plain HTTP for exactly
 * two things (see src/constants.ts):
 *
 *   GET   /sessions/:id            -> session config; the worker reads `webhookUrl`
 *                                     to know where to forward inbound messages
 *   PATCH /sessions/:id/phone      -> persist the connected phone number after QR
 *   POST  /sessions/:id/authorize  -> trial-abuse gate; here we always authorize
 *
 * This script stands in for control so you can run the worker standalone (no
 * cluster, no Docker, no real control/DB). The worker code is unchanged: just
 * point CONTROL_APP_BASE_URL at this server.
 *
 * Run:
 *   node mock-control.mjs
 *   # or with overrides:
 *   MOCK_PORT=4099 WEBHOOK_URL=https://webhook.site/<your-id> node mock-control.mjs
 *
 * Then set the worker's CONTROL_APP_BASE_URL=http://localhost:4099
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 4099)

// Where the worker should POST inbound messages. Point this at webhook.site,
// a local listener, or any endpoint you want to inspect.
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? 'https://webhook.site/replace-me'

const server = createServer((req, res) => {
   const { method, url } = req
   let body = ''
   req.on('data', (chunk) => (body += chunk))
   req.on('end', () => {
      log(method, url, body)

      // PATCH /sessions/:id/phone  -> accept and ack
      if (method === 'PATCH' && /^\/sessions\/[^/]+\/phone$/.test(url)) {
         return json(res, 200, { ok: true })
      }

      // POST /sessions/:id/authorize  -> always authorize (no abuse checks locally)
      if (method === 'POST' && /^\/sessions\/[^/]+\/authorize$/.test(url)) {
         return json(res, 200, { authorized: true })
      }

      // GET /sessions/:id  -> session config with the webhookUrl
      if (method === 'GET' && /^\/sessions\/[^/]+$/.test(url)) {
         return json(res, 200, { webhookUrl: WEBHOOK_URL })
      }

      json(res, 404, { error: 'not found' })
   })
})

function json(res, status, payload) {
   res.writeHead(status, { 'Content-Type': 'application/json' })
   res.end(JSON.stringify(payload))
}

function log(method, url, body) {
   const suffix = body ? ` ${body}` : ''
   console.log(`[mock-control] ${method} ${url}${suffix}`)
}

server.listen(PORT, () => {
   console.log(`[mock-control] listening on http://localhost:${PORT}`)
   console.log(`[mock-control] inbound webhookUrl -> ${WEBHOOK_URL}`)
})
