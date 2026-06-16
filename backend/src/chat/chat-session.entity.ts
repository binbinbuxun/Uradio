import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity()
@Index('idx_chat_session_updated_at', ['updatedAt'])
export class ChatSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 200, default: '' })
  title: string;

  /** 会话中消息条数（冗余，便于列表展示） */
  @Column({ type: 'int', default: 0 })
  messageCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
