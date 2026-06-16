import { Controller, Post, Get, Delete, Body, Req, HttpCode, HttpStatus, Query, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatGateway } from './chat.gateway';
import { ChatMessage } from './chat-message.entity';
import { ChatSessionService } from './chat-session.service';
import { PlayHistory } from './play-history.entity';
import { PlayHistoryService } from './play-history.service';
import { TraceService, ActiveTrace } from './trace.service';
import { ExecutionTrace } from './execution-trace.entity';
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
    private readonly playHistoryService: PlayHistoryService,
    private readonly traceService: TraceService,
    private readonly chatSessionService: ChatSessionService,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepo: Repository<ChatMessage>,
    @InjectRepository(PlayHistory)
    private readonly playHistoryRepo: Repository<PlayHistory>,
  ) {}

  // ─── 会话管理端点 ───────────────────────────────────────

  /** 获取所有会话列表 */
  @Get('chat/sessions')
  @HttpCode(HttpStatus.OK)
  async getSessions() {
    const sessions = await this.chatSessionService.listSessions();
    return { status: 'success', sessions };
  }

  /** 创建新会话 */
  @Post('chat/sessions')
  @HttpCode(HttpStatus.OK)
  async createSession(@Body('title') title?: string) {
    const session = await this.chatSessionService.createSession(title || '');
    return { status: 'success', session };
  }

  /** 获取会话的所有消息 */
  @Get('chat/sessions/:id/messages')
  @HttpCode(HttpStatus.OK)
  async getSessionMessages(@Param('id') id: string) {
    const sessionId = parseInt(id, 10);
    if (isNaN(sessionId)) return { status: 'error', message: 'Invalid session id' };
    const result = await this.chatSessionService.getSessionWithPreview(sessionId);
    if (!result) return { status: 'not_found', message: 'Session not found' };
    return {
      status: 'success',
      session: result.session,
      messages: result.messages.map(m => ({
        id: m.id,
        chatId: m.chatId,
        role: m.role,
        content: m.content,
        timestamp: m.createdAt.getTime(),
        metadata: m.metadata,
      })),
    };
  }

  /** 删除会话（消息保留，sessionId 置 null） */
  @Delete('chat/sessions/:id')
  @HttpCode(HttpStatus.OK)
  async deleteSession(@Param('id') id: string) {
    const sessionId = parseInt(id, 10);
    if (isNaN(sessionId)) return { status: 'error', message: 'Invalid session id' };
    await this.chatSessionService.deleteSession(sessionId);
    return { status: 'success' };
  }

  // ─── 对话端点 ───────────────────────────────────────────

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async handleChat(
    @Body('message') message: string,
    @Body('volume') clientVolume: number,
    @Body('sessionId') sessionIdStr: string | undefined,
    @Req() req: Request,
  ) {
    if (!message || typeof message !== 'string') {
      return { status: 'error', message: 'Message is required' };
    }

    // ── 会话处理 ──────────────────────────────────────
    let sessionId: number | null = null;
    if (sessionIdStr) {
      const parsed = parseInt(sessionIdStr, 10);
      if (!isNaN(parsed)) {
        const existing = await this.chatSessionService['sessionRepo'].findOne({
          where: { id: parsed },
        }).catch(() => null);
        if (existing) sessionId = parsed;
      }
    }
    if (!sessionId) {
      // 自动创建新会话
      const newSession = await this.chatSessionService.createSession('');
      sessionId = newSession.id;
    }

    const chatId = `chat_${Date.now()}`;
    // 创建执行轨迹
    const trace = this.traceService.startTrace(chatId);

    // 保存用户消息到数据库
    this.chatMessageRepo.save(
      this.chatMessageRepo.create({
        chatId,
        role: 'user',
        content: message,
        metadata: null,
        sessionId,
      }),
    ).catch(e => console.error('Failed to save user chat message:', e));

    // 递增会话消息计数
    this.chatSessionService.incrementMessageCount(sessionId).catch(e =>
      console.error('Failed to increment message count:', e));

    // 如果是会话的第一条消息，异步生成标题
    const session = await this.chatSessionService['sessionRepo'].findOne({
      where: { id: sessionId },
    });
    if (session && (!session.title || session.title === '' || session.messageCount <= 1)) {
      this.chatSessionService.autoGenerateTitle(sessionId, message);
    }

    // 意图检测 — 计时
    const intentStart = Date.now();
    const intent = detectIntent(message);
    trace.addStep('intent_detection', Date.now() - intentStart, {
      type: intent.type,
      params: intent.params,
    });

    let actionContext = '';
    let recommendedSongs: any[] = [];
    let searchResults: any[] = [];

    // 延迟执行的控制命令队列
    const deferredControls: { command: string; payload?: any }[] = [];

    // 提前获取当前播放状态 (用于意图处理和上下文构建)
    const currentState = this.playbackState.getState();

    if (intent.type) {
      switch (intent.type) {
        case 'next': {
          // 记录当前歌被切走时的播放位置
          const beforeContent = currentState.content;
          if (beforeContent) {
            this.playHistoryService.record({
              songId: beforeContent.id,
              title: beforeContent.title,
              artist: beforeContent.artist,
              album: beforeContent.album,
              coverUrl: beforeContent.coverUrl,
              duration: beforeContent.duration,
              trigger: 'auto_next',
              chatId,
              position: currentState.position,
            }).catch(e => console.error('Failed to record play history:', e));
          }
          this.playbackState.nextTrack();
          // 记录切到的新歌
          const nextContent = this.playbackState.getState().content;
          if (nextContent) {
            this.playHistoryService.record({
              songId: nextContent.id,
              title: nextContent.title,
              artist: nextContent.artist,
              album: nextContent.album,
              coverUrl: nextContent.coverUrl,
              duration: nextContent.duration,
              trigger: 'auto_next',
              chatId,
            }).catch(e => console.error('Failed to record play history:', e));
          }
          deferredControls.push({ command: 'next' });
          actionContext = '[系统指令: 用户要求切换下一首歌，已执行切歌操作。]';
          break;
        }

        case 'prev': {
          const beforeContent = currentState.content;
          if (beforeContent) {
            this.playHistoryService.record({
              songId: beforeContent.id,
              title: beforeContent.title,
              artist: beforeContent.artist,
              album: beforeContent.album,
              coverUrl: beforeContent.coverUrl,
              duration: beforeContent.duration,
              trigger: 'manual',
              chatId,
              position: currentState.position,
            }).catch(e => console.error('Failed to record play history:', e));
          }
          this.playbackState.prevTrack();
          const prevContent = this.playbackState.getState().content;
          if (prevContent) {
            this.playHistoryService.record({
              songId: prevContent.id,
              title: prevContent.title,
              artist: prevContent.artist,
              album: prevContent.album,
              coverUrl: prevContent.coverUrl,
              duration: prevContent.duration,
              trigger: 'manual',
              chatId,
            }).catch(e => console.error('Failed to record play history:', e));
          }
          deferredControls.push({ command: 'prev' });
          actionContext = '[系统指令: 用户要求播放上一首歌，已执行回退操作。]';
          break;
        }

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
            const searchStart = Date.now();
            try {
              const searchResult: any = await this.musicService.searchMusic(intent.params.keyword, 5);
              const songs = (searchResult?.songs || []).slice(0, 3);
              trace.addStep('music_search', Date.now() - searchStart, {
                keyword: intent.params.keyword,
                resultCount: songs.length,
              });
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
              // 记录播放历史
              for (const track of newTracks) {
                this.playHistoryService.record({
                  songId: track.id,
                  title: track.title,
                  artist: track.artist,
                  album: track.album,
                  coverUrl: track.coverUrl,
                  duration: track.duration,
                  trigger: 'user_request',
                  chatId,
                }).catch(e => console.error('Failed to record play history:', e));
              }
              this.chatGateway.broadcastPlaylistUpdate({
                action: 'add',
                songs: newTracks,
                playlist: this.playbackState.getPlaylist(),
              });
              const songList = newTracks.map((t: any) => `《${t.name}》-${t.artist}`).join('、');
              actionContext = `[系统指令: 用户想听${intent.params.keyword}的歌，已搜索并添加以下歌曲到播放列表: ${songList}。]`;
            } catch {
              trace.addStep('music_search', Date.now() - searchStart, undefined, 'error', 'Search failed');
              actionContext = `[系统指令: 用户想听${intent.params.keyword}的歌，但搜索失败了。]`;
            }
          }
          break;

        case 'search_song':
          if (intent.params?.keyword) {
            const searchStart = Date.now();
            try {
              const searchResult: any = await this.musicService.searchMusic(intent.params.keyword, 5);
              const songs = (searchResult?.songs || []).slice(0, 5);
              trace.addStep('music_search', Date.now() - searchStart, {
                keyword: intent.params.keyword,
                resultCount: songs.length,
              });
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
              trace.addStep('music_search', Date.now() - searchStart, undefined, 'error', 'Search failed');
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
    const currentContent = currentState.content;
    // C: 丰富播放上下文 — 歌名+歌手+专辑，而非仅歌名
    const currentTrack = currentContent
      ? `${currentContent.title}${currentContent.artist ? ' - ' + currentContent.artist : ''}${currentContent.album ? ' (' + currentContent.album + ')' : ''}`
      : '无';

    // C: 构造播放列表摘要（当前播放位置前后各2首）
    const playlist = currentState.playlist;
    const curIdx = currentState.currentIndex;
    const playlistSummary = playlist.length > 0
      ? playlist.slice(Math.max(0, curIdx - 2), Math.min(playlist.length, curIdx + 4))
          .map((t, i) => {
            const globalIdx = Math.max(0, curIdx - 2) + i;
            const marker = globalIdx === curIdx ? '▶' : '  ';
            return `${marker} [${globalIdx + 1}] ${t.title}${t.artist ? ' - ' + t.artist : ''}`;
          })
          .join('\n')
      : '空';

    // C: 最近播放历史 — 从 PlayHistory 持久化表查询 (取代内存 playlist 索引)
    const recentPlayed = await this.playHistoryService.getRecentFormatted(5);

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
      const historyStart = Date.now();
      const recentHistory = await this.chatMessageRepo.find({
        order: { createdAt: 'DESC' },
        take: 20,
      });
      recentHistory.reverse(); // 按时间正序
      trace.addStep('load_history', Date.now() - historyStart, { count: recentHistory.length });

      // F: assistant 历史消息附加推荐歌曲信息，让 LLM 知道之前推荐了什么
      // F+: 串场消息也附加上下文，让 LLM 知道之前做了什么串场介绍
      const historyMessages = recentHistory.map(m => {
        const role = m.role === 'dj' ? 'assistant' : 'user';
        let content = m.content;

        // 如果是 DJ 的回复且有推荐歌曲，附加到 content 末尾
        if (role === 'assistant' && m.metadata && m.metadata.recommendedSongs && m.metadata.recommendedSongs.length > 0) {
          const songInfo = m.metadata.recommendedSongs
            .map((s: any) => `${s.name || s.title}${s.artist ? ' - ' + s.artist : ''}`)
            .join(', ');
          content = `${content} [推荐: ${songInfo}]`;
        }

        // 如果是串场/推荐消息，附加串场类型和歌曲信息
        if (role === 'assistant' && m.metadata && m.metadata.segueType) {
          const segueInfo = m.metadata.songTitle
            ? `${m.metadata.artist ? m.metadata.artist + '的' : ''}《${m.metadata.songTitle}》`
            : '';
          const typeLabel = m.metadata.segueType === 'opening' ? '开场白'
            : m.metadata.segueType === 'segue' ? '串场介绍'
            : '推荐串场';
          content = `[${typeLabel}] ${content}${segueInfo ? ' → ' + segueInfo : ''}`;
        }

        return { role, content };
      });

      // P0-2: 系统级上下文（时段、播放状态、已执行操作）作为独立参数传递
      // C: 丰富上下文信息 — 当前播放含歌手+专辑、播放列表摘要、最近播放
      // 用户消息保持纯净，不含系统指令或元信息
      const systemContextParts: string[] = [];
      if (schedulerContext) systemContextParts.push(schedulerContext);
      systemContextParts.push(`当前播放: ${currentTrack}`);
      systemContextParts.push(`播放状态: ${currentState.action === 'play' ? '正在播放' : currentState.action === 'pause' ? '已暂停' : '空闲'}`);
      systemContextParts.push(`播放列表:\n${playlistSummary}`);
      systemContextParts.push(`最近播放: ${recentPlayed}`);
      if (actionContext) systemContextParts.push(actionContext);
      const systemContext = systemContextParts.join('\n');

      // 调用 LLM 生成结构化回复 — 使用 Function Calling (P1-1)，计时
      const llmStart = Date.now();
      const structured = await this.llmService.chatStructuredWithFC(
        [...historyMessages, { role: 'user', content: message }],
        systemContext,
      );
      trace.addStep('llm_chatStructured_FC', Date.now() - llmStart, {
        hasResult: !!structured,
        say: structured?.say?.substring(0, 80),
        playCount: structured?.play?.length || 0,
        action: structured?.action,
      });

      if (structured) {
        const djText = structured.say;

        // 保存 DJ 回复到数据库（含推荐歌曲、搜索结果和执行轨迹）
        const traceSteps = trace.getSteps();
        this.chatMessageRepo.save(
          this.chatMessageRepo.create({
            chatId,
            role: 'dj',
            content: djText,
            sessionId,
            metadata: {
              recommendedSongs: recommendedSongs.length > 0 ? recommendedSongs : undefined,
              searchResults: searchResults.length > 0 ? searchResults : undefined,
              structuredReason: structured.reason || undefined,
              executionTrace: traceSteps,
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

        // P1-2: 处理 LLM 指定的推荐歌曲（play[] 字段）— 带搜索反馈环
        if (structured.play.length > 0 && recommendedSongs.length === 0) {
          // 构建搜索任务列表（最多3首）
          const searchItems: { keyword: string; title?: string; artist?: string }[] =
            structured.play.slice(0, 3).map(item => ({
              keyword: item.keyword || item.title || '',
              title: item.title || undefined,
              artist: item.artist || undefined,
            })).filter(item => item.keyword);

          // 第一轮搜索
          const round1Results = await this.executeSearchRound(searchItems, trace, chatId);

          // 收集失败的搜索任务
          const failedItems: { keyword: string; title?: string; artist?: string }[] = [];
          const failedResults: { keyword: string; results: string }[] = [];
          for (let i = 0; i < searchItems.length; i++) {
            if (!round1Results[i]) {
              failedItems.push(searchItems[i]);
              failedResults.push({
                keyword: searchItems[i].keyword,
                results: '无匹配结果或搜索失败',
              });
            } else {
              recommendedSongs.push(round1Results[i]!);
            }
          }

          // 反馈环：如果有失败的关键词，让 LLM 修正后重试（最多1轮）
          if (failedItems.length > 0) {
            const feedbackStart = Date.now();
            trace.addStep('search_feedback', Date.now() - feedbackStart, {
              failedCount: failedItems.length,
              failedKeywords: failedItems.map(f => f.keyword),
            });

            const refined = await this.llmService.refineSearchKeywords(failedItems, failedResults);
            trace.addStep('search_feedback_llm', Date.now() - feedbackStart, {
              refinedCount: refined.length,
              refinedKeywords: refined.map(r => r.keyword),
            });

            // 第二轮搜索：用修正后的关键词
            const round2Results = await this.executeSearchRound(
              refined.slice(0, failedItems.length),
              trace,
              chatId,
            );

            for (const song of round2Results) {
              if (song) {
                recommendedSongs.push(song);
                this.recordRecommendedSong(song, chatId);
              }
            }
          }

          // 记录第一轮成功的歌曲到播放历史
          for (const song of round1Results) {
            if (song && !recommendedSongs.includes(song)) {
              this.recordRecommendedSong(song, chatId);
            }
          }
        }

        // Fallback: LLM 没有返回 play 但用户明显想听某歌手的歌
        // 从用户消息中提取歌手名，搜索该歌手的热门歌曲
        if (structured.play.length === 0 && recommendedSongs.length === 0) {
          const artistMatch = message.match(/(?:推荐|来|放|听|想听|有没有)\s*(?:几首|几|一些)?\s*([^，。！？\s]{1,10})\s*(?:的|的歌|的音乐|的歌曲|的歌听)/);
          if (artistMatch && artistMatch[1]) {
            const artistName = artistMatch[1].trim();
            const searchStart = Date.now();
            try {
              const searchResult: any = await this.musicService.searchMusic(artistName, 10);
              const songs = searchResult?.songs || [];
              trace.addStep('artist_fallback_search', Date.now() - searchStart, {
                artist: artistName,
                resultCount: songs.length,
              });
              // 过滤：只取该歌手原唱的歌曲
              const artistSongs = songs.filter((s: any) =>
                s.ar?.some((a: any) => a.name?.includes(artistName) || artistName.includes(a.name))
              ).slice(0, 2);
              for (const song of artistSongs) {
                recommendedSongs.push({
                  id: song.id.toString(),
                  name: song.name,
                  artist: song.ar?.map((a: any) => a.name).join(' / ') || '',
                  cover: song.al?.picUrl || '',
                  url: `/audio/${song.id}`,
                });
              }
            } catch {
              trace.addStep('artist_fallback_search', Date.now() - searchStart, undefined, 'error', 'Artist search failed');
            }
          }
        }

        // === LLM+TTS 并行管线 ===
        const vol = typeof clientVolume === 'number' ? clientVolume : 0.5;
        const ttsVolume = `${Math.round((vol - 0.5) * 100)}%`;

        // 按中文标点分句
        const sentences = djText.split(/(?<=[。！？；\n])/g).filter(s => s.trim().length > 0);
        if (sentences.length === 0) sentences.push(djText);

        // 流式推送文本 — 分句发送，每句延迟 150ms 模拟自然语速
        (async () => {
          await new Promise((r) => setTimeout(r, 600));
          for (let si = 0; si < sentences.length; si++) {
            const sentence = sentences[si];
            // 逐字推送
            const chars = sentence.split('');
            let buf = '';
            for (let i = 0; i < chars.length; i++) {
              buf += chars[i];
              if (i % 5 === 4 || i === chars.length - 1) {
                this.chatGateway.broadcastChatStream({
                  role: 'dj',
                  delta: buf,
                  done: false,
                  metadata: { chatId, sentenceIndex: si, sentenceCount: sentences.length },
                });
                buf = '';
                await new Promise((r) => setTimeout(r, 30));
              }
            }
            // 句间停顿
            if (si < sentences.length - 1) {
              await new Promise((r) => setTimeout(r, 150));
            }
          }
        })();

        // TTS 并行合成 + 失败兜底 — 整体计时
        const ttsStart = Date.now();
        const ttsSuccessFlags = new Array(sentences.length).fill(false);
        const ttsPromise = (async () => {
          const sentenceResults = await Promise.all(
            sentences.map((sentence, si) =>
              this.ttsService.synthesizeStream({
                text: sentence,
                voice: this.ttsService.defaultVoice,
                rate: '+0%',
                pitch: '-5Hz',
                volume: ttsVolume,
              })
                .then(async (stream) => {
                  const reader = stream.getReader();
                  let hasChunks = false;
                  while (true) {
                    const { done, value } = await reader.read();
                    if (value) {
                      hasChunks = true;
                      this.chatGateway.broadcastTtsChunk(
                        chatId, si, sentences.length, Buffer.from(value),
                      );
                    }
                    if (done) break;
                  }
                  if (hasChunks) ttsSuccessFlags[si] = true;
                  return si;
                })
                .catch(e => {
                  console.error(`TTS sentence ${si} failed:`, e);
                  // 兜底：单句流式失败 → 尝试非流式合成
                  return this.ttsService.synthesize({
                    text: sentence,
                    voice: this.ttsService.defaultVoice,
                    rate: '+0%',
                    pitch: '-5Hz',
                    volume: ttsVolume,
                  }).then(buf => {
                    if (buf && buf.length > 0) {
                      ttsSuccessFlags[si] = true;
                      this.chatGateway.broadcastTtsChunk(
                        chatId, si, sentences.length, buf,
                      );
                    }
                    return si;
                  }).catch(() => si);
                }),
            ),
          );
          return sentenceResults;
        })();

        // 先发推荐歌曲和搜索结果（不等 TTS 完成，减少延迟感知）
        await new Promise((r) => setTimeout(r, 600));

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

        // 等待并行 TTS 全部完成
        const sentenceResults = await ttsPromise;
        const ttsDurationMs = Date.now() - ttsStart;
        const ttsSuccessCount = ttsSuccessFlags.filter(f => f).length;
        trace.addStep('tts_synthesis', ttsDurationMs, {
          sentenceCount: sentences.length,
          successCount: ttsSuccessCount,
          allFailed: ttsSuccessCount === 0,
        });

        const allFailed = ttsSuccessFlags.every(f => !f);
        if (sentenceResults.length > 0 || allFailed) {
          this.chatGateway.broadcastChatStream({
            role: 'dj',
            delta: '',
            done: false,
            metadata: {
              chatId,
              ttsDone: true,
              ttsFailed: allFailed,
              sentenceCount: sentences.length,
            },
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

      // 保存执行轨迹到数据库
      await trace.finish(structured ? 'ok' : 'partial');

      // 广播轨迹事件给前端 (可选，用于调试)
      this.chatGateway.broadcastTrace({
        chatId,
        step: 'complete',
        durationMs: trace.getElapsedMs(),
        status: 'ok',
      });

      // 发送结束标记（chat-stream done + chat-end 双重保险）
      this.chatGateway.broadcastChatStream({ role: 'dj', delta: '', done: true });
      this.chatGateway.broadcastChatEnd({ id: chatId });

      return { status: 'success', chatId, sessionId };
    } catch (error) {
      // 记录错误步骤
      trace.addStep('error', Date.now() - trace.getElapsedMs(), undefined, 'error',
        error instanceof Error ? error.message : 'Unknown error');
      await trace.finish('error');

      this.chatGateway.broadcastChatStream({ role: 'dj', delta: '', done: true });
      this.chatGateway.broadcastChatEnd({ id: chatId });
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Chat failed',
      };
    }
  }

  @Get('chat/history')
  async getChatHistory(
    @Query('limit') limit?: string,
    @Query('sessionId') sessionIdStr?: string,
  ) {
    const take = Math.min(parseInt(limit || '50', 10) || 50, 200);
    const where: any = {};
    if (sessionIdStr) {
      const sid = parseInt(sessionIdStr, 10);
      if (!isNaN(sid)) where.sessionId = sid;
    }
    const messages = await this.chatMessageRepo.find({
      where: Object.keys(where).length > 0 ? where : undefined,
      order: { createdAt: 'DESC' },
      take,
    });
    messages.reverse();
    return messages.map(m => ({
      id: `msg_${m.id}`,
      role: m.role,
      content: m.content,
      timestamp: m.createdAt.getTime(),
      sessionId: m.sessionId,
      recommendedSongs: m.metadata?.recommendedSongs || undefined,
      searchResults: m.metadata?.searchResults || undefined,
      segueType: m.metadata?.segueType || undefined,
      executionTrace: m.metadata?.executionTrace || undefined,
    }));
  }

  @Get('play-history')
  async getPlayHistory(
    @Query('limit') limit?: string,
    @Query('hours') hours?: string,
  ) {
    const take = Math.min(parseInt(limit || '20', 10) || 20, 200);
    const hrs = parseInt(hours || '24', 10) || 24;
    if (hrs > 0) {
      return this.playHistoryService.getRecentByHours(hrs, take);
    }
    return this.playHistoryService.getRecent(take);
  }

  @Get('play-history/stats')
  async getPlayStats() {
    return this.playHistoryService.getTriggerStats();
  }

  @Get('trace/:chatId')
  async getExecutionTrace(@Param('chatId') chatId: string) {
    const trace = await this.traceService.getByChatId(chatId);
    if (!trace) {
      return { status: 'not_found', chatId };
    }
    return {
      chatId: trace.chatId,
      steps: trace.steps,
      totalDurationMs: trace.totalDurationMs,
      status: trace.status,
      createdAt: trace.createdAt.getTime(),
    };
  }

  @Get('trace')
  async getRecentTraces(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '20', 10) || 20, 200);
    return this.traceService.getRecent(take);
  }

  @Delete('chat/history')
  @HttpCode(HttpStatus.OK)
  async clearChatHistory() {
    await this.chatMessageRepo.clear();
    return { status: 'success' };
  }

  // P1-2: 搜索反馈环 — 执行一轮搜索，返回每首歌的搜索结果
  private async executeSearchRound(
    items: { keyword: string; title?: string; artist?: string }[],
    trace: any,
    chatId: string,
  ): Promise<({ id: string; name: string; artist: string; cover: string; url: string } | null)[]> {
    const results: ({ id: string; name: string; artist: string; cover: string; url: string } | null)[] = [];

    for (const item of items) {
      const kw = item.keyword;
      if (!kw) { results.push(null); continue; }

      // 多策略搜索：先原文 → 再 歌名+歌手 → 最后纯歌名
      const searchQueries: string[] = [kw];
      if (item.title && item.artist) searchQueries.push(`${item.title} ${item.artist}`);
      if (item.title) searchQueries.push(item.title);

      let found: { id: string; name: string; artist: string; cover: string; url: string } | null = null;
      for (const query of searchQueries) {
        if (found || !query || query.length > 50) continue;
        const searchStart = Date.now();
        try {
          const result: any = await this.musicService.searchMusic(query, 3);
          const songs = result?.songs || [];
          trace.addStep('music_search_recommend', Date.now() - searchStart, {
            query,
            resultCount: songs.length,
            round: 'round1',
          });
          // 优先匹配歌名最接近的结果
          const title = item.title || '';
          const best = title
            ? songs.find((s: any) => s.name?.toLowerCase().includes(title.toLowerCase())) || songs[0]
            : songs[0];
          if (best) {
            found = {
              id: best.id.toString(),
              name: best.name,
              artist: best.ar?.map((a: any) => a.name).join(' / ') || '',
              cover: best.al?.picUrl || '',
              url: `/audio/${best.id}`,
            };
          }
        } catch {
          trace.addStep('music_search_recommend', Date.now() - searchStart, undefined, 'error', `Search "${query}" failed`);
        }
      }
      results.push(found);
    }

    return results;
  }

  // 记录推荐歌曲到播放历史
  private async recordRecommendedSong(song: { id: string; name: string; artist: string; cover: string; url: string }, chatId: string) {
    this.playHistoryService.record({
      songId: song.id,
      title: song.name,
      artist: song.artist,
      album: '',
      coverUrl: song.cover,
      duration: 0,
      trigger: 'chat_play',
      chatId,
    }).catch(e => console.error('Failed to record play history:', e));
  }
}
