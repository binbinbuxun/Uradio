import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { ChatSession } from './chat-session.entity';import { ChatMessage } from './chat-message.entity';

@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
  ) {}

  /** 获取所有会话列表（按最新更新时间倒序） */
  async listSessions(): Promise<ChatSession[]> {
    return this.sessionRepo.find({
      order: { updatedAt: 'DESC' },
    });
  }

  /** 获取单个会话（含最后一条消息预览） */
  async getSessionWithPreview(sessionId: number): Promise<{
    session: ChatSession;
    lastMessage?: ChatMessage;
    messages: ChatMessage[];
  } | null> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) return null;

    const messages = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });

    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;

    return { session, lastMessage, messages };
  }

  /** 获取会话的所有消息（按时间正序） */
  async getSessionMessages(sessionId: number): Promise<ChatMessage[]> {
    return this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  /** 创建新会话 */
  async createSession(title?: string): Promise<ChatSession> {
    const session = this.sessionRepo.create({
      title: title || '',
      messageCount: 0,
    });
    return this.sessionRepo.save(session);
  }

  /** 删除会话及其所有消息 */
  async deleteSession(sessionId: number): Promise<void> {
    // 先清空消息的 sessionId（不删除消息本身，保留历史）
    await this.messageRepo.update({ sessionId }, { sessionId: null });
    await this.sessionRepo.delete(sessionId);
    this.logger.log(`Deleted session ${sessionId}`);
  }

  /** 更新会话标题 */
  async updateTitle(sessionId: number, title: string): Promise<void> {
    await this.sessionRepo.update(sessionId, { title });
  }

  /** 递增消息计数（在保存消息后调用） */
  async incrementMessageCount(sessionId: number): Promise<void> {
    await this.sessionRepo.increment({ id: sessionId }, 'messageCount', 1);
    // 同时更新 updatedAt
    await this.sessionRepo.update(sessionId, { updatedAt: new Date() });
  }

  /** 根据第一条用户消息自动生成标题（异步，不阻塞主流程） */
  autoGenerateTitle(sessionId: number, firstUserMessage: string): void {
    const title = firstUserMessage.trim().slice(0, 30);
    this.updateTitle(sessionId, title).catch(e => {
      this.logger.warn(`Failed to auto-generate title for session ${sessionId}:`, e);
    });
  }
}
