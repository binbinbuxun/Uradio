import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionTrace, TraceStep } from './execution-trace.entity';

/**
 * 活跃的执行轨迹 — 在请求生命周期内累积步骤，结束时一次性持久化
 */
export class ActiveTrace {
  private steps: TraceStep[] = [];
  private startTime = Date.now();
  private currentStepStart = 0;
  private currentStepName = '';

  constructor(
    private readonly chatId: string,
    private readonly traceRepo: Repository<ExecutionTrace>,
    private readonly logger: Logger,
  ) {}

  /**
   * 开始一个步骤
   */
  step(name: string): this {
    this.currentStepName = name;
    this.currentStepStart = Date.now();
    return this;
  }

  /**
   * 结束当前步骤并记录
   */
  endStep(output?: any, status: 'ok' | 'error' | 'skipped' = 'ok', error?: string): this {
    const durationMs = Date.now() - this.currentStepStart;
    this.steps.push({
      name: this.currentStepName,
      input: undefined, // input 在 step() 时设置或手动添加
      output: this.sanitize(output),
      durationMs,
      status,
      error,
    });
    this.logger.debug(`Trace [${this.chatId}] ${this.currentStepName}: ${durationMs}ms (${status})`);
    return this;
  }

  /**
   * 快捷记录一个完整步骤 (同步/已知耗时)
   */
  addStep(name: string, durationMs: number, output?: any, status: 'ok' | 'error' | 'skipped' = 'ok', error?: string): this {
    this.steps.push({
      name,
      input: undefined,
      output: this.sanitize(output),
      durationMs,
      status,
      error,
    });
    return this;
  }

  /**
   * 为最后一个步骤补充 input
   */
  withInput(input: any): this {
    if (this.steps.length > 0) {
      this.steps[this.steps.length - 1].input = this.sanitize(input);
    }
    return this;
  }

  /**
   * 结束追踪并保存到数据库
   */
  async finish(status: 'ok' | 'error' | 'partial' = 'ok'): Promise<ExecutionTrace | null> {
    const totalDurationMs = Date.now() - this.startTime;
    const trace = this.traceRepo.create({
      chatId: this.chatId,
      steps: this.steps,
      totalDurationMs,
      status,
    });

    try {
      const saved = await this.traceRepo.save(trace);
      this.logger.log(`Trace [${this.chatId}] completed: ${totalDurationMs}ms, ${this.steps.length} steps (${status})`);
      return saved;
    } catch (e) {
      this.logger.warn(`Failed to save execution trace: ${e}`);
      return null;
    }
  }

  /**
   * 获取当前步骤快照 (不持久化，用于调试)
   */
  getSteps(): TraceStep[] {
    return [...this.steps];
  }

  /**
   * 获取当前总耗时
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * 清理输出，避免存储过大的数据
   */
  private sanitize(data: any): any {
    if (data === undefined || data === null) return undefined;
    if (typeof data === 'string') {
      return data.length > 500 ? data.substring(0, 500) + '...(truncated)' : data;
    }
    if (typeof data === 'object') {
      try {
        const str = JSON.stringify(data);
        if (str.length > 1000) {
          return JSON.parse(str.substring(0, 1000) + '...(truncated)');
        }
      } catch {
        return '[non-serializable]';
      }
    }
    return data;
  }
}

@Injectable()
export class TraceService {
  private readonly logger = new Logger(TraceService.name);

  constructor(
    @InjectRepository(ExecutionTrace)
    private readonly traceRepo: Repository<ExecutionTrace>,
  ) {}

  /**
   * 创建一个活跃的执行轨迹
   */
  startTrace(chatId: string): ActiveTrace {
    this.logger.debug(`Trace [${chatId}] started`);
    return new ActiveTrace(chatId, this.traceRepo, this.logger);
  }

  /**
   * 根据 chatId 查询执行轨迹
   */
  async getByChatId(chatId: string): Promise<ExecutionTrace | null> {
    return this.traceRepo.findOne({ where: { chatId } });
  }

  /**
   * 获取最近的执行轨迹列表
   */
  async getRecent(limit = 20): Promise<ExecutionTrace[]> {
    return this.traceRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 获取格式化的轨迹摘要 (用于 systemContext)
   */
  async getFormattedSummary(chatId: string): Promise<string> {
    const trace = await this.getByChatId(chatId);
    if (!trace) return '';

    const lines = trace.steps.map(s => {
      const status = s.status === 'ok' ? '✓' : s.status === 'error' ? '✗' : '⊘';
      return `${status} ${s.name}: ${s.durationMs}ms`;
    });
    return `执行轨迹 (总${trace.totalDurationMs}ms):\n${lines.join('\n')}`;
  }
}
