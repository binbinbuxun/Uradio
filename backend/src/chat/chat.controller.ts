import { Controller, Post, Get, Delete, Body, Req, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatGateway } from './chat.gateway';
import { ChatMessage } from './chat-message.entity';
import { LlmService } from '../llm/llm.service';
import { PlaybackStateService } from '../state/playback-state.service';
import { MusicService } from '../music/music.service';
import { TtsService } from '../tts/tts.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { detectIntent } from './intent-detector';
import type { Request } from 'express';

@Controller('api')
export class ChatController {
  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly llmService: LlmService,
    private readonly playbackState: PlaybackStateService,
    private readonly musicService: MusicService,
    private readonly ttsService: TtsService,
    private readonly schedulerService: SchedulerService,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepo: Repository<ChatMessage>,
  ) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async handleChat(
    @Body('message') message: string,
    @Body('volume') clientVolume: number,
    @Req() req: Request,
  ) {
    if (!message || typeof message !== 'string') {
      return { status: 'error', message: 'Message is required' };
    }

    const chatId = `chat_${Date.now()}`;

    // 保存用户消息到数据库
    this.chatMessageRepo.save(
      this.chatMessageRepo.create({ chatId, role: 'user', content: message, metadata: null }),
    ).catch(e => console.error('Failed to save user chat message:', e));

    // 意图检测
    const intent = detectIntent(message);
    let actionContext = '';
    let recommendedSongs: any[] = [];
    let searchResults: any[] = [];

    // 延迟执行的控制命令队列
    const deferredControls: { command: string; payload?: any }[] = [];

    if (intent.type) {
      switch (intent.type) {
        case 'next':
          this.playbackState.nextTrack();
          deferredControls.push({ command: 'next' });
          actionContext = '[系统指令: 用户要求切换下一首歌，已执行切歌操作。]';
          break;

        case 'prev':
          this.playbackState.prevTrack();
          deferredControls.push({ command: 'prev' });
          actionContext = '[系统指令: 用户要求播放上一首歌，已执行回退操作。]';
          break;

        case 'pause':
          this.playbackState.setPaused();
          deferredControls.push({ command: 'pause' });
          actionContext = '[系统指令: 用户要求暂停播放，已暂停。]';
          break;

        case 'play':
          this.playbackState.updateState({ action: 'play' });
          deferredControls.push({ command: 'play' });
          actionContext = '[系统指令: 用户要求继续播放，已恢复播放。]';
          break;

        case 'add_song':
          if (intent.params?.keyword) {
            try {
              const searchResult: any = await this.musicService.searchMusic(intent.params.keyword, 5);
              const songs = (searchResult?.songs || []).slice(0, 3);
              const newTracks = songs.map((song: any) => ({
                type: 'song' as const,
                id: song.id.toString(),
                name: song.name,
                title: song.name,
                artist: song.ar?.map((a: any) => a.name).join(' / ') || '',
                album: song.al?.name || '',
                duration: song.dt ? Math.floor(song.dt / 1000) : 0,
                coverUrl: song.al?.picUrl || '',
                cover: song.al?.picUrl || '',
                url: `/audio/${song.id}`,
              }));
              this.playbackState.addToPlaylist(newTracks);
              recommendedSongs = newTracks;
              this.chatGateway.broadcastPlaylistUpdate({
                action: 'add',
                songs: newTracks,
                playlist: this.playbackState.getPlaylist(),
              });
              const songList = newTracks.map((t: any) => `《${t.name}》-${t.artist}`).join('、');
              actionContext = `[系统指令: 用户想听${intent.params.keyword}的歌，已搜索并添加以下歌曲到播放列表: ${songList}。]`;
            } catch {
              actionContext = `[系统指令: 用户想听${intent.params.keyword}的歌，但搜索失败了。]`;
            }
          }
          break;

        case 'search_song':
          if (intent.params?.keyword) {
            try {
              const searchResult: any = await this.musicService.searchMusic(intent.params.keyword, 5);
              const songs = (searchResult?.songs || []).slice(0, 5);
              searchResults = songs.map((song: any) => ({
                id: song.id.toString(),
                name: song.name,
                artist: song.ar?.map((a: any) => a.name).join(' / ') || '',
                cover: song.al?.picUrl || '',
                url: `/audio/${song.id}`,
              }));
              const songList = searchResults.map((t: any) => `《${t.name}》-${t.artist}`).join('、');
              actionContext = `[系统指令: 用户想听${intent.params.keyword}的歌，已搜索到以下歌曲，请推荐给用户选择: ${songList}。]`;
            } catch {
              actionContext = `[系统指令: 用户想听${intent.params.keyword}的歌，但搜索失败了，请告知用户操作失败。]`;
            }
          }
          break;

        case 'remove_song': {
          let removed = false;
          let removeIndex: number | undefined;
          if (intent.params?.index !== undefined) {
            const zeroIndex = intent.params.index - 1;
            removed = this.playbackState.removeFromPlaylist(zeroIndex);
            removeIndex = zeroIndex;
          } else if (intent.params?.songName) {
            const result = this.playbackState.removeFromPlaylistByName(intent.params.songName);
            removed = result.removed;
            removeIndex = result.index;
          }
          if (removed) {
            this.chatGateway.broadcastPlaylistUpdate({
              action: 'remove',
              index: removeIndex,
              playlist: this.playbackState.getPlaylist(),
            });
            const target = intent.params?.songName || `第${intent.params?.index}首`;
            actionContext = `[系统指令: 用户要求删除${target}，已从播放列表移除。]`;
          } else {
            const target = intent.params?.songName || `第${intent.params?.index}首`;
            actionContext = `[系统指令: 用户要求删除${target}，但未找到该歌曲。]`;
          }
          break;
        }

        case 'volume_up':
        case 'volume_down': {
          const currentVol = this.playbackState.getState().volume;
          const delta = intent.type === 'volume_up' ? 15 : -15;
          const targetVol = Math.max(0, Math.min(100, currentVol + delta));
          this.playbackState.setVolume(targetVol);
          deferredControls.push({
            command: 'volume',
            payload: { volume: targetVol / 100 },
          });
          actionContext = `[系统指令: 用户调整音量，当前音量${targetVol}%。]`;
          break;
        }
      }

      // 广播更新后的播放状态
      const updatedState = this.playbackState.getState();
      this.chatGateway.broadcastNowPlaying({
        action: updatedState.action,
        content: updatedState.content,
        position: updatedState.position,
      });
    }

    // 获取当前播放状态作为上下文
    const currentState = this.playbackState.getState();
    const currentTrack = currentState.content?.title || '无';

    try {
      // 流式推送开始
      this.chatGateway.broadcastChatStream({
        role: 'dj',
        delta: '',
        done: false,
        metadata: { chatId },
      });

      // 获取时段上下文
      const currentHour = new Date().getHours();
      const currentSlot = this.schedulerService.getCurrentSlot(currentHour);
      const schedulerContext = currentSlot
        ? `[当前时段: ${currentSlot.label}, ${currentSlot.mood}, 推荐曲风: ${currentSlot.genres.join('、')}]`
        : '';

      // 获取近期对话历史（最近20条）
      const recentHistory = await this.chatMessageRepo.find({
        order: { createdAt: 'DESC' },
        take: 20,
      });
      recentHistory.reverse(); // 按时间正序
      const historyMessages = recentHistory.map(m => ({
        role: m.role,
        content: m.content,
      }));

      // 构造 LLM 输入
      let userContent = actionContext
        ? `${actionContext}\n\n用户说: ${message}`
        : `[当前播放: ${currentTrack}] ${message}`;

      if (schedulerContext) {
        userContent = `${schedulerContext}\n${userContent}`;
      }

      // 调用 LLM 生成结构化回复（注入对话历史保持上下文连贯）
      const structured = await this.llmService.chatStructured([
        ...historyMessages,
        { role: 'user', content: userContent },
      ]);

      if (structured) {
        const djText = structured.say;

        // 保存 DJ 回复到数据库
        this.chatMessageRepo.save(
          this.chatMessageRepo.create({
            chatId,
            role: 'dj',
            content: djText,
            metadata: {
              recommendedSongs,
              structuredReason: structured.reason || undefined,
            },
          }),
        ).catch(e => console.error('Failed to save DJ chat message:', e));

        // LLM 结构化输出中的 action（补充 regex 未覆盖的意图）
        if (structured.action && deferredControls.length === 0) {
          switch (structured.action) {
            case 'next':
              this.playbackState.nextTrack();
              deferredControls.push({ command: 'next' });
              break;
            case 'prev':
              this.playbackState.prevTrack();
              deferredControls.push({ command: 'prev' });
              break;
            case 'pause':
              this.playbackState.setPaused();
              deferredControls.push({ command: 'pause' });
              break;
            case 'play':
              this.playbackState.updateState({ action: 'play' });
              deferredControls.push({ command: 'play' });
              break;
          }
        }

        // 处理 LLM 指定的推荐歌曲（play[] 字段）
        if (structured.play.length > 0 && recommendedSongs.length === 0) {
          for (const item of structured.play.slice(0, 3)) {
            const kw = item.keyword || item.title || '';
            if (!kw || kw.length > 50) continue;
            try {
              const result: any = await this.musicService.searchMusic(kw, 1);
              const song = result?.songs?.[0];
              if (song) {
                recommendedSongs.push({
                  id: song.id.toString(),
                  name: song.name,
                  artist: song.ar?.map((a: any) => a.name).join(' / ') || '',
                  cover: song.al?.picUrl || '',
                  url: `/audio/${song.id}`,
                });
              }
            } catch {
              // 搜索失败跳过
            }
          }
        }

        // 启动 TTS 流式合成（与文本流并行）
        const vol = typeof clientVolume === 'number' ? clientVolume : 0.5;
        const ttsVolume = `${Math.round((vol - 0.5) * 100)}%`;

        const ttsPromise = this.ttsService.synthesizeStream({
          text: djText,
          voice: 'zh-CN-Xiaoxiao:DragonHDFlashLatestNeural',
          rate: '+0%',
          pitch: '-5Hz',
          style: 'calm',
          volume: ttsVolume,
        })
          .then(async (stream) => {
            const reader = stream.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
              const { done, value } = await reader.read();
              if (value) {
                chunks.push(value);
                // 流式推送音频 chunk
                const chunkBase64 = Buffer.from(value).toString('base64');
                this.chatGateway.broadcastChatStream({
                  role: 'dj',
                  delta: '',
                  done: false,
                  metadata: { chatId, ttsChunk: chunkBase64 },
                });
              }
              if (done) break;
            }
            return Buffer.concat(chunks);
          })
          .catch(e => { console.error('TTS streaming failed:', e); return null; });

        // 延迟 800ms 再开始流式推送文本
        await new Promise((r) => setTimeout(r, 800));

        // 流式推送文本
        const words = djText.split('');
        let buffer = '';

        for (let i = 0; i < words.length; i++) {
          buffer += words[i];
          if (i % 5 === 4 || i === words.length - 1) {
            this.chatGateway.broadcastChatStream({
              role: 'dj',
              delta: buffer,
              done: false,
            });
            buffer = '';
            await new Promise((r) => setTimeout(r, 30));
          }
        }

        // 发送推荐歌曲元数据
        if (recommendedSongs.length > 0) {
          this.chatGateway.broadcastChatStream({
            role: 'dj',
            delta: '',
            done: false,
            metadata: {
              chatId,
              recommendedSongs: recommendedSongs.map(s => ({
                id: s.id,
                name: s.name,
                artist: s.artist,
                cover: s.cover || s.coverUrl,
                url: s.url,
              })),
            },
          });
        }

        // 发送搜索结果（供用户选择，不自动播放）
        if (searchResults.length > 0) {
          this.chatGateway.broadcastChatStream({
            role: 'dj',
            delta: '',
            done: false,
            metadata: {
              chatId,
              searchResults,
            },
          });
        }

        // 等待 TTS 流水线完成，发送结束标记
        const ttsBuffer = await ttsPromise;
        if (ttsBuffer) {
          this.chatGateway.broadcastChatStream({
            role: 'dj',
            delta: '',
            done: false,
            metadata: { chatId, ttsDone: true },
          });
        }

        // 延迟 1.5s 执行控制指令
        if (deferredControls.length > 0) {
          setTimeout(() => {
            for (const ctrl of deferredControls) {
              this.chatGateway.broadcastControlCommand(ctrl);
            }
          }, 1500);
        }
      }

      this.chatGateway.broadcastChatEnd({ id: chatId });

      return { status: 'success', chatId };
    } catch (error) {
      this.chatGateway.broadcastChatEnd({ id: chatId });
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Chat failed',
      };
    }
  }

  @Get('chat/history')
  async getChatHistory(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '50', 10) || 50, 200);
    const messages = await this.chatMessageRepo.find({
      order: { createdAt: 'DESC' },
      take,
    });
    messages.reverse();
    return messages.map(m => ({
      id: `msg_${m.id}`,
      role: m.role,
      content: m.content,
      timestamp: m.createdAt.getTime(),
      recommendedSongs: m.metadata?.recommendedSongs || undefined,
      searchResults: m.metadata?.searchResults || undefined,
    }));
  }

  @Delete('chat/history')
  @HttpCode(HttpStatus.OK)
  async clearChatHistory() {
    await this.chatMessageRepo.clear();
    return { status: 'success' };
  }
}
