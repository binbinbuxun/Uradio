import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatMessage } from './chat-message.entity';
import { StateModule } from '../state/state.module';
import { LlmModule } from '../llm/llm.module';
import { MusicModule } from '../music/music.module';
import { TtsModule } from '../tts/tts.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage]),
    StateModule,
    LlmModule,
    MusicModule,
    TtsModule,
    SchedulerModule,
  ],
  controllers: [ChatController],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class ChatModule {}
