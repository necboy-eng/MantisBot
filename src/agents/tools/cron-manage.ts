import type { Tool } from '../../types.js';
import type { CronService } from '../../cron/service.js';

export function createCronManageTool(cronService: CronService): Tool {
  return {
    name: 'cron_manage',
    description: '管理定时任务（add/update/remove/list/run）',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'update', 'remove', 'run'],
          description: '操作类型: list=列出任务, add=创建任务, update=更新任务, remove=删除任务, run=立即运行'
        },

        // ── add 操作：扁平化参数，避免深层嵌套 ──
        name: { type: 'string', description: '[add] 任务名称' },
        description: { type: 'string', description: '[add] 任务描述（可选）' },
        enabled: { type: 'boolean', description: '[add] 是否启用，默认 true' },

        // 调度方式三选一
        cronExpr: { type: 'string', description: '[add] Cron 表达式，例如 "0 9 * * *"=每天9点，"30 9 * * *"=每天9:30' },
        cronTz: { type: 'string', description: '[add] Cron 时区，默认 Asia/Shanghai' },
        runAt: { type: 'string', description: '[add] 指定时间执行一次（ISO 8601），例如 "2026-03-10T09:00:00+08:00"' },
        everyMs: { type: 'number', description: '[add] 按固定间隔重复执行（毫秒），例如 3600000=每小时' },

        // 任务内容二选一
        message: { type: 'string', description: '[add] agentTurn 类型：Agent 执行的指令文本' },
        text: { type: 'string', description: '[add] systemEvent 类型：直接发送的通知文本（不经过 Agent）' },
        model: { type: 'string', description: '[add] 使用的模型（可选，不填则用默认模型）' },

        // 投递渠道
        channel: {
          type: 'string',
          enum: ['last', 'web', 'feishu', 'wecom', 'dingtalk', 'slack', 'whatsapp', 'wechat'],
          description: '[add] 投递渠道，只能填枚举值之一：last（上次渠道，默认）/ web / feishu / wecom / dingtalk / slack / whatsapp / wechat'
        },

        // ── update/remove/run 操作 ──
        jobId: { type: 'string', description: '[update/remove/run] 任务 ID' },
        patch: {
          type: 'object',
          description: '[update] 更新内容',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            enabled: { type: 'boolean' },
            delivery: {
              type: 'object',
              properties: {
                mode: { type: 'string', enum: ['none', 'announce'] },
                channel: { type: 'string', description: 'last/web/feishu/wecom/dingtalk/slack' },
                to: { type: 'string' }
              }
            }
          }
        }
      },
      required: ['action']
    },
    execute: async (params: Record<string, unknown>) => {
      const { action } = params;

      try {
        switch (action) {
          case 'list': {
            const jobs = await cronService.list({ includeDisabled: true });
            return {
              success: true,
              jobs: jobs.map((job: any) => ({
                id: job.id,
                name: job.name,
                description: job.description,
                enabled: job.enabled,
                schedule: job.schedule,
                nextRunAt: job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : null,
                lastStatus: job.state?.lastStatus,
                lastError: job.state?.lastError
              }))
            };
          }

          case 'add': {
            const p = params as any;

            if (!p.name) {
              return { success: false, error: '缺少 name 参数' };
            }
            if (!p.message && !p.text) {
              return { success: false, error: '缺少任务内容：请提供 message（agentTurn）或 text（systemEvent）' };
            }
            if (!p.cronExpr && !p.runAt && !p.everyMs) {
              return { success: false, error: '缺少调度配置：请提供 cronExpr、runAt 或 everyMs 其中一个' };
            }

            // 组装 schedule
            let schedule: any;
            if (p.runAt) {
              schedule = { kind: 'at', at: p.runAt };
            } else if (p.everyMs) {
              schedule = { kind: 'every', everyMs: p.everyMs };
            } else {
              schedule = { kind: 'cron', expr: p.cronExpr, tz: p.cronTz || 'Asia/Shanghai' };
            }

            // 组装 payload
            const payload: any = p.text
              ? { kind: 'systemEvent', text: p.text }
              : { kind: 'agentTurn', message: p.message, model: p.model || undefined };

            const job: any = {
              name: p.name,
              description: p.description,
              enabled: p.enabled ?? true,
              schedule,
              sessionTarget: 'isolated',
              wakeMode: 'now',
              payload,
              delivery: {
                mode: 'announce',
                channel: p.channel || 'last'
              }
            };

            const id = await cronService.add(job);
            return { success: true, id, message: `定时任务已创建，ID: ${id}` };
          }

          case 'update': {
            const { jobId, patch } = params as { jobId: string; patch: any };
            await cronService.update(jobId, patch);
            return { success: true, message: '任务已更新' };
          }

          case 'remove': {
            const { jobId } = params as { jobId: string };
            await cronService.remove(jobId);
            return { success: true, message: '任务已删除' };
          }

          case 'run': {
            const { jobId } = params as { jobId: string };
            await cronService.run(jobId, 'force');
            return { success: true, message: '任务已触发执行' };
          }

          default:
            return { success: false, error: `未知操作: ${action}` };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
