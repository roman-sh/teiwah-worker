import { Controller, Get, Param, StreamableFile } from '@nestjs/common'
import { MediaService } from './media.service.js'

/**
 * Download inbound media by its native message id (API.md §6.1).
 *
 * Auth model matches MessagesController — Zuplo validates the per-session API
 * key upstream and routes to this pod; the key is scoped to one session, so the
 * worker trusts the routed request without an ownership check.
 *
 * Local URL (via Traefik):
 *   GET http://localhost:8080/sessions/:sessionId/media/:id
 *
 * Production (via Zuplo):
 *   GET https://api.teiwah.com/media/:id
 *   Authorization: Bearer <session-api-key>
 *
 * `:id` is the inbound webhook `id` (the same `media.url` the webhook stamps).
 */
@Controller()
export class MediaController {
   constructor(private readonly mediaService: MediaService) {}

   @Get('media/:id')
   async getMedia(@Param('id') id: string): Promise<StreamableFile> {
      const { buffer, mimeType, contentDisposition } =
         await this.mediaService.download(id)

      // StreamableFile sets Content-Type/-Disposition/-Length; the Zuplo
      // forwarder passes them straight through to the customer.
      return new StreamableFile(buffer, {
         type: mimeType,
         disposition: contentDisposition,
         length: buffer.length
      })
   }
}
