import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  chatId: string;

  @Column()
  role: 'user' | 'dj';

  @Column('text')
  content: string;

  @Column({ type: 'simple-json', nullable: true })
  metadata: {
    recommendedSongs?: any[];
    searchResults?: any[];
    structuredReason?: string;
  } | null;

  @CreateDateColumn()
  createdAt: Date;
}
