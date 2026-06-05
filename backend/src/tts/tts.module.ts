import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TtsService } from './tts.service';
import { TtsController } from './tts.controller';
import { PrefetchService } from './prefetch.service';
import { MusicModule } from '../music/music.module';
import { LlmModule } from '../llm/llm.module';
import { StateModule } from '../state/state.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [ConfigModule, MusicModule, LlmModule, StateModule, SchedulerModule],
  controllers: [TtsController],
  providers: [TtsService, PrefetchService],
  exports: [TtsService, PrefetchService],
})
export class TtsModule {}
