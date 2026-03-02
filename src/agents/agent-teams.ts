// src/agents/agent-teams.ts
// Agent Teams 管理：预置团队定义 + AgentDefinition 构建逻辑

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { AgentTeam, AgentDefinition } from '../config/schema.js';
import { AgentTeamSchema } from '../config/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// data/teams/ 相对于项目根目录
const TEAMS_DIR = join(__dirname, '../../data/teams');

// ============================================
// 预置团队（内置示例，帮助用户快速上手）
// ============================================

/**
 * 从 data/teams/ 目录动态加载 JSON 预置团队。
 * 每个 .json 文件对应一个团队，Schema 验证不通过时跳过并打印警告。
 */
function loadPresetTeamsFromDir(): AgentTeam[] {
  if (!existsSync(TEAMS_DIR)) return [];
  const loaded: AgentTeam[] = [];
  for (const file of readdirSync(TEAMS_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    const filePath = join(TEAMS_DIR, file);
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      const team = AgentTeamSchema.parse(raw);
      loaded.push(team);
      console.log(`[AgentTeams] Loaded preset team from file: ${file} (${team.id})`);
    } catch (err) {
      console.warn(`[AgentTeams] Failed to load preset team from ${file}:`, err instanceof Error ? err.message : String(err));
    }
  }
  return loaded;
}

export const PRESET_TEAMS: AgentTeam[] = [
  {
    id: 'research-team',
    name: '深度研究团队',
    description: '适合需要多角度、大范围搜索和分析的复杂研究任务',
    triggerCommand: 'research',
    autoDetectKeywords: ['深度研究', '详细调研', '全面分析', '帮我研究'],
    enabled: false, // 预置团队默认禁用，用户手动启用
    orchestrator: {
      model: 'opus',
      systemPrompt: `你是一个深度研究协调者。当用户提出研究任务时，你负责：
1. 将任务分解为多个独立的研究方向
2. 派遣专业 Subagent 并行探索不同方向
3. 汇总各 Subagent 的研究结果，生成综合报告

分配任务时请明确：
- 每个 Subagent 的具体研究目标
- 期望的输出格式（信息列表、数据分析、摘要等）
- 使用哪些工具和资源来源`,
      maxTurns: 50,
    },
    agents: {
      'web-researcher': {
        description: '专注网络信息搜索，当需要获取最新网络资讯、新闻或公开信息时调用',
        systemPrompt: `你是一个专业的网络研究员。你的任务是高效搜索和提取网络信息：
- 从广泛的查询开始，逐步缩小范围
- 优先选择权威来源（官方网站、学术机构、知名媒体）
- 避免过长的搜索查询，保持简洁精准
- 并行使用多个搜索工具提高效率`,
        tools: ['WebSearch', 'WebFetch', 'Read'],
        model: 'sonnet',
        maxTurns: 20,
        skills: [],
      },
      'data-analyst': {
        description: '专注数据处理和分析，当需要分析结构化数据、生成图表或进行量化研究时调用',
        systemPrompt: `你是一个数据分析专家，擅长处理和分析各类数据：
- 读取和解析各种格式的数据文件
- 执行统计分析和趋势识别
- 生成清晰的数据摘要和洞察
- 如有需要可编写脚本处理数据`,
        tools: ['Read', 'Write', 'Bash'],
        model: 'haiku',
        maxTurns: 15,
        skills: ['xlsx'],
      },
      'report-writer': {
        description: '专注内容综合和报告撰写，当需要将多方信息整合成结构化报告时调用',
        systemPrompt: `你是一个专业技术写作者，负责将研究信息整合成高质量报告：
- 结构清晰，逻辑严谨
- 确保信息准确，来源可靠
- 根据目标受众调整语言风格
- 使用合适的格式（标题、列表、表格）提升可读性`,
        tools: ['Read', 'Write'],
        model: 'haiku',
        maxTurns: 10,
        skills: [],
      },
    },
  },
  // 其余预置团队从 data/teams/*.json 动态加载
  ...loadPresetTeamsFromDir(),
];

// ============================================
// AgentDefinition 构建：将 MantisBot 格式转换为 SDK 格式
// ============================================

/**
 * 将 MantisBot AgentDefinition 转换为 Claude Agent SDK 所需格式
 * MantisBot 使用 systemPrompt，SDK 使用 prompt
 */
export function toSdkAgentDefinition(agentDef: AgentDefinition): Record<string, unknown> {
  const sdkDef: Record<string, unknown> = {
    description: agentDef.description,
    prompt: agentDef.systemPrompt || agentDef.description,
  };

  if (agentDef.tools && agentDef.tools.length > 0) {
    sdkDef.tools = agentDef.tools;
  }
  if (agentDef.disallowedTools && agentDef.disallowedTools.length > 0) {
    sdkDef.disallowedTools = agentDef.disallowedTools;
  }
  if (agentDef.model && agentDef.model !== 'inherit') {
    sdkDef.model = agentDef.model;
  }
  if (agentDef.maxTurns) {
    sdkDef.maxTurns = agentDef.maxTurns;
  }
  if (agentDef.skills && agentDef.skills.length > 0) {
    sdkDef.skills = agentDef.skills;
  }

  return sdkDef;
}

/**
 * 将团队的 agents 配置转换为 SDK agents 格式
 */
export function buildSdkAgents(team: AgentTeam): Record<string, unknown> {
  const sdkAgents: Record<string, unknown> = {};
  for (const [agentId, agentDef] of Object.entries(team.agents)) {
    sdkAgents[agentId] = toSdkAgentDefinition(agentDef);
  }
  return sdkAgents;
}

/**
 * 根据消息内容自动检测应使用的团队（关键词匹配）
 */
export function detectTeamFromMessage(
  message: string,
  teams: AgentTeam[]
): AgentTeam | null {
  const enabledTeams = teams.filter(t => t.enabled);
  for (const team of enabledTeams) {
    if (team.autoDetectKeywords.length === 0) continue;
    const lowerMsg = message.toLowerCase();
    const matched = team.autoDetectKeywords.some(kw =>
      lowerMsg.includes(kw.toLowerCase())
    );
    if (matched) return team;
  }
  return null;
}

/**
 * 根据命令名称查找对应团队（/command 触发）
 */
export function findTeamByCommand(
  command: string,
  teams: AgentTeam[]
): AgentTeam | null {
  return teams.find(t => t.enabled && t.triggerCommand === command) ?? null;
}
