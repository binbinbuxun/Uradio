import { Module } from '@nestjs/common';
import { StateService } from './state.service';
import { PlaybackStateService } from './playback-state.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  providers: [StateService, PlaybackStateService],
  exports: [StateService, PlaybackStateService],
})
export class StateModule {}
