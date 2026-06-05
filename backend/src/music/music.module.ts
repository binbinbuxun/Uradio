import { Module } from '@nestjs/common';
import { MusicService } from './music.service';
import { StateModule } from '../state/state.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [StateModule, UserModule],
  providers: [MusicService],
  exports: [MusicService],
})
export class MusicModule {}
