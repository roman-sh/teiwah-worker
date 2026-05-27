# nestwaileys (teiwah-session-app)

*Last updated: May 26, 2026*

Docker image for the WhatsApp **session worker** — one pod per session in k3d. This README is **terminal ops** (build, deploy, logs). For user flows, payloads, and architecture see the repo root:

- [DESIGN.md](../DESIGN.md) — how the system behaves today
- [LOCAL_MILESTONE_CHECKPOINT.md](../LOCAL_MILESTONE_CHECKPOINT.md) — what's done / next
- [teiwah-infra/README.md](../teiwah-infra/README.md) — k3d / Traefik setup

---

## Build & load image into k3d

Run from this directory after code changes:

```bash
docker build -t teiwah-session-app:local .

k3d image import teiwah-session-app:local -c teiwah-dev
```

Building on Docker Desktop alone is **not** enough — the image must exist **inside** the k3d node (`imagePullPolicy: Never`).

---

## Pick up the new image on a session

Replace `<session-id>` (e.g. `stingy-baboon-a646`).

**Option A — restart deployment:**

```bash
kubectl rollout restart deployment/<session-id>
kubectl rollout status deployment/<session-id>
```

**Option B — delete pod (deployment recreates it):**

```bash
kubectl delete pod -l app=<session-id>
```

**Option C — fresh session:** create a new session from the dashboard (new pod, new QR).

> **Warning:** Pod restart wipes Baileys auth (`auth_info_baileys` is not on a volume). You will need to **scan QR again**.

---

## kubectl cheatsheet

```bash
# Pod status
kubectl get pods -l app=<session-id>

# All session deployments in cluster
kubectl get deployments -n default

# Live logs (stdout — pino-pretty in local image)
kubectl logs -l app=<session-id> -f

# Last 100 lines
kubectl logs -l app=<session-id> --tail=100

# Logs from previous crash (if pod restarted)
kubectl logs -l app=<session-id> --previous
```

**Clean up every session** (deployments, services, ingress, middleware):

```bash
# from teiwah-control/
./cleanup-sessions.sh
```

Also clear stale rows in Supabase if needed.

---

## Test outbound send (from your Mac)

Traefik on the host routes into the pod:

```bash
curl -X POST "http://localhost:8080/sessions/<session-id>/messages" \
  -H "Content-Type: application/json" \
  -d '{"to":"<from inbound webhook>","text":"hello"}'
```

Use the exact `from` value from the inbound payload (`@lid` or `@s.whatsapp.net`). Expect `{ "success": true }` or `503` if not connected.

Full payload / flow: [DESIGN.md §7–8](../DESIGN.md)

---

## npm (host machine, optional)

Normal path is **docker → k3d**. To run the Nest app directly on your Mac (no cluster):

```bash
npm install
npm run build
export PORT=5335 SESSION_ID=<id> CONTROL_APP_BASE_URL=http://localhost:4007
npm run start:prod
```

See `.env.example` for variables. In k3d, **teiwah-control injects env** at provision time (`teiwah-control/src/k8s.service.ts`).

| Env | Injected value (local k3d) |
|-----|----------------------------|
| `PORT` | `5335` |
| `SESSION_ID` | pod's session id |
| `CONTROL_APP_BASE_URL` | `http://host.docker.internal:4007` |

---

## Source layout (quick reference)

```
src/whatsapp/
  whatsapp.service.ts       — Baileys + SSE state
  events.controller.ts      — GET /events
  messages.controller.ts      — POST /messages
  inbound-webhook.service.ts  — forward to user webhook
  outbound-messages.service.ts
```
