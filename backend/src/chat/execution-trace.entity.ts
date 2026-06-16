import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** 执行轨迹中的单个步骤 */
export interface TraceStep {
  /** 步骤名称 */
  name: string;
  /** 步骤输入 (简略) */
  input?: any;
  /** 步骤输出 (简略) */
  output?: any;
  /** 步骤耗时 (ms) */
  durationMs: number;
  /** 步骤状态 */
  status: 'ok' | 'error' | 'skipped';
  /** 错误信息 (如果失败) */
  error?: string;
}

@Entity()
@Index('idx_execution_trace_chat_id', ['chatId'])
@Index('idx_execution_trace_created_at', ['createdAt'])
export class ExecutionTrace {
  @PrimaryGeneratedColumn()
  id: number;

  /** 关联的 chatId */
  @Column()
  chatId: string;

  /** 执行步骤数组 */
  @Column({ type: 'simple-json', nullable: false })
  steps: TraceStep[];

  /** 总耗时 (ms) */
  @Column({ default: 0 })
  totalDurationMs: number;

  /** 整体状态 */
  @Column({ type: 'varchar', length: 16, default: 'ok' })
  status: 'ok' | 'error' | 'partial';

  @CreateDateColumn()
  createdAt: Date;
}
