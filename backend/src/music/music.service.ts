import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LRUCache } from 'lru-cache';
import { StateService } from '../state/state.service';
import { UserService } from '../user/user.service';
import {
  cloudsearch,
  song_url_v1,
  lyric,
  recommend_songs,
  captcha_sent,
  login_cellphone,
} from '@neteasecloudmusicapienhanced/api';
import type { SoundQualityType } from '@neteasecloudmusicapienhanced/api';

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);
  private searchCache = new LRUCache<string, any>({ max: 500, ttl: 5 * 60 * 1000, ttlAutopurge: true });
  private urlCache = new LRUCache<string, any>({ max: 300, ttl: 10 * 60 * 1000, ttlAutopurge: true });
  private dailyRecCache: { data: any; ts: number } | null = null;
  private readonly DAILY_REC_TTL = 30 * 60 * 1000;   // 日推缓存 30分钟

  constructor(
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
    private readonly userService: UserService,
  ) {}

  // 1. 歌曲检索（带 LRU 缓存）
  async searchMusic(keyword: string, limit = 10, offset = 0) {
    const cacheKey = `${keyword}_${limit}_${offset}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached) {
      this.logger.debug(`Search cache hit: ${keyword}`);
      return cached;
    }

    try {
      const res = await cloudsearch({ keywords: keyword, limit, offset, type: 1 });
      if (res.status === 200) {
        this.searchCache.set(cacheKey, res.body.result);
        return res.body.result;
      }
      throw new Error('Search failed');
    } catch (error: any) {
      this.logger.error(`Search music failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  // 2. 获取播放直链（带 LRU 缓存，携带登录态 cookie）
  async getSongUrl(id: string | number) {
    const cacheKey = id.toString();
    const cached = this.urlCache.get(cacheKey);
    if (cached) {
      this.logger.debug(`URL cache hit: ${id}`);
      return cached;
    }
    return this.fetchSongUrl(id, cacheKey);
  }

  // 强制刷新播放直链（链接 403 时调用）
  async refreshSongUrl(id: string | number) {
    this.urlCache.delete(id.toString());
    this.logger.debug(`URL cache invalidated for ${id}, re-fetching`);
    return this.fetchSongUrl(id, id.toString());
  }

  private async fetchSongUrl(id: string | number, cacheKey: string) {
    try {
      const cookie = this.stateService.getCookie() || this.configService.get<string>('NETEASE_COOKIE') || '';
      const res = await song_url_v1({ id: id.toString(), level: 'exhigh' as SoundQualityType, cookie });
      if (res.status === 200) {
        this.urlCache.set(cacheKey, res.body.data);
        return res.body.data;
      }
      throw new Error('Get song url failed');
    } catch (error: any) {
      this.logger.error(`Get song url failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  // 3. 获取歌词
  async getLyric(id: string | number) {
    try {
      const res = await lyric({ id: id.toString() });
      if (res.status === 200) {
        return res.body; 
      }
      throw new Error('Get lyric failed');
    } catch (error: any) {
      this.logger.error(`Get lyric failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  // 4. 获取日推（带缓存，一天只变一次）
  async getRecommendSongs(cookie?: string) {
    if (this.dailyRecCache && Date.now() - this.dailyRecCache.ts < this.DAILY_REC_TTL) {
      this.logger.debug('Daily rec cache hit');
      return this.dailyRecCache.data;
    }

    try {
      const runtimeCookie = this.stateService.getCookie();
      const finalCookie = cookie || runtimeCookie || this.configService.get<string>('NETEASE_COOKIE') || '';
      const res = await recommend_songs({ cookie: finalCookie });
      if (res.status === 200) {
        this.dailyRecCache = { data: res.body.data, ts: Date.now() };
        return res.body.data;
      }
      throw new Error('Get recommend songs failed');
    } catch (error: any) {
      this.logger.error(`Get recommend songs failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  // 5. 发送手机验证码
  async sendCaptcha(phone: string, countrycode = '86') {
    try {
      const res = await captcha_sent({ phone, ctcode: countrycode });
      if (res.status === 200 && res.body.code === 200) {
        return { success: true };
      }
      throw new Error(`Captcha send failed: code ${res.body.code}`);
    } catch (error: any) {
      this.logger.error(`Send captcha failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  // 6. 手机验证码登录，自动提取 cookie 存入运行时状态
  async loginWithCaptcha(phone: string, captcha: string, countrycode = '86') {
    try {
      const res = await login_cellphone({ phone, captcha, countrycode: countrycode });
      if (res.status === 200 && res.body.code === 200) {
        const body = res.body as any;
        const cookie = body.cookie;
        if (cookie) {
          this.stateService.setCookie(cookie);
        }
        // 保存用户信息到数据库
        try {
          await this.userService.upsert(phone, {
            cookie,
            nickname: body.profile?.nickname,
          });
        } catch (e) {
          this.logger.warn('Failed to save user to DB', e);
        }
        return {
          success: true,
          nickname: body.profile?.nickname,
          avatarUrl: body.profile?.avatarUrl,
        };
      }
      throw new Error(`Login failed: code ${res.body.code}`);
    } catch (error: any) {
      this.logger.error(`Login with captcha failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
