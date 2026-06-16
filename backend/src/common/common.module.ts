import { Module, Global } from '@nestjs/common';
import { OptionalAuthGuard, RequiredAuthGuard } from './auth.guard';
import { RedisModule } from './redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [OptionalAuthGuard, RequiredAuthGuard],
  exports: [OptionalAuthGuard, RequiredAuthGuard, RedisModule],
})
export class CommonModule {}
