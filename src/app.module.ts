import { Module } from '@nestjs/common'
import { WhatsappModule } from './whatsapp/whatsapp.module.js'

@Module({
   imports: [WhatsappModule]
})
export class AppModule {}
