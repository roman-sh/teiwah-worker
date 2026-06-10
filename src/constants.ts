/**
 * Control app URLs for this worker pod.
 *
 * Each nestwaileys pod serves exactly one WhatsApp session. At startup,
 * teiwah-control injects env vars into the pod (see k8s.service.ts):
 *
 *   CONTROL_APP_BASE_URL — how this pod reaches teiwah-control
 *                          (local k3d: http://host.docker.internal:4007)
 *   SESSION_ID           — this pod's session id (e.g. brave-tiger-a1b2)
 *   SESSION_STORAGE_PATH — root of the per-session durable storage volume
 *                          (mounted by k8s.service.ts, e.g. /data/teiwah)
 *
 * Values are validated once at boot via env.schema.ts → global `env`.
 * URLs below are fully resolved from `env` — no substitution at call sites.
 *
 * Example:
 *   http://host.docker.internal:4007/sessions/brave-tiger-a1b2/phone
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
 * GET — session config lookup for this worker.
 *
 * Returns the full session row including webhookUrl. Used on each inbound
 * messages.upsert to decide where to POST incoming WhatsApp messages.
 * Worker-facing; no auth guard (same as PATCH .../phone above).
 */
export const SESSION_CONFIG_URL
   = `${env.CONTROL_APP_BASE_URL}/sessions/${env.SESSION_ID}`

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
