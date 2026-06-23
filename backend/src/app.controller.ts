import { Controller, Get, Post, Body, Headers, Param, Res, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service';
import { MusicService } from './music/music.service';
import { StateService } from './state/state.service';
import { PlaybackStateService, PlaybackContent } from './state/playback-state.service';
import { ChatGateway } from './chat/chat.gateway';
import { TasteService } from './user/taste.service';
import type { Response } from 'express';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly musicService: MusicService,
    private readonly stateService: StateService,
    private readonly playbackState: PlaybackStateService,
    private readonly chatGateway: ChatGateway,
    private readonly tasteService: TasteService,
  ) {}

  private toQueueItem(track: PlaybackContent) {
    return {
      id: track.id,
      name: track.title,
      artist: track.artist || '',
      cover: track.coverUrl || '',
      url: track.url || `/audio/${track.id}`,
    };
  }

  private toPlaybackTrack(track: any): PlaybackContent {
    return {
      type: 'song',
      id: track.id?.toString() || '',
      title: track.title || track.name || '',
      artist: track.artist || '',
      album: track.album || '',
      duration: track.duration || 0,
      coverUrl: track.coverUrl || track.cover || '',
      url: track.url?.startsWith('http') ? track.url : (track.url || `/audio/${track.id}`),
    };
  }

  private getQueueSnapshot() {
    const state = this.playbackState.getState();
    return {
      playlist: state.playlist.map((track) => this.toQueueItem(track)),
      currentIndex: state.currentIndex,
      action: state.action,
      currentTrackId: state.content?.id || null,
    };
  }

  private async ensureQueueInitialized() {
    const managedPlaylist = this.playbackState.getPlaylist();
    if (managedPlaylist.length > 0) {
      return this.getQueueSnapshot();
    }

    const recommendData: any = await this.musicService.getRecommendSongs();
    if (!recommendData || !recommendData.dailySongs || recommendData.dailySongs.length === 0) {
      return {
        playlist: [],
        currentIndex: 0,
        action: 'pause',
        currentTrackId: null,
      };
    }

    const songs = recommendData.dailySongs.slice(0, 30);
    const tracks = songs.map((song: any) => ({
      type: 'song' as const,
      id: song.id.toString(),
      title: song.name,
      artist: song.ar.map((a: any) => a.name).join(' / '),
      album: song.al?.name || '',
      duration: song.dt ? Math.floor(song.dt / 1000) : 0,
      coverUrl: song.al.picUrl || '',
      url: `/audio/${song.id}`,
    }));
    this.playbackState.setPlaylist(tracks);
    return this.getQueueSnapshot();
  }

  // ========== 播放状态 ==========

  @Get('api/now')
  async getNowPlaying() {
    return this.playbackState.getState();
  }

  @Post('api/control')
  @HttpCode(HttpStatus.OK)
  async control(
    @Body('command') command: string,
    @Body('payload') payload?: any,
  ) {
    let status: 'ok' | 'error' = 'ok';

    switch (command) {
      case 'play':
        if (this.playbackState.getState().action === 'pause') {
          this.playbackState.updateState({ action: 'play' });
        }
        break;
      case 'pause':
        this.playbackState.setPaused();
        break;
      case 'next':
        this.playbackState.nextTrack();
        break;
      case 'prev':
        this.playbackState.prevTrack();
        break;
      case 'seek':
        if (payload?.position !== undefined) {
          this.playbackState.seek(payload.position);
        }
        break;
      case 'volume':
        if (payload?.volume !== undefined) {
          this.playbackState.setVolume(payload.volume);
        }
        break;
      case 'shuffle':
        this.playbackState.updateState({ shuffle: payload?.shuffle ?? true });
        break;
      case 'repeat':
        this.playbackState.updateState({ repeat: payload?.repeat || 'off' });
        break;
      default:
        status = 'error';
    }

    const state = this.playbackState.getState();
    this.chatGateway.broadcastNowPlaying({
      action: command,
      content: state.content,
      position: state.position,
      currentIndex: state.currentIndex,
      queue: this.getQueueSnapshot(),
    });

    return { status, command, queue: this.getQueueSnapshot() };
  }

  @Get('api/queue')
  async getQueue() {
    return this.ensureQueueInitialized();
  }

  @Post('api/queue/add')
  @HttpCode(HttpStatus.OK)
  async addQueueTrack(
    @Body('track') track?: any,
    @Body('tracks') tracks?: any[],
    @Body('insertAt') insertAt?: number,
    @Body('playNow') playNow?: boolean,
    @Body('source') source?: 'manual' | 'chat' | 'radio_auto',
  ) {
    const incoming = Array.isArray(tracks) ? tracks : (track ? [track] : []);
    if (incoming.length === 0) {
      return { status: 'error', message: 'Track is required' };
    }

    const mappedTracks = incoming.map((item) => this.toPlaybackTrack(item));
    const stateBefore = this.playbackState.getState();
    const resolvedInsertAt = typeof insertAt === 'number'
      ? Math.max(0, Math.min(insertAt, stateBefore.playlist.length))
      : stateBefore.currentIndex + 1;

    this.playbackState.addToPlaylist(mappedTracks, resolvedInsertAt);

    if (playNow) {
      this.playbackState.setCurrentIndex(resolvedInsertAt);
      this.playbackState.updateState({ action: 'play' });
    }

    const queue = this.getQueueSnapshot();
    this.chatGateway.broadcastPlaylistUpdate({
      action: 'add',
      songs: mappedTracks,
      playlist: queue.playlist,
      currentIndex: queue.currentIndex,
      source: source || 'manual',
    });

    if (playNow) {
      const state = this.playbackState.getState();
      this.chatGateway.broadcastNowPlaying({
        action: 'play',
        content: state.content,
        position: state.position,
        currentIndex: state.currentIndex,
        queue,
      });
    }

    return { status: 'success', queue };
  }

  @Post('api/queue/select')
  @HttpCode(HttpStatus.OK)
  async selectQueueTrack(@Body('index') index: number) {
    const queue = await this.ensureQueueInitialized();
    if (typeof index !== 'number' || index < 0 || index >= queue.playlist.length) {
      return { status: 'error', message: 'Invalid queue index' };
    }

    this.playbackState.setCurrentIndex(index);
    this.playbackState.updateState({ action: 'play' });

    const state = this.playbackState.getState();
    const snapshot = this.getQueueSnapshot();
    this.chatGateway.broadcastNowPlaying({
      action: 'play',
      content: state.content,
      position: state.position,
      currentIndex: state.currentIndex,
      queue: snapshot,
    });

    return { status: 'success', queue: snapshot };
  }

  // ========== 网易云登录 ==========

  @Post('api/cookie')
  async setCookie(@Body('cookie') cookie: string) {
    if (!cookie || typeof cookie !== 'string') {
      return { status: 'error', message: 'Cookie is required' };
    }
    this.stateService.setCookie(cookie);
    return { status: 'success' };
  }

  @Post('api/send-captcha')
  async sendCaptcha(@Body('phone') phone: string, @Body('countrycode') countrycode?: string) {
    if (!phone || typeof phone !== 'string') {
      return { status: 'error', message: 'Phone number is required' };
    }
    try {
      await this.musicService.sendCaptcha(phone, countrycode || '86');
      return { status: 'success' };
    } catch {
      return { status: 'error', message: 'Failed to send captcha' };
    }
  }

  @Post('api/login')
  async login(
    @Body('phone') phone: string,
    @Body('captcha') captcha: string,
    @Body('countrycode') countrycode?: string,
  ) {
    if (!phone || !captcha) {
      return { status: 'error', message: 'Phone and captcha are required' };
    }
    try {
      const result = await this.musicService.loginWithCaptcha(phone, captcha, countrycode || '86');
      return { status: 'success', ...result };
    } catch {
      return { status: 'error', message: 'Login failed' };
    }
  }

  @Post('api/logout')
  async logout() {
    this.stateService.setCookie('');
    return { status: 'success' };
  }

  @Get('api/login-status')
  async loginStatus() {
    const cookie = this.stateService.getCookie();
    return { loggedIn: !!cookie };
  }

  // ========== 用户品味 ==========

  @Get('api/taste')
  async getTaste() {
    return this.tasteService.getTaste();
  }

  // ========== 测试 ==========

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('test-music')
  async testMusic() {
    return await this.musicService.getRecommendSongs();
  }

  @Get('api/lyric/:id')
  async getLyric(@Param('id') id: string) {
    try {
      const data: any = await this.musicService.getLyric(id);
      return { lyric: data?.lrc?.lyric || '' };
    } catch {
      return { lyric: '' };
    }
  }

  // ========== 播放列表 ==========

  @Get('playlist')
  async getPlaylist() {
    const queue = await this.ensureQueueInitialized();
    return queue.playlist;
  }

  // ========== 音频流 ==========

  @Get('audio/:id')
  async streamAudio(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    let urls: any = await this.musicService.getSongUrl(id);
    let songUrl = Array.isArray(urls) ? urls.find((item: any) => item?.url)?.url : urls?.[0]?.url;

    if (!songUrl) {
      return res.status(404).json({ error: 'Audio source not found' });
    }

    let response = await fetch(songUrl, {
      headers: range ? { Range: range } : undefined,
    });

    if ((response.status === 403 || response.status === 404) && !response.ok) {
      console.log(`Audio URL expired for ${id}, refreshing and retrying...`);
      try {
        urls = await this.musicService.refreshSongUrl(id);
        songUrl = Array.isArray(urls) ? urls.find((item: any) => item?.url)?.url : urls?.[0]?.url;
        if (songUrl) {
          response = await fetch(songUrl, {
            headers: range ? { Range: range } : undefined,
          });
        }
      } catch {
        // retry failed, use original response
      }
    }

    if (!response.ok || !response.body) {
      return res.status(response.status).json({ error: 'Failed to fetch audio source' });
    }

    const headersToForward = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'cache-control', 'last-modified', 'etag'];

    headersToForward.forEach((headerName) => {
      const headerValue = response.headers.get(headerName);
      if (headerValue) {
        res.setHeader(headerName, headerValue);
      }
    });

    res.status(response.status);

    const webStream = response.body as any;
    const nodeStream = typeof webStream?.pipe === 'function' ? webStream : undefined;

    if (nodeStream) {
      return nodeStream.pipe(res);
    }

    const reader = response.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        res.write(Buffer.from(value));
      }
      res.end();
    };

    await pump();
  }
}
