import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PlaybackStateService } from '../state/playback-state.service';

// 信令类型
export enum WsMessageType {
  NOW_PLAYING = 'now-playing',
  CONTROL = 'control',
  CHAT_STREAM = 'chat-stream',
  CHAT_END = 'chat-end',
  PLAYLIST_UPDATE = 'playlist-update',
  PLAYBACK_CMD = 'playback-cmd',
  CHAT_SEND = 'chat-send',
  PING = 'ping',
  PONG = 'pong',
}

// 通用信封
export interface WsEnvelope<T> {
  type: WsMessageType;
  ts: number;
  seq?: number;
  data: T;
}

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : true,
    credentials: true,
  },
  namespace: '/stream',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private seq = 0;
  private clientSeqMap = new Map<string, number>();

  constructor(private readonly playbackState: PlaybackStateService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    this.clientSeqMap.set(client.id, 0);

    // 连接后立即推送当前播放状态
    const state = this.playbackState.getState();
    if (state.content) {
      this.sendToClient(client, WsMessageType.NOW_PLAYING, {
        action: state.action,
        content: state.content,
        position: state.position,
      });
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.clientSeqMap.delete(client.id);
  }

  @SubscribeMessage(WsMessageType.PLAYBACK_CMD)
  handlePlaybackCmd(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { command: string; payload?: any },
  ) {
    this.logger.log(`Playback command from ${client.id}: ${payload.command}`);

    const { command, payload: cmdPayload } = payload;
    let status: 'ok' | 'error' = 'ok';

    switch (command) {
      case 'play':
        this.playbackState.getState().action === 'pause'
          ? this.playbackState.updateState({ action: 'play' })
          : null;
        break;
      case 'pause':
        this.playbackState.setPaused();
        break;
      case 'next':
        this.playbackState.nextTrack();
        break;
      case 'seek':
        if (cmdPayload?.position !== undefined) {
          this.playbackState.seek(cmdPayload.position);
        }
        break;
      case 'volume':
        if (cmdPayload?.volume !== undefined) {
          this.playbackState.setVolume(cmdPayload.volume);
        }
        break;
      default:
        status = 'error';
    }

    // 广播控制确认
    this.broadcast(WsMessageType.CONTROL, {
      command,
      status,
      payload: cmdPayload,
    });

    return { event: WsMessageType.CONTROL, data: { command, status } };
  }

  @SubscribeMessage(WsMessageType.CHAT_SEND)
  handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { message: string; timestamp: number },
  ) {
    this.logger.log(`Chat from ${client.id}: ${payload.message}`);
    // 实际处理在 ChatController 中，这里仅确认收到
    return { event: 'chat-ack', data: { received: true } };
  }

  @SubscribeMessage(WsMessageType.PING)
  handlePing(@ConnectedSocket() client: Socket, @MessageBody() payload: { ts: number }) {
    return {
      event: WsMessageType.PONG,
      data: { clientTs: payload.ts, serverTs: Date.now() },
    };
  }

  // === 广播方法 ===

  broadcastNowPlaying(data: {
    action: string;
    content: any;
    position?: number;
    queue?: any;
  }) {
    this.broadcast(WsMessageType.NOW_PLAYING, data);
  }

  broadcastChatStream(data: {
    role: 'dj';
    delta: string;
    done: boolean;
    metadata?: any;
  }) {
    this.broadcast(WsMessageType.CHAT_STREAM, data);
  }

  broadcastChatEnd(data: { id: string; usage?: any }) {
    this.broadcast(WsMessageType.CHAT_END, data);
  }

  broadcastControlCommand(data: { command: string; payload?: any }) {
    this.broadcast(WsMessageType.CONTROL, data);
  }

  broadcastPlaylistUpdate(data: {
    action: 'add' | 'remove' | 'replace';
    songs?: any[];
    index?: number;
    playlist?: any[];
  }) {
    this.broadcast(WsMessageType.PLAYLIST_UPDATE, data);
  }

  // === 私有方法 ===

  private broadcast(type: WsMessageType, data: any) {
    this.seq++;
    const envelope: WsEnvelope<any> = {
      type,
      ts: Date.now(),
      seq: this.seq,
      data,
    };
    this.server.emit(type, envelope);
    this.logger.debug(`Broadcast ${type}: seq=${this.seq}`);
  }

  private sendToClient(client: Socket, type: WsMessageType, data: any) {
    const clientSeq = (this.clientSeqMap.get(client.id) || 0) + 1;
    this.clientSeqMap.set(client.id, clientSeq);

    const envelope: WsEnvelope<any> = {
      type,
      ts: Date.now(),
      seq: clientSeq,
      data,
    };
    client.emit(type, envelope);
  }
}
