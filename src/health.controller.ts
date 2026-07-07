import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common'

/**
 * Kubernetes readiness probe for session worker pods.
 *
 * Customer traffic reaches this app through Traefik with the
 * `/sessions/:sessionId` prefix stripped. The probe does not — kubelet calls
 * the container port directly at `/health`.
 *
 * A 200 means Nest is listening and can accept HTTP (including SSE on
 * `/events`). It intentionally does not wait for Baileys to emit a QR; callers
 * observe WhatsApp state on the event stream.
 *
 * @see DEMO.md — demo pool waits for this probe before marking a worker available.
 */
@Controller()
export class HealthController {
   @Get('health')
   @HttpCode(HttpStatus.OK)
   @Header('Content-Type', 'text/plain; charset=utf-8')
   health(): string {
      return 'OK'
   }
}
