import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity()
@Index('idx_chat_message_created_at', ['createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  @Index('idx_chat_message_chat_id')
  chatId: string;

  /** 所属会话（nullable，兼容旧数据） */
  @Column({ type: 'int', nullable: true })
  @Index('idx_chat_message_session_id')
  sessionId: number | null;

  @Column()
  role: 'user' | 'dj';

  @Column('text')
  content: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata: {
    source?: 'chat' | 'radio_auto';
    recommendedSongs?: any[];
    searchResults?: any[];
    structuredReason?: string;
    segueType?: 'opening' | 'segue' | 'recommendation';
    songTitle?: string;
    artist?: string;
    executionTrace?: any;
  } | null;

  @CreateDateColumn()
  createdAt: Date;
}
