import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';

@Injectable()
export class StateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StateService.name);
  private runtimeCookie: string | null = null;

  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    // 1. 尝试从数据库加载最新 cookie
    const user = await this.userService.findLatest();
    if (user?.cookie) {
      this.runtimeCookie = user.cookie;
      this.logger.log('Loaded cookie from database');
      return;
    }

    // 2. 如果数据库没有，从 .env 导入到数据库
    const envCookie = this.configService.get<string>('NETEASE_COOKIE');
    if (envCookie) {
      this.runtimeCookie = envCookie;
      try {
        await this.userService.upsert('env', { cookie: envCookie, nickname: 'Env User' });
        this.logger.log('Imported NETEASE_COOKIE from .env into database');
      } catch (e) {
        this.logger.warn('Failed to save env cookie to DB', e);
      }
    }
  }

  setCookie(cookie: string) {
    this.runtimeCookie = cookie;
  }

  getCookie(): string | null {
    return this.runtimeCookie;
  }
}
