import { Module, Global } from '@nestjs/common';
import { OptionalAuthGuard, RequiredAuthGuard } from './auth.guard';

@Global()
@Module({
  providers: [OptionalAuthGuard, RequiredAuthGuard],
  exports: [OptionalAuthGuard, RequiredAuthGuard],
})
export class CommonModule {}
