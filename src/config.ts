/**
 * Derived URLs and paths from validated env (env.schema.ts).
 *
 * Where env values come from: teiwah-control/.env.example (prod/k8s) or
 * nestwaileys/.env.example (local standalone worker).
 */

// -----------------------------------------------------------------------------
// CONTROL APP URLS
// -----------------------------------------------------------------------------

/**
 * PATCH — persist the connected WhatsApp phone number after QR scan.
 *
 * Called from WhatsappService when Baileys fires connection === 'open'.
 * Control app writes phoneNumber to Supabase; the dashboard reads it via
 * GET /sessions (user-facing, requires x-user-id).
 */
export const PHONE_INSERT_URL
   = `${env.CONTROL_APP_BASE_URL}/sessions/${env.SESSION_ID}/phone`

/**
 * POST — trial-abuse gate, called the instant Baileys pairs and the phone
 * number is known (before PHONE_INSERT_URL persists it). Control answers
 * `{ authorized, reason? }`; on `authorized: false` the worker logs out and
 * idles. Worker-facing; no auth guard (same as the phone/config routes).
 */
export const AUTHORIZE_URL
   = `${env.CONTROL_APP_BASE_URL}/sessions/${env.SESSION_ID}/authorize`

/**
 * GET — session config lookup for this worker.
 *
 * Returns the full session row including webhookUrl. Used on each inbound
 * messages.upsert to decide where to POST incoming WhatsApp messages.
 * Worker-facing; no auth guard (same as PATCH .../phone above).
 */
export const SESSION_CONFIG_URL
   = `${env.CONTROL_APP_BASE_URL}/sessions/${env.SESSION_ID}`

/**
 * Zuplo gateway base (customer-facing API). Used to build inbound media.url
 * (`${MEDIA_BASE_URL}/${messageId}` → GET /media/:id through Zuplo).
 */
export const MEDIA_BASE_URL = `${env.PUBLIC_API_BASE_URL}/media`

// -----------------------------------------------------------------------------
// SESSION STORAGE PATHS
// -----------------------------------------------------------------------------

/**
 * Baileys multi-file auth state directory.
 *
 * Lives under the per-session durable volume that teiwah-control mounts at
 * SESSION_STORAGE_PATH. Control owns the mount location; the worker owns the
 * subdirectory layout. Durable across in-place pod restarts (same node); a node
 * move/loss drops it and the session must re-scan the QR.
 */
export const AUTH_PATH = `${env.SESSION_STORAGE_PATH}/auth`

/**
 * Recent-message store SQLite database file.
 *
 * Sibling of AUTH_PATH under the same per-session durable volume (the store
 * creates the parent `store/` directory). Holds the node:sqlite-backed
 * recent-message store (see MessageStore) that resolves quoted replies and read
 * receipts back to full WAMessages. Durable across in-place pod restarts;
 * dropped on node move/loss alongside auth — a cold start simply re-warms it
 * (unresolved ids fall back gracefully).
 */
export const MESSAGE_DB_PATH = `${env.SESSION_STORAGE_PATH}/store/messages.db`
