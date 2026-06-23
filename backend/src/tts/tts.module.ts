import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { TtsService } from './tts.service';
import { TtsController } from './tts.controller';
import { PrefetchService } from './prefetch.service';
import { SegueEngineService } from './segue-engine.service';
import { MusicModule } from '../music/music.module';
import { LlmModule } from '../llm/llm.module';
import { StateModule } from '../state/state.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { ChatModule } from '../chat/chat.module';
import { ChatMessage } from '../chat/chat-message.entity';

@Module({
  imports: [
    ConfigModule,
    MusicModule,
    LlmModule,
    StateModule,
    SchedulerModule,
    TypeOrmModule.forFeature([ChatMessage]),
    forwardRef(() => ChatModule),  // forwardRef 避免循环依赖
  ],
  controllers: [TtsController],
  providers: [TtsService, SegueEngineService, PrefetchService],
  exports: [TtsService, SegueEngineService, PrefetchService],
})
export class TtsModule {}


