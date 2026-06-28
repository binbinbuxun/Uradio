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
import { PlaybackStateService, PlaybackContent } from '../state/playback-state.service';
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

  private serializeChatMessage(message: ChatMessage) {
    const source = message.metadata?.source || (message.metadata?.segueType ? 'radio_auto' : 'chat');
    return {
      id: `msg_${message.id}`,
      chatId: message.chatId,
      role: message.role,
      content: message.content,
      timestamp: message.createdAt.getTime(),
      sessionId: message.sessionId,
      source,
      recommendedSongs: message.metadata?.recommendedSongs || undefined,
      searchResults: message.metadata?.searchResults || undefined,
      segueType: message.metadata?.segueType || undefined,
      songTitle: message.metadata?.songTitle || undefined,
      artist: message.metadata?.artist || undefined,
      executionTrace: message.metadata?.executionTrace || undefined,
    };
  }

  private async persistDjMessage(
    chatId: string,
    sessionId: number | null,
    content: string,
    structuredReason: string | undefined,
    executionTrace: any,
    recommendedSongs: any[],
    searchResults: any[],
  ) {
    const existing = await this.chatMessageRepo.findOne({
      where: { chatId, role: 'dj' },
      order: { id: 'DESC' },
    });

    const payload = {
      chatId,
      role: 'dj' as const,
      content,
      sessionId,
      metadata: {
        source: 'chat' as const,
        recommendedSongs: recommendedSongs.length > 0 ? recommendedSongs : undefined,
        searchResults: searchResults.length > 0 ? searchResults : undefined,
        structuredReason: structuredReason || undefined,
        executionTrace,
      },
    };

    if (existing) {
      existing.content = payload.content;
      existing.sessionId = payload.sessionId;
      existing.metadata = payload.metadata;
      await this.chatMessageRepo.save(existing);
      return;
    }

    await this.chatMessageRepo.save(this.chatMessageRepo.create(payload));
  }

  // 会话管理：获取、创建、读取和删除聊天会话

  /** 获取会话列表 */
  @Get('chat/sessions')
  @HttpCode(HttpStatus.OK)
  async getSessions() {
    const sessions = await this.chatSessionService.listSessions();
    return { status: 'success', sessions };
  }

  /** 创建会话 */
  @Post('chat/sessions')
  @HttpCode(HttpStatus.OK)
  async createSession(@Body('title') title?: string) {
    const session = await this.chatSessionService.createSession(title || '');
    return { status: 'success', session };
  }

  /** 获取会话消息 */
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
      messages: result.messages.map((m) => this.serializeChatMessage(m)),
    };
  }

  /** 删除会话，并将关联消息的 sessionId 置为 null */
  @Delete('chat/sessions/:id')
  @HttpCode(HttpStatus.OK)
  async deleteSession(@Param('id') id: string) {
    const sessionId = parseInt(id, 10);
    if (isNaN(sessionId)) return { status: 'error', message: 'Invalid session id' };
    await this.chatSessionService.deleteSession(sessionId);
    return { status: 'success' };
  }

  // 聊天主流程：先处理显式指令，再补充上下文并调用 LLM

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

    // 解析 sessionId，只复用已存在的会话
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

    // 异步保存用户消息
    this.chatMessageRepo.save(
      this.chatMessageRepo.create({
        chatId,
        role: 'user',
        content: message,
        metadata: null,
        sessionId,
      }),
    ).catch(e => console.error('Failed to save user chat message:', e));

    // 增加会话消息计数
    this.chatSessionService.incrementMessageCount(sessionId).catch(e =>
      console.error('Failed to increment message count:', e));

    // 如果是会话的第一条消息，异步生成标题
    const session = await this.chatSessionService['sessionRepo'].findOne({
      where: { id: sessionId },
    });
    if (session && (!session.title || session.title === '' || session.messageCount <= 1)) {
      this.chatSessionService.autoGenerateTitle(sessionId, message);
    }

    // 识别显式意图
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

    // 基于当前播放状态执行显式控制
    const currentState = this.playbackState.getState();

    if (intent.type) {
      switch (intent.type) {
        case 'next': {
          // 记录切歌前的播放历史
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
          // 记录切歌后的播放历史
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
          actionContext = '[系统动作: 已切到下一首并更新播放状态]';
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
          actionContext = '[系统动作: 已切回上一首并更新播放状态]';
          break;
        }

        case 'pause':
          this.playbackState.setPaused();
          deferredControls.push({ command: 'pause' });
          actionContext = '[系统动作: 已暂停当前播放]';
          break;

        case 'play':
          this.playbackState.updateState({ action: 'play' });
          deferredControls.push({ command: 'play' });
          actionContext = '[系统动作: 已继续当前播放]';
          break;

        case 'add_song':
          if (intent.params?.keyword) {
            const searchStart = Date.now();
            try {
              const target = this.buildSearchTarget(intent.params.keyword);
              const rankedSongs = await this.searchSongsForTarget(target, trace, 'music_search', {
                keyword: intent.params.keyword,
                source: 'add_song',
              });
              const pickedSongs = rankedSongs.slice(0, target.title && target.artist ? 1 : 3);
              const newTracks = pickedSongs.map((song: any) => this.toQueueTrack(song));
              if (newTracks.length === 0) {
                throw new Error('No matching songs found');
              }
              this.playbackState.addToPlaylist(newTracks, undefined, {
                source: 'manual',
                operator: 'user',
                insertPolicy: 'append',
                reason: '用户要求直接加歌',
              });
              recommendedSongs = newTracks;
              // 记录入队歌曲
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
                playlist: this.playbackState.getClientQueueSnapshot().playlist,
                currentIndex: this.playbackState.getState().currentIndex,
                source: 'manual',
                queue: this.playbackState.getClientQueueSnapshot(),
              });
              const songList = newTracks.map((t: any) => `《${t.name}》-${t.artist}`).join('、');
              actionContext = `[系统动作: 已搜索“${intent.params.keyword}”并加入播放列表: ${songList}]`;
            } catch {
              trace.addStep('music_search', Date.now() - searchStart, undefined, 'error', 'Search failed');
              actionContext = `[系统动作: 搜索“${intent.params.keyword}”失败，未能加入播放列表]`;
            }
          }
          break;

        case 'search_song':
          if (intent.params?.keyword) {
            const searchStart = Date.now();
            try {
              const target = this.buildSearchTarget(intent.params.keyword);
              const rankedSongs = await this.searchSongsForTarget(target, trace, 'music_search', {
                keyword: intent.params.keyword,
                source: 'search_song',
              });
              const pickedSongs = rankedSongs.slice(0, target.title && target.artist ? 3 : 5);
              searchResults = pickedSongs.map((song: any) => this.toSearchCard(song));
              const songList = searchResults.map((t: any) => `《${t.name}》-${t.artist}`).join('、');
              actionContext = `[系统动作: 已搜索“${intent.params.keyword}”，找到以下候选歌曲: ${songList}]`;
            } catch {
              trace.addStep('music_search', Date.now() - searchStart, undefined, 'error', 'Search failed');
              actionContext = `[系统动作: 搜索“${intent.params.keyword}”失败，未找到可展示的候选歌曲]`;
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
              playlist: this.playbackState.getClientQueueSnapshot().playlist,
              currentIndex: this.playbackState.getState().currentIndex,
              source: 'manual',
              queue: this.playbackState.getClientQueueSnapshot(),
            });
            const target = intent.params?.songName || `第${intent.params?.index}首`;
            actionContext = `[系统动作: 已从播放列表移除${target}]`;
          } else {
            const target = intent.params?.songName || `第${intent.params?.index}首`;
            actionContext = `[系统动作: 未能从播放列表移除${target}]`;
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
          actionContext = `[系统动作: 已将音量调整到${targetVol}%]`;
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

    // 读取当前播放信息
    const currentContent = currentState.content;
    // 将当前播放格式化为模型可读文本
    const currentTrack = currentContent
      ? `${currentContent.title}${currentContent.artist ? ' - ' + currentContent.artist : ''}${currentContent.album ? ' (' + currentContent.album + ')' : ''}`
      : '无';

    // 构造播放列表摘要，展示当前歌曲前后各两首
    const playlist = currentState.playlist;
    const curIdx = currentState.currentIndex;
    const playlistSummary = playlist.length > 0
      ? playlist.slice(Math.max(0, curIdx - 2), Math.min(playlist.length, curIdx + 4))
          .map((t, i) => {
            const globalIdx = Math.max(0, curIdx - 2) + i;
            const marker = globalIdx === curIdx ? '?' : '  ';
            return `${marker} [${globalIdx + 1}] ${t.title}${t.artist ? ' - ' + t.artist : ''}`;
          })
          .join('\n')
      : '空';

    // 查询最近播放历史，直接读取 PlayHistory 持久化记录
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

      // 获取近期对话历史（最近 20 条）
      const historyStart = Date.now();
      const recentHistory = await this.chatMessageRepo.find({
        order: { createdAt: 'DESC' },
        take: 20,
      });
      recentHistory.reverse(); // 按时间正序
      trace.addStep('load_history', Date.now() - historyStart, { count: recentHistory.length });

      // 给 DJ 历史消息补充推荐歌曲信息，让模型知道之前推荐过什么
      // 给串场消息补充上下文，让模型知道之前说过哪些串场介绍
      const historyMessages = recentHistory.map(m => {
        const role = m.role === 'dj' ? 'assistant' : 'user';
        let content = m.content;

        // 如果是 DJ 回复且包含推荐歌曲，则在末尾补充系统记录
        if (role === 'assistant' && m.metadata && m.metadata.recommendedSongs && m.metadata.recommendedSongs.length > 0) {
          const songInfo = m.metadata.recommendedSongs
            .map((s: any) => `${s.name || s.title}${s.artist ? ' - ' + s.artist : ''}`)
            .join(', ');
          content = `${content}\n[系统记录: 已推荐 ${songInfo}]`;
        }

        // 如果是串场或推荐消息，则补充串场类型和目标歌曲信息
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

      // 将系统级上下文（时段、播放状态、已执行操作）作为独立参数传递
      // 补充上下文信息：当前播放、播放列表摘要和最近播放记录
      // 用户消息保持纯净，不含系统指令或元信息
      const systemContextParts: string[] = [];
      if (schedulerContext) systemContextParts.push(schedulerContext);
      systemContextParts.push(`当前播放: ${currentTrack}`);
      systemContextParts.push(`播放状态: ${currentState.action === 'play' ? '正在播放' : currentState.action === 'pause' ? '已暂停' : '空闲'}`);
      systemContextParts.push(`播放列表:\n${playlistSummary}`);
      systemContextParts.push(`最近播放: ${recentPlayed}`);
      if (actionContext) systemContextParts.push(actionContext);
      const systemContext = systemContextParts.join('\n');

      // 调用 LLM 生成结构化回复，使用 Function Calling，并记录耗时
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

      // 文本流任务在 if 代码块内创建，在外部统一等待完成
      let textStreamPromise: Promise<void> | null = null;

      if (structured) {
        // 兜底处理：如果模型没有返回文案但给出了推荐歌曲，则补一条默认回复
        const djText = structured.say || (structured.play?.length > 0 ? '为你选了一首歌，听听看。' : '');

        // 先写入骨架消息，推荐歌曲与搜索结果在后续搜索完成后回填
        const traceSteps = trace.getSteps();
        this.chatMessageRepo.save(
          this.chatMessageRepo.create({
            chatId,
            role: 'dj',
            content: djText,
            sessionId,
            metadata: {
              source: 'chat',
              structuredReason: structured.reason || undefined,
              executionTrace: traceSteps,
            },
          }),
        ).catch(e => console.error('Failed to save DJ chat message:', e));

        // 处理模型返回的 action，补足正则意图识别未覆盖的情况
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

        // 处理模型指定的推荐歌曲，并在搜索失败时进行一次反馈修正
        if (structured.play.length > 0 && recommendedSongs.length === 0) {
          // 构建搜索任务列表（最多 3 首）
          const searchItems: { keyword: string; title?: string; artist?: string }[] =
            structured.play.slice(0, 3).map(item => ({
              keyword: item.keyword || item.title || '',
              title: item.title || undefined,
              artist: item.artist || undefined,
            })).filter(item => item.keyword);

          // 执行第一轮搜索
          const round1Results = await this.executeSearchRound(searchItems, trace, chatId);

          // 收集搜索失败的任务
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

          // 如果有失败关键词，让模型修正后再重试一轮
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

            // 第二轮搜索：使用修正后的关键词
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

        // 兜底处理：如果模型没有返回 play，但用户明显是在点某位歌手的歌
        // 从用户消息中提取歌手名，再搜索该歌手的歌曲
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
              // 过滤：只保留该歌手的原唱歌曲
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

        if (recommendedSongs.length > 0 && intent.type !== 'add_song') {
          const chatCandidates = this.playbackState.addCandidates(
            'chat',
            recommendedSongs.map((song) => this.toPlaybackTrackFromCard(song)),
            { reason: structured.reason || 'DJ 推荐' },
          );

          if (chatCandidates.length > 0) {
            const candidateMap = new Map(chatCandidates.map((candidate) => [candidate.track.id, candidate]));
            recommendedSongs = recommendedSongs.map((song) => {
              const candidate = candidateMap.get(song.id);
              return candidate
                ? {
                  ...song,
                  candidateId: candidate.candidateId,
                  source: candidate.source,
                  reason: candidate.reason,
                }
                : song;
            });

            this.chatGateway.broadcastPlaylistUpdate({
              action: 'replace',
              playlist: this.playbackState.getClientQueueSnapshot().playlist,
              currentIndex: this.playbackState.getState().currentIndex,
              source: 'chat',
              queue: this.playbackState.getClientQueueSnapshot(),
            });
          }
        }

        await this.persistDjMessage(
          chatId,
          sessionId,
          djText,
          structured.reason || undefined,
          trace.getSteps(),
          recommendedSongs,
          searchResults,
        ).catch(e => console.error('Failed to persist DJ chat message:', e));

        // === LLM 与 TTS 并行管线 ===
        const vol = typeof clientVolume === 'number' ? clientVolume : 0.5;
        const ttsVolume = `${Math.round((vol - 0.5) * 100)}%`;

        // 按中文标点分句
        const sentences = djText.split(/(?<=[。！？；\n])/g).filter(s => s.trim().length > 0);
        if (sentences.length === 0) sentences.push(djText);

        // 流式推送文本：分句发送，每句延迟 150ms 模拟自然语速
        textStreamPromise = (async () => {
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

        // TTS 并行合成，失败时自动兜底，并记录总耗时
        const ttsStart = Date.now();
        const ttsSuccessFlags = new Array(sentences.length).fill(false);
        const ttsPromise = (async () => {
          const sentenceResults = await Promise.all(
            sentences.map((sentence, si) =>
              this.ttsService.synthesizeStream({
                text: sentence,
                voice: this.ttsService.defaultVoice,
                rate: '+10%',
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
                  // 兜底：单句流式合成失败后，尝试非流式合成
                  return this.ttsService.synthesize({
                    text: sentence,
                    voice: this.ttsService.defaultVoice,
                    rate: '+10%',
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

        // 先发送推荐歌曲和搜索结果，不等待 TTS 完成，以减少感知延迟
        await new Promise((r) => setTimeout(r, 600));

        if (recommendedSongs.length > 0) {
          this.chatGateway.broadcastChatStream({
            role: 'dj',
            delta: '',
            done: false,
            metadata: {
              chatId,
              source: 'chat',
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
              source: 'chat',
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

        // 延迟 1.5 秒执行控制指令
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

      // 等待文本流也完成，避免 chat-end 早于文本流到达前端
      if (textStreamPromise) {
        await textStreamPromise.catch(() => {});
      }

      // 向前端广播执行轨迹事件，可用于调试
      this.chatGateway.broadcastTrace({
        chatId,
        step: 'complete',
        durationMs: trace.getElapsedMs(),
        status: 'ok',
      });

      // 发送结束标记，使用 chat-stream done 和 chat-end 双重保险
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
    return messages.map((m) => this.serializeChatMessage(m));
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

  private buildSearchTarget(keyword: string, title?: string, artist?: string) {
    const target = {
      keyword: keyword.trim(),
      title: title?.trim() || undefined,
      artist: artist?.trim() || undefined,
    };

    if ((!target.title || !target.artist) && target.keyword.includes('的')) {
      const parts = target.keyword.split('的');
      const maybeArtist = parts[0]?.trim();
      const maybeTitle = parts.slice(1).join('的').trim();
      if (!target.artist && maybeArtist) target.artist = maybeArtist;
      if (!target.title && maybeTitle) target.title = maybeTitle;
    }

    if (target.artist) {
      target.artist = target.artist.replace(/^by\s+/i, '').replace(/的+$/g, '').trim() || undefined;
    }

    if (target.title) {
      target.title = target.title.replace(/^[《"]+|[》"]+$/g, '').trim() || undefined;
    }

    return target;
  }

  private normalizeSearchText(value?: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/feat\.?/g, '')
      .replace(/[\u300a\u300b"'`]/g, '')
      .replace(/[\s()\uFF08\uFF09\u3010\u3011\[\],\uFF0C\u3002\uFF01\uFF1F!?\uFF1A:\uFF1B;\uFF0F/\\_.-]+/g, '');
  }

  private normalizeSearchQuery(value?: string): string {
    return (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u300a\u300b"'`]/g, ' ')
      .replace(/的/g, ' ')
      .replace(/[\s()\uFF08\uFF09\u3010\u3011\[\],\uFF0C\u3002\uFF01\uFF1F!?\uFF1A:\uFF1B;\uFF0F/\\_.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildSearchQueries(target: { keyword: string; title?: string; artist?: string }): string[] {
    const queries: string[] = [];
    const pushUnique = (value?: string) => {
      const trimmed = value?.trim();
      if (!trimmed || trimmed.length > 60 || queries.includes(trimmed)) return;
      queries.push(trimmed);
    };

    pushUnique(target.keyword);
    if (target.title && target.artist) {
      pushUnique(`${target.title} ${target.artist}`);
      pushUnique(`${target.artist} ${target.title}`);
    }
    if (target.title) pushUnique(target.title);
    if (target.artist) pushUnique(target.artist);

    const normalizedVariants = queries
      .map((query) => this.normalizeSearchQuery(query))
      .filter((query) => query && !queries.includes(query));

    return [...queries, ...normalizedVariants];
  }

  private scoreSongCandidate(song: any, target: { keyword: string; title?: string; artist?: string }): number {
    const songTitle = this.normalizeSearchText(song?.name || '');
    const songArtists = (song?.ar || [])
      .map((artist: any) => this.normalizeSearchText(artist?.name || ''))
      .filter(Boolean);
    const targetTitle = this.normalizeSearchText(target.title);
    const targetArtist = this.normalizeSearchText(target.artist);
    const targetKeyword = this.normalizeSearchText(target.keyword);

    let score = 0;

    if (targetTitle) {
      if (songTitle === targetTitle) score += 120;
      else if (songTitle.includes(targetTitle) || targetTitle.includes(songTitle)) score += 80;
      else score -= 60;
    } else if (targetKeyword && songTitle.includes(targetKeyword)) {
      score += 40;
    }

    if (targetArtist) {
      const exactArtist = songArtists.some((artist: string) => artist === targetArtist);
      const fuzzyArtist = songArtists.some((artist: string) => artist.includes(targetArtist) || targetArtist.includes(artist));
      if (exactArtist) score += 140;
      else if (fuzzyArtist) score += 90;
      else score -= 180;
    } else if (targetKeyword) {
      const keywordArtist = songArtists.some((artist: string) => artist.includes(targetKeyword) || targetKeyword.includes(artist));
      if (keywordArtist) score += 50;
    }

    if (targetTitle && targetArtist && songTitle === targetTitle && songArtists.some((artist: string) => artist === targetArtist)) {
      score += 80;
    }

    return score;
  }

  private rankSongsForTarget(songs: any[], target: { keyword: string; title?: string; artist?: string }): any[] {
    const ranked = songs
      .map((song) => ({ song, score: this.scoreSongCandidate(song, target) }))
      .sort((a, b) => b.score - a.score);

    const hasStrongMatch = ranked.some((entry) => entry.score > 0);
    if (hasStrongMatch) {
      return ranked.filter((entry) => entry.score > 0).map((entry) => entry.song);
    }

    if (target.title && target.artist) {
      return [];
    }

    return ranked.map((entry) => entry.song);
  }

  private async searchSongsForTarget(
    target: { keyword: string; title?: string; artist?: string },
    trace: ActiveTrace,
    stepName: string,
    metadata: Record<string, any>,
    limit = 10,
  ): Promise<any[]> {
    const attempts = [{ target, swapped: false }];

    if (target.title && target.artist) {
      attempts.push({
        target: {
          keyword: `${target.artist} ${target.title}`,
          title: target.artist,
          artist: target.title,
        },
        swapped: true,
      });
    }

    for (const attempt of attempts) {
      for (const query of this.buildSearchQueries(attempt.target)) {
        const searchStart = Date.now();
        try {
          const searchResult: any = await this.musicService.searchMusic(query, limit);
          const rankedSongs = this.rankSongsForTarget(searchResult?.songs || [], attempt.target);
          trace.addStep(stepName, Date.now() - searchStart, {
            ...metadata,
            query,
            swapped: attempt.swapped,
            targetTitle: attempt.target.title,
            targetArtist: attempt.target.artist,
            resultCount: rankedSongs.length,
            rawResultCount: (searchResult?.songs || []).length,
          });
          if (rankedSongs.length > 0) {
            return rankedSongs;
          }
        } catch {
          trace.addStep(stepName, Date.now() - searchStart, {
            ...metadata,
            query,
            swapped: attempt.swapped,
          }, 'error', `Search "${query}" failed`);
        }
      }
    }

    return [];
  }

  private toSearchCard(song: any) {
    return {
      id: song.id.toString(),
      name: song.name,
      artist: song.ar?.map((artist: any) => artist.name).join(' / ') || '',
      cover: song.al?.picUrl || '',
      url: `/audio/${song.id}`,
    };
  }

  private toQueueTrack(song: any) {
    return {
      type: 'song' as const,
      id: song.id.toString(),
      name: song.name,
      title: song.name,
      artist: song.ar?.map((artist: any) => artist.name).join(' / ') || '',
      album: song.al?.name || '',
      duration: song.dt ? Math.floor(song.dt / 1000) : 0,
      coverUrl: song.al?.picUrl || '',
      cover: song.al?.picUrl || '',
      url: `/audio/${song.id}`,
    };
  }

  private toPlaybackTrackFromCard(song: {
    id: string;
    name: string;
    artist: string;
    cover?: string;
    url?: string;
  }): PlaybackContent {
    return {
      type: 'song',
      id: song.id.toString(),
      title: song.name,
      artist: song.artist || '',
      album: '',
      duration: 0,
      coverUrl: song.cover || '',
      url: song.url || `/audio/${song.id}`,
    };
  }

  // 执行一轮搜索反馈，返回每首歌对应的搜索结果
  private async executeSearchRound(
    items: { keyword: string; title?: string; artist?: string }[],
    trace: any,
    chatId: string,
  ): Promise<({ id: string; name: string; artist: string; cover: string; url: string } | null)[]> {
    const results: ({ id: string; name: string; artist: string; cover: string; url: string } | null)[] = [];

    for (const item of items) {
      const kw = item.keyword;
      if (!kw) { results.push(null); continue; }

      let found: { id: string; name: string; artist: string; cover: string; url: string } | null = null;
      const target = this.buildSearchTarget(kw, item.title, item.artist);
      const songs = await this.searchSongsForTarget(target, trace, 'music_search_recommend', {
        keyword: kw,
        round: 'round1',
      });
      const best = songs[0];
      if (best) {
        found = this.toSearchCard(best);
      }
      results.push(found);
    }

    return results;
  }

  // 记录推荐歌曲播放历史
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









