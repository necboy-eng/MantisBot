import { v4 as uuidv4 } from 'uuid';
import { CronExpressionParser } from 'cron-parser';

// Cron 类型定义
export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | { kind: "cron"; expr: string; tz?: string };

export type CronSessionTarget = "main" | "isolated";
export type CronWakeMode = "next-heartbeat" | "now";
export type CronMessageChannel = string | "last";
export type CronDeliveryMode = "none" | "announce";

export type CronDelivery = {
  mode: CronDeliveryMode;
  channel?: CronMessageChannel;
  to?: string;
  bestEffort?: boolean;
};

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | {
      kind: "agentTurn";
      message: string;
      model?: string;
      skills?: string[];      // 指定可用的 skill 名称列表，为空则禁用所有 skill
      deliver?: boolean;
      channel?: CronMessageChannel;
      to?: string;
    };

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
};

export type CronJob = {
  id: string;
  agentId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  delivery?: CronDelivery;
  state: CronJobState;
};

export type CronJobCreate = Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs" | "state"> & {
  state?: Partial<CronJobState>;
};

export type CronJobPatch = Partial<Omit<CronJob, "id" | "createdAtMs" | "state" | "payload">> & {
  payload?: Partial<CronPayload>;
  delivery?: Partial<CronDelivery>;
  state?: Partial<CronJobState>;
};

// CronExecutor 接口
export interface CronExecutor {
  executePayload(job: CronJob): Promise<void>;
}

export type CronServiceDeps = {
  storePath: string;
  executor: CronExecutor;
  workspace?: string;
};

// CronService 类
export class CronService {
  private jobs: Map<string, CronJob> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private deps: CronServiceDeps;

  constructor(deps: CronServiceDeps) {
    this.deps = deps;
  }

  async start() {
    // 加载已保存的任务
    await this.loadJobs();

    // 启动定时器，每分钟检查一次
    this.timer = setInterval(() => {
      this.checkAndRunJobs();
    }, 60000);

    console.log('[CronService] Started');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[CronService] Stopped');
  }

  async status() {
    return {
      running: this.timer !== null,
      jobCount: this.jobs.size,
      nextRunMs: this.getNextRunTime()
    };
  }

  async list(opts?: { includeDisabled?: boolean }) {
    const jobs = Array.from(this.jobs.values());
    if (!opts?.includeDisabled) {
      return jobs.filter(j => j.enabled);
    }
    return jobs;
  }

  async add(input: CronJobCreate): Promise<string> {
    const id = uuidv4();
    const now = Date.now();

    const job: CronJob = {
      ...input,
      id,
      createdAtMs: now,
      updatedAtMs: now,
      state: {
        nextRunAtMs: this.calculateNextRun(input.schedule)
      }
    };

    this.jobs.set(id, job);
    await this.saveJobs();

    return id;
  }

  async update(id: string, patch: CronJobPatch) {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }

    const updated: CronJob = {
      ...job,
      ...patch,
      payload: patch.payload ? { ...job.payload, ...patch.payload } as CronJob['payload'] : job.payload,
      updatedAtMs: Date.now()
    };

    // 重新计算下次运行时间
    if (patch.schedule) {
      updated.state.nextRunAtMs = this.calculateNextRun(patch.schedule);
    }

    this.jobs.set(id, updated);
    await this.saveJobs();
  }

  async remove(id: string) {
    this.jobs.delete(id);
    await this.saveJobs();
  }

  async run(id: string, mode?: "due" | "force") {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }

    // 执行任务
    try {
      job.state.runningAtMs = Date.now();
      await this.deps.executor.executePayload(job);

      const finishedAt = Date.now();
      job.state.lastRunAtMs = finishedAt;
      job.state.lastStatus = 'ok';
      job.state.runningAtMs = undefined;
      job.state.lastDurationMs = finishedAt - (job.state.runningAtMs || finishedAt);

      // 一次性任务（kind=at）：只有到期自动触发时才删除，手动 force 执行不删除
      if (job.schedule.kind === 'at' && mode !== 'force') {
        this.jobs.delete(id);
      } else {
        // 重新计算下次运行时间
        job.state.nextRunAtMs = this.calculateNextRun(job.schedule);
      }
    } catch (error) {
      job.state.lastStatus = 'error';
      job.state.lastError = error instanceof Error ? error.message : String(error);
      job.state.runningAtMs = undefined;
    }

    await this.saveJobs();
  }

  private async checkAndRunJobs() {
    const now = Date.now();

    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;

      const nextRun = job.state.nextRunAtMs;
      if (nextRun && nextRun <= now) {
        try {
          await this.run(job.id);
        } catch (error) {
          console.error(`[CronService] Job ${job.id} failed:`, error);
        }
      }
    }
  }

  private calculateNextRun(schedule: CronSchedule): number | undefined {
    const now = Date.now();

    if (schedule.kind === 'at') {
      const time = new Date(schedule.at).getTime();
      return time > now ? time : undefined;
    }

    if (schedule.kind === 'every') {
      return now + schedule.everyMs;
    }

    if (schedule.kind === 'cron') {
      try {
        const expr = CronExpressionParser.parse(schedule.expr, {
          tz: schedule.tz || 'Asia/Shanghai'
        });
        const next = expr.next().getTime();
        return next > now ? next : undefined;
      } catch (error) {
        console.error('[CronService] Failed to parse cron expression:', schedule.expr, error);
        return undefined;
      }
    }

    return undefined;
  }

  private getNextRunTime(): number | undefined {
    let minTime: number | undefined;

    for (const job of this.jobs.values()) {
      if (job.enabled && job.state.nextRunAtMs) {
        if (!minTime || job.state.nextRunAtMs < minTime) {
          minTime = job.state.nextRunAtMs;
        }
      }
    }

    return minTime;
  }

  private async loadJobs() {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { dirname } = path;

      // 确保目录存在
      const dir = dirname(this.deps.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.deps.storePath)) {
        const data = fs.readFileSync(this.deps.storePath, 'utf-8');
        const store = JSON.parse(data);

        if (store.jobs && Array.isArray(store.jobs)) {
          for (const job of store.jobs) {
            this.jobs.set(job.id, job);
          }
        }
      }
    } catch (error) {
      console.error('[CronService] Failed to load jobs:', error);
    }
  }

  private async saveJobs() {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { dirname } = path;

      const dir = dirname(this.deps.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        version: 1,
        jobs: Array.from(this.jobs.values())
      };

      fs.writeFileSync(this.deps.storePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('[CronService] Failed to save jobs:', error);
    }
  }
}
