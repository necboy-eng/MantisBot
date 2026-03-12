import { useState, useEffect } from 'react';
import { X, Play, Pause, Trash2, Plus, Clock, RefreshCw, CheckCircle, AlertCircle, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authFetch } from '../utils/auth';

interface CronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  schedule: {
    kind: 'at' | 'every' | 'cron';
    at?: string;
    everyMs?: number;
    expr?: string;
    tz?: string;
  };
  payload: {
    kind: 'systemEvent' | 'agentTurn';
    text?: string;
    message?: string;
    model?: string;
    skills?: string[];
  };
  delivery?: {
    mode: 'none' | 'announce';
    channel?: string;
    to?: string;
  };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: 'ok' | 'error' | 'skipped';
    lastError?: string;
  };
}

interface CronPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const defaultFormData = {
  name: '',
  description: '',
  scheduleKind: 'cron' as 'at' | 'every' | 'cron',
  scheduleAt: '',
  everyAmount: 1,
  everyUnit: 'hours' as 'minutes' | 'hours' | 'days',
  cronExpr: '0 9 * * *',
  cronTz: 'Asia/Shanghai',
  payloadKind: 'agentTurn' as 'systemEvent' | 'agentTurn',
  payloadText: '',
  model: '',          // 空 = 使用系统默认模型
  skills: [] as string[],
  enabled: true,
  deliveryChannel: 'last' as string  // 投递渠道：last/web/feishu/wecom/dingtalk 等
};

export function CronPanel({ isOpen, onClose }: CronPanelProps) {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [runFeedback, setRunFeedback] = useState<{ id: string; success: boolean } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [formData, setFormData] = useState(defaultFormData);
  const [availableModels, setAvailableModels] = useState<{ name: string }[]>([]);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string }[]>([]);

  // 可用的投递渠道选项（使用国际化）
  const deliveryChannelOptions = [
    { value: 'last', label: t('cron.deliveryChannelLast') },
    { value: 'web', label: t('cron.deliveryChannelWeb') },
    { value: 'feishu', label: t('cron.deliveryChannelFeishu') },
    { value: 'wecom', label: t('cron.deliveryChannelWecom') },
    { value: 'dingtalk', label: t('cron.deliveryChannelDingtalk') },
    { value: 'slack', label: t('cron.deliveryChannelSlack') },
    { value: 'whatsapp', label: t('cron.deliveryChannelWhatsapp') },
    { value: 'wechat', label: t('cron.deliveryChannelWechat') },
  ];

  useEffect(() => {
    if (isOpen) {
      loadJobs();
      loadModelsAndSkills();
    }
  }, [isOpen]);

  async function loadJobs() {
    setLoading(true);
    try {
      const res = await authFetch('/api/cron/list?includeDisabled=true');
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Failed to load jobs:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadModelsAndSkills() {
    try {
      const [modelsRes, skillsRes] = await Promise.all([
        authFetch('/api/models'),
        authFetch('/api/skills'),
      ]);
      const modelsData = await modelsRes.json();
      const skillsData = await skillsRes.json();
      // 只保留启用的模型
      const enabledModels = (modelsData.models || []).filter((m: { enabled?: boolean }) => m.enabled !== false);
      setAvailableModels(enabledModels);
      setAvailableSkills(skillsData.skills || []);
    } catch (err) {
      console.error('Failed to load models/skills:', err);
    }
  }

  async function toggleJob(job: CronJob) {
    try {
      await authFetch('/api/cron/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, patch: { enabled: !job.enabled } })
      });
      await loadJobs();
    } catch (err) {
      console.error('Failed to toggle job:', err);
    }
  }

  async function runJob(job: CronJob) {
    setRunningJobId(job.id);
    setRunFeedback(null);
    try {
      const res = await authFetch('/api/cron/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id })
      });
      setRunFeedback({ id: job.id, success: res.ok });
      setTimeout(() => setRunFeedback(null), 2000);
      await loadJobs();
    } catch (err) {
      console.error('Failed to run job:', err);
      setRunFeedback({ id: job.id, success: false });
      setTimeout(() => setRunFeedback(null), 2000);
    } finally {
      setRunningJobId(null);
    }
  }

  async function removeJob(job: CronJob) {
    if (!confirm(t('cron.confirmDelete', { name: job.name }))) return;
    try {
      await authFetch('/api/cron/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id })
      });
      await loadJobs();
    } catch (err) {
      console.error('Failed to remove job:', err);
    }
  }

  function openEditForm(job: CronJob) {
    setEditingJob(job);
    let scheduleKind = job.schedule.kind;
    let everyAmount = 1;
    let everyUnit: 'minutes' | 'hours' | 'days' = 'hours';
    if (scheduleKind === 'every' && job.schedule.everyMs) {
      if (job.schedule.everyMs % 86400000 === 0) { everyAmount = job.schedule.everyMs / 86400000; everyUnit = 'days'; }
      else if (job.schedule.everyMs % 3600000 === 0) { everyAmount = job.schedule.everyMs / 3600000; everyUnit = 'hours'; }
      else { everyAmount = job.schedule.everyMs / 60000; everyUnit = 'minutes'; }
    }
    setFormData({
      name: job.name,
      description: job.description || '',
      scheduleKind,
      scheduleAt: job.schedule.at ? new Date(job.schedule.at).toISOString().slice(0, 16) : '',
      everyAmount,
      everyUnit,
      cronExpr: job.schedule.expr || '0 9 * * *',
      cronTz: job.schedule.tz || 'Asia/Shanghai',
      payloadKind: job.payload.kind,
      payloadText: job.payload.text || job.payload.message || '',
      model: job.payload.model || '',
      skills: job.payload.skills || [],
      enabled: job.enabled,
      deliveryChannel: job.delivery?.channel || 'last'
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingJob(null);
    setFormData(defaultFormData);
  }

  function toggleSkill(skillName: string) {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skillName)
        ? prev.skills.filter(s => s !== skillName)
        : [...prev.skills, skillName]
    }));
  }

  async function submitJob(e: React.FormEvent) {
    e.preventDefault();

    let schedule: any;
    if (formData.scheduleKind === 'at') {
      schedule = { kind: 'at', at: new Date(formData.scheduleAt).toISOString() };
    } else if (formData.scheduleKind === 'every') {
      const mult = formData.everyUnit === 'minutes' ? 60000 : formData.everyUnit === 'hours' ? 3600000 : 86400000;
      schedule = { kind: 'every', everyMs: formData.everyAmount * mult };
    } else {
      schedule = { kind: 'cron', expr: formData.cronExpr, tz: formData.cronTz };
    }

    const payload = formData.payloadKind === 'systemEvent'
      ? { kind: 'systemEvent', text: formData.payloadText }
      : {
          kind: 'agentTurn',
          message: formData.payloadText,
          ...(formData.model ? { model: formData.model } : {}),
          skills: formData.skills,
        };

    try {
      if (editingJob) {
        await authFetch('/api/cron/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingJob.id,
            patch: {
              name: formData.name,
              description: formData.description,
              enabled: formData.enabled,
              schedule,
              payload,
              delivery: { mode: 'announce', channel: formData.deliveryChannel }
            }
          })
        });
      } else {
        await authFetch('/api/cron/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            description: formData.description,
            enabled: formData.enabled,
            schedule,
            sessionTarget: 'isolated',
            wakeMode: 'now',
            payload,
            delivery: { mode: 'announce', channel: formData.deliveryChannel }
          })
        });
      }
      closeForm();
      await loadJobs();
    } catch (err) {
      console.error('Failed to save job:', err);
    }
  }

  function formatNextRun(ms?: number) {
    if (!ms) return '-';
    return new Date(ms).toLocaleString();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold">{t('cron.title')}</h2>
          <div className="flex items-center gap-2">
            <button onClick={loadJobs} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
              <RefreshCw className="w-5 h-5" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-500">{t('cron.loading')}</div>
          ) : (
            <div className="space-y-4">
              {/* Job List */}
              {jobs.map(job => (
                <div key={job.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium">{job.name}</h3>
                        <span className={`text-xs px-2 py-1 rounded ${
                          job.enabled
                            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                          {job.enabled ? t('cron.enabled') : t('cron.disabled')}
                        </span>
                        {job.state.lastStatus && (
                          <span className={`text-xs px-2 py-1 rounded ${
                            job.state.lastStatus === 'ok'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                              : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                          }`}>
                            {job.state.lastStatus}
                          </span>
                        )}
                        {/* 模型标签 */}
                        {job.payload.kind === 'agentTurn' && job.payload.model && (
                          <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                            {job.payload.model}
                          </span>
                        )}
                        {/* skills 标签 */}
                        {job.payload.kind === 'agentTurn' && job.payload.skills && job.payload.skills.length > 0 && (
                          <span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                            {job.payload.skills.length} {t('cron.skillsCount', { count: job.payload.skills.length }).replace(/^\d+ /, '')}
                          </span>
                        )}
                      </div>
                      {job.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{job.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          <span>{t('cron.nextRun', { time: formatNextRun(job.state.nextRunAtMs) })}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => runJob(job)}
                        disabled={runningJobId === job.id}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50"
                        title={t('cron.runNow')}
                      >
                        {runningJobId === job.id ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : runFeedback?.id === job.id ? (
                          runFeedback.success
                            ? <CheckCircle className="w-4 h-4 text-green-500" />
                            : <AlertCircle className="w-4 h-4 text-red-500" />
                        ) : (
                          <Play className="w-4 h-4 text-green-600" />
                        )}
                      </button>
                      <button
                        onClick={() => openEditForm(job)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title={t('cron.edit')}
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleJob(job)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
                        title={job.enabled ? t('cron.disable') : t('cron.enable')}
                      >
                        {job.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => removeJob(job)}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-red-500"
                        title={t('cron.delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {/* Create Button */}
              {!showForm && (
                <button
                  onClick={() => setShowForm(true)}
                  className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg flex items-center justify-center gap-2 hover:border-primary-500 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  {t('cron.createNew')}
                </button>
              )}

              {/* Create / Edit Form */}
              {showForm && (
                <form onSubmit={submitJob} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
                  <h3 className="font-medium">{editingJob ? t('cron.editTitle') : t('cron.createTitle')}</h3>

                  <div>
                    <label className="block text-sm font-medium mb-1">{t('cron.fieldName')}</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">{t('cron.fieldDesc')}</label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={e => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">{t('cron.fieldSchedule')}</label>
                    <select
                      value={formData.scheduleKind}
                      onChange={e => setFormData({ ...formData, scheduleKind: e.target.value as any })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                    >
                      <option value="cron">{t('cron.scheduleKindCron')}</option>
                      <option value="every">{t('cron.scheduleKindEvery')}</option>
                      <option value="at">{t('cron.scheduleKindAt')}</option>
                    </select>
                  </div>

                  {formData.scheduleKind === 'cron' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium mb-1">{t('cron.fieldCronExpr')}</label>
                        <input
                          type="text"
                          value={formData.cronExpr}
                          onChange={e => setFormData({ ...formData, cronExpr: e.target.value })}
                          placeholder="0 9 * * *"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">{t('cron.fieldTimezone')}</label>
                        <input
                          type="text"
                          value={formData.cronTz}
                          onChange={e => setFormData({ ...formData, cronTz: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                        />
                      </div>
                    </>
                  )}

                  {formData.scheduleKind === 'every' && (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-sm font-medium mb-1">{t('cron.fieldInterval')}</label>
                        <input
                          type="number"
                          value={formData.everyAmount}
                          onChange={e => setFormData({ ...formData, everyAmount: parseInt(e.target.value) })}
                          min="1"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-sm font-medium mb-1">{t('cron.fieldUnit')}</label>
                        <select
                          value={formData.everyUnit}
                          onChange={e => setFormData({ ...formData, everyUnit: e.target.value as any })}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                        >
                          <option value="minutes">{t('cron.unitMinutes')}</option>
                          <option value="hours">{t('cron.unitHours')}</option>
                          <option value="days">{t('cron.unitDays')}</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {formData.scheduleKind === 'at' && (
                    <div>
                      <label className="block text-sm font-medium mb-1">{t('cron.fieldRunAt')}</label>
                      <input
                        type="datetime-local"
                        value={formData.scheduleAt}
                        onChange={e => setFormData({ ...formData, scheduleAt: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium mb-1">{t('cron.fieldTaskType')}</label>
                    <select
                      value={formData.payloadKind}
                      onChange={e => setFormData({ ...formData, payloadKind: e.target.value as any })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                    >
                      <option value="agentTurn">{t('cron.taskTypeAgent')}</option>
                      <option value="systemEvent">{t('cron.taskTypeNotify')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      {formData.payloadKind === 'agentTurn' ? t('cron.fieldContent') : t('cron.fieldNotifyContent')}
                    </label>
                    <textarea
                      value={formData.payloadText}
                      onChange={e => setFormData({ ...formData, payloadText: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                      required
                    />
                  </div>

                  {/* 模型选择（仅 Agent 消息） */}
                  {formData.payloadKind === 'agentTurn' && (
                    <div>
                      <label className="block text-sm font-medium mb-1">{t('cron.fieldModel')}</label>
                      <select
                        value={formData.model}
                        onChange={e => setFormData({ ...formData, model: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                      >
                        <option value="">{t('cron.defaultModel')}</option>
                        {availableModels.map(m => (
                          <option key={m.name} value={m.name}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Skills 多选（仅 Agent 消息） */}
                  {formData.payloadKind === 'agentTurn' && availableSkills.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        {t('cron.fieldSkills')}
                        <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                          {t('cron.fieldSkillsHint')}
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 border border-gray-200 dark:border-gray-700 rounded-lg">
                        {availableSkills.map(skill => (
                          <button
                            key={skill.name}
                            type="button"
                            onClick={() => toggleSkill(skill.name)}
                            title={skill.description}
                            className={`px-2 py-1 rounded text-xs transition-colors ${
                              formData.skills.includes(skill.name)
                                ? 'bg-primary-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                            }`}
                          >
                            {skill.name}
                          </button>
                        ))}
                      </div>
                      {formData.skills.length > 0 && (
                        <p className="mt-1 text-xs text-gray-500">{t('cron.selectedSkills', { count: formData.skills.length })}</p>
                      )}
                    </div>
                  )}

                  {/* 投递渠道选择 */}
                  <div>
                    <label className="block text-sm font-medium mb-1">{t('cron.fieldDeliveryChannel') || '投递渠道'}</label>
                    <select
                      value={formData.deliveryChannel}
                      onChange={e => setFormData({ ...formData, deliveryChannel: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                    >
                      {deliveryChannelOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.enabled}
                      onChange={e => setFormData({ ...formData, enabled: e.target.checked })}
                      id="enabled"
                    />
                    <label htmlFor="enabled" className="text-sm">{t('cron.fieldEnabled')}</label>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                    >
                      {editingJob ? t('cron.saveEdit') : t('cron.saveCreate')}
                    </button>
                    <button
                      type="button"
                      onClick={closeForm}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      {t('cron.cancel')}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
