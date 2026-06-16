import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatMessage } from './chat-message.entity';
import { ChatSession } from './chat-session.entity';
import { PlayHistory } from './play-history.entity';
import { ChatSessionService } from './chat-session.service';
import { PlayHistoryService } from './play-history.service';
import { ExecutionTrace } from './execution-trace.entity';
import { TraceService } from './trace.service';
import { StateModule } from '../state/state.module';
import { LlmModule } from '../llm/llm.module';
import { MusicModule } from '../music/music.module';
import { TtsModule } from '../tts/tts.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage, ChatSession, PlayHistory, ExecutionTrace]),
    StateModule,
    LlmModule,
    MusicModule,
    forwardRef(() => TtsModule),
    SchedulerModule,
  ],
  controllers: [ChatController],
  providers: [ChatGateway, PlayHistoryService, TraceService, ChatSessionService],
  exports: [ChatGateway, PlayHistoryService, TraceService, ChatSessionService],
})
export class ChatModule {}
