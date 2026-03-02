import { useMemo } from 'react';

interface AgentInvocationStatus {
  agentName: string;
  agentId: string;
  phase: 'running' | 'done';
  startTime: number;
  endTime?: number;
  task?: string;
}

interface AgentTimelineProps {
  invocations: AgentInvocationStatus[];
}

/**
 * 将 agent key 格式化为可读标签
 * 例：web-researcher → Web Researcher
 *     mcp__mantis-tools__data-analyst → Data Analyst
 */
function formatAgentName(name: string): string {
  // 去除 MCP 前缀 mcp__<server>__
  const base = name.includes('__') ? name.split('__').pop()! : name;
  // kebab-case / snake_case → Title Case
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// 固定颜色池：按 agent 名称首次出现顺序分配
const COLOR_POOL = [
  { dot: 'bg-purple-500', ring: 'ring-purple-400', badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300', line: 'bg-purple-200 dark:bg-purple-800' },
  { dot: 'bg-blue-500',   ring: 'ring-blue-400',   badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',       line: 'bg-blue-200 dark:bg-blue-800' },
  { dot: 'bg-emerald-500',ring: 'ring-emerald-400', badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', line: 'bg-emerald-200 dark:bg-emerald-800' },
  { dot: 'bg-orange-500', ring: 'ring-orange-400',  badge: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300', line: 'bg-orange-200 dark:bg-orange-800' },
  { dot: 'bg-pink-500',   ring: 'ring-pink-400',    badge: 'bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300',       line: 'bg-pink-200 dark:bg-pink-800' },
  { dot: 'bg-teal-500',   ring: 'ring-teal-400',    badge: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',       line: 'bg-teal-200 dark:bg-teal-800' },
];

export function AgentTimeline({ invocations }: AgentTimelineProps) {
  // 按首次出现顺序给每个 agent 名称分配颜色索引
  const agentColorIndex = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of invocations) {
      if (!map.has(inv.agentName)) {
        map.set(inv.agentName, map.size % COLOR_POOL.length);
      }
    }
    return map;
  }, [invocations]);

  const runningCount = invocations.filter(i => i.phase === 'running').length;
  const doneCount = invocations.filter(i => i.phase === 'done').length;

  return (
    <div className="mb-2 rounded-lg border border-purple-200 dark:border-purple-800/60 bg-purple-50/60 dark:bg-purple-950/20 overflow-hidden">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-purple-200 dark:border-purple-800/60">
        <span className="text-purple-600 dark:text-purple-400 text-xs">⬡</span>
        <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">Agent 团队执行</span>
        <div className="flex items-center gap-1.5 ml-auto">
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
              <span className="inline-block w-2 h-2 border border-purple-500 border-t-transparent rounded-full animate-spin" />
              {runningCount} 运行中
            </span>
          )}
          {doneCount > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">{doneCount} 已完成</span>
          )}
        </div>
      </div>

      {/* 时间线 */}
      <div className="px-3 py-2.5 space-y-0">
        {invocations.map((inv, idx) => {
          const colorIdx = agentColorIndex.get(inv.agentName) ?? 0;
          const colors = COLOR_POOL[colorIdx];
          const isLast = idx === invocations.length - 1;
          const duration = inv.endTime ? ((inv.endTime - inv.startTime) / 1000).toFixed(1) : null;

          return (
            <div key={`${inv.agentId}-${idx}`} className="flex gap-2.5">
              {/* 时间轴线 + 节点 */}
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 16 }}>
                <div className={`
                  w-3 h-3 rounded-full flex-shrink-0 mt-0.5
                  ${inv.phase === 'running'
                    ? `${colors.dot} ring-2 ring-offset-1 ring-offset-purple-50 dark:ring-offset-purple-950/20 ${colors.ring} animate-pulse`
                    : `${colors.dot} opacity-70`
                  }
                `} />
                {!isLast && (
                  <div className={`w-0.5 flex-1 mt-1 ${colors.line} min-h-[12px]`} />
                )}
              </div>

              {/* 内容 */}
              <div className={`flex-1 pb-${isLast ? '0' : '2'} min-w-0`}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Agent 名称 */}
                  <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-semibold ${colors.badge}`}>
                    {formatAgentName(inv.agentName)}
                  </span>

                  {/* 状态 */}
                  {inv.phase === 'running' ? (
                    <span className="text-xs text-gray-400 dark:text-gray-500 italic">处理中…</span>
                  ) : (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">✓</span>
                  )}

                  {/* 耗时 */}
                  {duration && (
                    <span className="ml-auto text-xs font-mono text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {duration}s
                    </span>
                  )}
                </div>

                {/* 任务描述 */}
                {inv.task && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed break-words">
                    {inv.task}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
