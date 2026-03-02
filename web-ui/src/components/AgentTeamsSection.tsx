import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, Users, Bot, Star, AlertCircle } from 'lucide-react';
import { authFetch } from '../utils/auth';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentDefinition {
  description: string;
  systemPrompt?: string;
  tools?: string[];
  disallowedTools?: string[];
  model: string;
  maxTurns?: number;
  skills?: string[];
}

interface AgentTeam {
  id: string;
  name: string;
  description?: string;
  triggerCommand?: string;
  autoDetectKeywords: string[];
  enabled: boolean;
  _isPreset?: boolean;
  orchestrator: {
    model: string;
    systemPrompt?: string;
    maxTurns: number;
  };
  agents: Record<string, AgentDefinition>;
}

interface ToolInfo {
  id: string;
  group: string;
  label: string;
}

interface SkillInfo {
  name: string;
  description: string;
}

interface ConfiguredModel {
  name: string;
  model: string;
  protocol?: string;
  provider?: string;
}

const TOOL_GROUPS: Record<string, string> = {
  file: '文件',
  exec: '执行',
  web: '网络',
  memory: '记忆',
  storage: '存储',
  other: '其他',
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s\u4e00-\u9fa5]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || `team-${Date.now()}`;
}

// ─── SubagentCard ────────────────────────────────────────────────────────────

function SubagentCard({
  agentId,
  agent,
  tools,
  availableSkills,
  claudeModels,
  onChange,
  onDelete,
}: {
  agentId: string;
  agent: AgentDefinition;
  tools: ToolInfo[];
  availableSkills: SkillInfo[];
  claudeModels: ConfiguredModel[];
  onChange: (id: string, updated: AgentDefinition) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localId, setLocalId] = useState(agentId);

  function update(patch: Partial<AgentDefinition>) {
    onChange(agentId, { ...agent, ...patch });
  }

  function toggleTool(toolId: string) {
    const current = agent.tools || [];
    const next = current.includes(toolId)
      ? current.filter(t => t !== toolId)
      : [...current, toolId];
    update({ tools: next });
  }

  const toolsByGroup: Record<string, ToolInfo[]> = {};
  for (const tool of tools) {
    if (!toolsByGroup[tool.group]) toolsByGroup[tool.group] = [];
    toolsByGroup[tool.group].push(tool);
  }

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 select-none"
        onClick={() => setOpen(o => !o)}
      >
        <Bot className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <span className="font-mono text-sm font-medium flex-1 text-gray-800 dark:text-gray-200">
          {agentId}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded-full">
          {agent.model === 'inherit' ? '继承' : agent.model}
        </span>
        {(agent.tools?.length ?? 0) > 0 && (
          <span className="text-xs text-gray-400">
            {agent.tools!.join(', ').slice(0, 30)}{agent.tools!.join(', ').length > 30 ? '…' : ''}
          </span>
        )}
        <button
          className="text-red-400 hover:text-red-600 p-1 rounded ml-1"
          onClick={e => { e.stopPropagation(); onDelete(agentId); }}
          title="删除此 Agent"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </div>

      {/* Expanded Content */}
      {open && (
        <div className="px-4 py-3 space-y-4 bg-white dark:bg-gray-800">
          {/* Agent ID (rename) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Agent ID（英文，唯一）</label>
            <input
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              value={localId}
              onChange={e => setLocalId(e.target.value)}
              onBlur={() => {
                if (localId !== agentId && localId.trim()) {
                  onDelete(agentId);
                  onChange(localId.trim(), agent);
                }
              }}
              placeholder="web-researcher"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              何时调用（description）
              <span className="text-red-400 ml-1">*</span>
              <span className="text-gray-400 ml-1 font-normal">— Orchestrator 依据此决定派谁上场</span>
            </label>
            <textarea
              rows={2}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-none"
              value={agent.description}
              onChange={e => update({ description: e.target.value })}
              placeholder="专注网络信息搜索，当需要获取最新网络资讯时调用"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">人格 / System Prompt</label>
            <textarea
              rows={3}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 resize-y"
              value={agent.systemPrompt || ''}
              onChange={e => update({ systemPrompt: e.target.value })}
              placeholder="你是一个专业的网络研究员，擅长..."
            />
          </div>

          {/* Tools */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">允许使用的工具</label>
            <div className="space-y-2">
              {Object.entries(toolsByGroup).map(([group, groupTools]) => (
                <div key={group}>
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">{TOOL_GROUPS[group] || group}</div>
                  <div className="flex flex-wrap gap-2">
                    {groupTools.map(tool => {
                      const checked = (agent.tools || []).includes(tool.id);
                      return (
                        <label
                          key={tool.id}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs cursor-pointer transition-colors ${
                            checked
                              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                              : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={checked}
                            onChange={() => toggleTool(tool.id)}
                          />
                          {tool.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Model + MaxTurns */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">模型</label>
              <select
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                value={agent.model}
                onChange={e => update({ model: e.target.value })}
              >
                <option value="inherit">继承主 Agent</option>
                {claudeModels.map(m => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">最大循环次数</label>
              <input
                type="number"
                min={1}
                max={200}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                value={agent.maxTurns ?? 20}
                onChange={e => update({ maxTurns: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Skills */}
          {availableSkills.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">预加载 Skills</label>
              <div className="flex flex-wrap gap-2">
                {availableSkills.map(skill => {
                  const checked = (agent.skills || []).includes(skill.name);
                  return (
                    <label
                      key={skill.name}
                      title={skill.description || skill.name}
                      className={`flex items-center gap-1 px-2 py-1 rounded border text-xs cursor-pointer transition-colors ${
                        checked
                          ? 'border-purple-400 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                          : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-500'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={checked}
                        onChange={() => {
                          const current = agent.skills || [];
                          update({
                            skills: checked
                              ? current.filter(s => s !== skill.name)
                              : [...current, skill.name],
                          });
                        }}
                      />
                      {skill.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TeamEditor ──────────────────────────────────────────────────────────────

function TeamEditor({
  team,
  tools,
  availableSkills,
  claudeModels,
  onSave,
  onDelete,
}: {
  team: AgentTeam;
  tools: ToolInfo[];
  availableSkills: SkillInfo[];
  claudeModels: ConfiguredModel[];
  onSave: (t: AgentTeam) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AgentTeam>(() => JSON.parse(JSON.stringify(team)));
  const [saving, setSaving] = useState(false);
  const [keywordInput, setKeywordInput] = useState('');
  const [orchOpen, setOrchOpen] = useState(true);

  // Reset draft when selecting a different team
  useEffect(() => {
    setDraft(JSON.parse(JSON.stringify(team)));
    setOrchOpen(true);
  }, [team.id]);

  function patch(p: Partial<AgentTeam>) {
    setDraft(d => ({ ...d, ...p }));
  }

  function patchOrch(p: Partial<AgentTeam['orchestrator']>) {
    setDraft(d => ({ ...d, orchestrator: { ...d.orchestrator, ...p } }));
  }

  function addKeyword() {
    const kw = keywordInput.trim();
    if (!kw || draft.autoDetectKeywords.includes(kw)) return;
    patch({ autoDetectKeywords: [...draft.autoDetectKeywords, kw] });
    setKeywordInput('');
  }

  function removeKeyword(kw: string) {
    patch({ autoDetectKeywords: draft.autoDetectKeywords.filter(k => k !== kw) });
  }

  function updateAgent(id: string, updated: AgentDefinition) {
    setDraft(d => ({ ...d, agents: { ...d.agents, [id]: updated } }));
  }

  function deleteAgent(id: string) {
    setDraft(d => {
      const next = { ...d.agents };
      delete next[id];
      return { ...d, agents: next };
    });
  }

  function addAgent() {
    const newId = `agent-${Object.keys(draft.agents).length + 1}`;
    updateAgent(newId, {
      description: '请描述何时调用此 Agent',
      systemPrompt: '',
      tools: [],
      model: 'inherit',
      maxTurns: 20,
      skills: [],
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  const isPreset = !!(team as any)._isPreset;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Scrollable area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {isPreset && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-sm text-amber-700 dark:text-amber-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            这是预置示例团队，点击保存后将添加到你的配置中。
          </div>
        )}

        {/* Basic Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">基本信息</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-xs text-gray-500">启用</span>
              <div
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  draft.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                }`}
                onClick={() => patch({ enabled: !draft.enabled })}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  draft.enabled ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </div>
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">团队名称 <span className="text-red-400">*</span></label>
            <input
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              value={draft.name}
              onChange={e => patch({ name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">触发命令（不含 /）</label>
            <input
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono"
              value={draft.triggerCommand || ''}
              onChange={e => patch({ triggerCommand: e.target.value.replace(/^\//, '') })}
              placeholder="research"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">团队描述（用于 AI 自动判断）</label>
            <textarea
              rows={2}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none"
              value={draft.description || ''}
              onChange={e => patch({ description: e.target.value })}
              placeholder="适合需要多角度、大范围搜索和分析的复杂研究任务"
            />
          </div>

          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">自动识别关键词</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {draft.autoDetectKeywords.map(kw => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs"
                >
                  {kw}
                  <button onClick={() => removeKeyword(kw)} className="hover:text-red-500">×</button>
                </span>
              ))}
              <div className="flex gap-1">
                <input
                  className="px-2 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 w-28"
                  value={keywordInput}
                  onChange={e => setKeywordInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addKeyword()}
                  placeholder="添加关键词"
                />
                <button
                  onClick={addKeyword}
                  className="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Orchestrator */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div
            className="flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/30 select-none"
            onClick={() => setOrchOpen(o => !o)}
          >
            <Star className="w-4 h-4 text-yellow-500" />
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex-1">
              主协调者 (Orchestrator)
            </span>
            <span className="text-xs text-gray-500 bg-yellow-100 dark:bg-yellow-900/40 px-2 py-0.5 rounded-full">
              {draft.orchestrator.model}
            </span>
            {orchOpen
              ? <ChevronDown className="w-4 h-4 text-gray-400" />
              : <ChevronRight className="w-4 h-4 text-gray-400" />}
          </div>
          {orchOpen && (
            <div className="px-4 py-3 space-y-3">
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">模型</label>
                  <select
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    value={draft.orchestrator.model}
                    onChange={e => patchOrch({ model: e.target.value })}
                  >
                    {claudeModels.length > 0 ? (
                      claudeModels.map(m => (
                        <option key={m.name} value={m.name}>{m.name}</option>
                      ))
                    ) : (
                      <>
                        <option value="opus">Opus (最强)</option>
                        <option value="sonnet">Sonnet (均衡)</option>
                        <option value="haiku">Haiku (快/省)</option>
                      </>
                    )}
                  </select>
                </div>
                <div className="w-28">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">最大循环次数</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                    value={draft.orchestrator.maxTurns}
                    onChange={e => patchOrch({ maxTurns: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">System Prompt</label>
                <textarea
                  rows={4}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-y"
                  value={draft.orchestrator.systemPrompt || ''}
                  onChange={e => patchOrch({ systemPrompt: e.target.value })}
                  placeholder="你是一个协调者，负责分解任务并分配给专业子 Agent..."
                />
              </div>
            </div>
          )}
        </div>

        {/* Subagents */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Subagents
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({Object.keys(draft.agents).length} 个)
              </span>
            </h3>
            <button
              onClick={addAgent}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-700"
            >
              <Plus className="w-3 h-3" />
              添加 Subagent
            </button>
          </div>
          <div className="space-y-2">
            {Object.entries(draft.agents).map(([agentId, agent]) => (
              <SubagentCard
                key={agentId}
                agentId={agentId}
                agent={agent}
                tools={tools}
                availableSkills={availableSkills}
                claudeModels={claudeModels}
                onChange={updateAgent}
                onDelete={deleteAgent}
              />
            ))}
            {Object.keys(draft.agents).length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                还没有 Subagent，点击上方"添加"按钮
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-between bg-white dark:bg-gray-900">
        <button
          onClick={() => onDelete(team.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          {isPreset ? '移除示例' : '删除团队'}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDraft(JSON.parse(JSON.stringify(team)))}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
          >
            重置
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !draft.name.trim()}
            className="px-4 py-1.5 text-sm font-medium rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '保存中…' : isPreset ? '保存并启用' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AgentTeamsSection (main) ────────────────────────────────────────────────

export function AgentTeamsSection() {
  const [teams, setTeams] = useState<AgentTeam[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [claudeModels, setClaudeModels] = useState<ConfiguredModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedTeam = teams.find(t => t.id === selectedId) ?? null;

  const showSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 2500);
  }, []);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [teamsRes, toolsRes, skillsRes, configRes] = await Promise.all([
        authFetch('/api/agent-teams'),
        authFetch('/api/agent-teams/tools'),
        authFetch('/api/agent-teams/skills'),
        authFetch('/api/config'),
      ]);
      const teamsData = await teamsRes.json();
      const toolsData = await toolsRes.json();
      const skillsData = await skillsRes.json();
      const configData = await configRes.json();
      setTeams(teamsData.teams || []);
      setTools(toolsData.tools || []);
      setAvailableSkills(skillsData.skills || []);
      // 过滤出 Anthropic 协议的模型（protocol 或 provider 为 anthropic，或名称含 claude）
      const allModels: ConfiguredModel[] = configData.models || [];
      setClaudeModels(
        allModels.filter(m =>
          m.protocol === 'anthropic' ||
          m.provider === 'anthropic' ||
          m.name?.toLowerCase().includes('claude')
        )
      );
      if (!selectedId && teamsData.teams?.length > 0) {
        setSelectedId(teamsData.teams[0].id);
      }
    } catch {
      setError('加载 Agent Teams 配置失败');
    } finally {
      setLoading(false);
    }
  }

  function createNewTeam() {
    const newTeam: AgentTeam = {
      id: slugify(`新团队 ${teams.length + 1}`),
      name: `新团队 ${teams.length + 1}`,
      description: '',
      triggerCommand: '',
      autoDetectKeywords: [],
      enabled: true,
      orchestrator: { model: 'opus', systemPrompt: '', maxTurns: 50 },
      agents: {},
    };
    setTeams(prev => [...prev, newTeam]);
    setSelectedId(newTeam.id);
  }

  async function handleSave(draft: AgentTeam) {
    const isNew = (teams.find(t => t.id === draft.id) as any)?._isPreset;
    const method = isNew ? 'POST' : 'PUT';
    const url = isNew ? '/api/agent-teams' : `/api/agent-teams/${draft.id}`;
    // Strip _isPreset before saving
    const { _isPreset: _, ...teamToSave } = draft as any;
    const res = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(teamToSave),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Save failed');
    }
    showSuccess('保存成功');
    await loadAll();
    setSelectedId(draft.id);
  }

  async function handleDelete(id: string) {
    const team = teams.find(t => t.id === id);
    if (!team) return;
    // If preset (not saved), just remove from local list
    if ((team as any)._isPreset) {
      setTeams(prev => prev.filter(t => t.id !== id));
      setSelectedId(prev => prev === id ? (teams[0]?.id ?? null) : prev);
      return;
    }
    const res = await authFetch(`/api/agent-teams/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showSuccess('已删除');
      await loadAll();
      setSelectedId(null);
    }
  }

  async function handleToggle(id: string) {
    const team = teams.find(t => t.id === id);
    if (!team || (team as any)._isPreset) return;
    const res = await authFetch(`/api/agent-teams/${id}/toggle`, { method: 'POST' });
    if (res.ok) await loadAll();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Team List */}
      <div className="w-48 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-800">
        <div className="px-3 py-3 flex items-center justify-between border-b border-gray-200 dark:border-gray-700">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">团队</span>
          <button
            onClick={createNewTeam}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="新建团队"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {teams.map(team => (
            <button
              key={team.id}
              onClick={() => setSelectedId(team.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-gray-100 dark:border-gray-700/40 transition-colors ${
                selectedId === team.id
                  ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 border-l-blue-500'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 cursor-pointer ${
                    team.enabled && !(team as any)._isPreset
                      ? 'bg-green-500'
                      : (team as any)._isPreset
                        ? 'bg-amber-400'
                        : 'bg-gray-400'
                  }`}
                  title={team.enabled ? '点击禁用' : '点击启用'}
                  onClick={e => { e.stopPropagation(); handleToggle(team.id); }}
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                  {team.name}
                </span>
              </div>
              {team.triggerCommand && (
                <span className="ml-3.5 text-xs text-gray-400 font-mono">/{team.triggerCommand}</span>
              )}
              {(team as any)._isPreset && (
                <span className="ml-3.5 text-xs text-amber-500">示例</span>
              )}
            </button>
          ))}

          {teams.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6 px-3">
              暂无团队，点击 + 新建
            </p>
          )}
        </div>
      </div>

      {/* Right: Editor */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Toast messages */}
        {(error || successMsg) && (
          <div className={`absolute top-3 right-3 z-10 px-3 py-2 rounded-lg text-sm shadow-md ${
            error
              ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-700'
              : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-300 border border-green-200 dark:border-green-700'
          }`}>
            {error || successMsg}
          </div>
        )}

        {selectedTeam ? (
          <TeamEditor
            key={selectedTeam.id}
            team={selectedTeam}
            tools={tools}
            availableSkills={availableSkills}
            claudeModels={claudeModels}
            onSave={handleSave}
            onDelete={handleDelete}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <Users className="w-10 h-10 opacity-30" />
            <p className="text-sm">选择左侧团队或点击 + 新建</p>
          </div>
        )}
      </div>
    </div>
  );
}
