import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { authFetch } from '../utils/auth';

interface ChannelField {
  key: string;
  type: 'text' | 'password' | 'textarea' | 'url' | 'boolean';
  label: string;
  labelZh: string;
  required: boolean;
  placeholder?: string;
  placeholderZh?: string;
}

interface ChannelDefinition {
  id: string;
  name: string;
  nameZh: string;
  icon: string;
  color: string;
  fields: ChannelField[];
}

interface Channel {
  id: string;
  name: string;
  nameZh: string;
  icon: string;
  color: string;
  enabled: boolean;
  config: Record<string, any>;
}

interface ChannelFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  channel: Channel | null;
  definitions: ChannelDefinition[];
  onSave: (data: { id: string; enabled: boolean; config: Record<string, any> }) => void;
  loading: boolean;
}

export function ChannelFormModal({
  isOpen,
  onClose,
  channel,
  definitions,
  onSave,
  loading,
}: ChannelFormModalProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language === 'zh-CN';

  // 判断是否是飞书实例条目（id 形如 'feishu:xxx'）
  const isFeishuInstance = channel?.id?.startsWith('feishu:');
  const existingInstanceId = isFeishuInstance ? channel!.id.slice('feishu:'.length) : '';

  const [selectedId, setSelectedId] = useState(isFeishuInstance ? 'feishu' : (channel?.id || ''));
  const [instanceId, setInstanceId] = useState(existingInstanceId);
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [config, setConfig] = useState<Record<string, any>>(channel?.config || {});

  // 飞书专属字段状态
  const [profiles, setProfiles] = useState<string[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (channel) {
      const feishuInst = channel.id?.startsWith('feishu:');
      setSelectedId(feishuInst ? 'feishu' : channel.id);
      setInstanceId(feishuInst ? channel.id.slice('feishu:'.length) : '');
      setEnabled(channel.enabled);
      setConfig(channel.config);
    } else {
      setSelectedId('');
      setInstanceId('');
      setEnabled(true);
      setConfig({});
    }
  }, [channel, isOpen, definitions]);

  // 飞书选中时拉取 profiles 和 teams
  useEffect(() => {
    const isFeishu = selectedId === 'feishu';
    if (!isFeishu || !isOpen) return;

    authFetch('/api/profiles')
      .then(r => r.json())
      .then((data: any) => setProfiles((data.profiles || []).map((p: any) => p.name || p)))
      .catch(() => setProfiles([]));

    authFetch('/api/agent-teams')
      .then(r => r.json())
      .then((data: any) => setTeams((data.teams || []).filter((t: any) => t.enabled !== false).map((t: any) => ({ id: t.id, name: t.name }))))
      .catch(() => setTeams([]));
  }, [selectedId, isOpen]);

  const currentDef = definitions.find(d => d.id === selectedId);
  const isFeishu = selectedId === 'feishu';

  // 如果 definitions 还没加载，但有 channel 数据，直接从 channel 构造字段
  const fields = currentDef?.fields || (channel?.config ? Object.keys(channel.config).map(key => ({
    key,
    type: 'text' as const,
    label: key,
    labelZh: key,
    required: false,
  })) : []);

  // 飞书时过滤掉 instanceId / profile / team / workingDirectory（在上方单独显示）
  const feishuManagedKeys = new Set(['instanceId', 'profile', 'team', 'workingDirectory']);
  const visibleFields = isFeishu
    ? fields.filter(f => !feishuManagedKeys.has(f.key))
    : fields;

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    if (isFeishu && !instanceId.trim()) return;

    // 飞书：用 'feishu:xxx' 作为 id 传给后端
    const submitId = isFeishu
      ? (existingInstanceId ? `feishu:${existingInstanceId}` : 'feishu')
      : selectedId;

    onSave({
      id: submitId,
      enabled,
      config: isFeishu ? { ...config, instanceId: instanceId.trim() } : config,
    });
  };

  const inputClass = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50';
  const selectClass = `${inputClass} cursor-pointer`;
  const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
  const hintClass = 'mt-1 text-xs text-gray-500 dark:text-gray-400';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {channel ? t('channelManagement.editChannel') : t('channelManagement.addChannel')}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Channel Type Selection */}
          <div>
            <label className={labelClass}>
              {t('channelManagement.channelForm.selectChannel')}
            </label>
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setInstanceId('');
                setConfig({});
              }}
              disabled={!!channel}
              className={selectClass}
            >
              <option value="">{t('channelManagement.channelForm.selectChannel')}</option>
              {definitions.map(def => (
                <option key={def.id} value={def.id}>
                  {def.icon} {isZh ? def.nameZh : def.name}
                </option>
              ))}
            </select>
          </div>

          {/* 飞书专属字段区域 */}
          {isFeishu && (
            <>
              {/* 实例 ID */}
              <div>
                <label className={labelClass}>
                  {t('channelManagement.feishu.instanceId')}
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <input
                  type="text"
                  value={instanceId}
                  onChange={(e) => setInstanceId(e.target.value)}
                  disabled={!!existingInstanceId}
                  placeholder={t('channelManagement.feishu.instanceIdPlaceholder')}
                  className={inputClass}
                />
                <p className={hintClass}>
                  {t('channelManagement.feishu.instanceIdHint')}
                </p>
              </div>

              {/* Agent 人格 */}
              <div>
                <label className={labelClass}>
                  {t('channelManagement.feishu.agentProfile')}
                </label>
                <select
                  value={config.profile || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, profile: e.target.value || undefined }))}
                  className={selectClass}
                >
                  <option value="">{t('channelManagement.feishu.defaultProfile')}</option>
                  {profiles.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <p className={hintClass}>
                  {t('channelManagement.feishu.agentProfileHint')}
                </p>
              </div>

              {/* Agent Team */}
              <div>
                <label className={labelClass}>
                  {t('channelManagement.feishu.agentTeam')}
                </label>
                <select
                  value={config.team || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, team: e.target.value || undefined }))}
                  className={selectClass}
                >
                  <option value="">{t('channelManagement.feishu.noTeam')}</option>
                  {teams.map(tm => (
                    <option key={tm.id} value={tm.id}>{tm.name}</option>
                  ))}
                </select>
                <p className={hintClass}>
                  {t('channelManagement.feishu.agentTeamHint')}
                </p>
              </div>

              {/* 工作目录 */}
              <div>
                <label className={labelClass}>
                  {t('channelManagement.feishu.workingDirectory')}
                </label>
                <input
                  type="text"
                  value={config.workingDirectory || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, workingDirectory: e.target.value || undefined }))}
                  placeholder={t('channelManagement.feishu.workingDirectoryPlaceholder')}
                  className={inputClass}
                />
                <p className={hintClass}>
                  {t('channelManagement.feishu.workingDirectoryHint')}
                </p>
              </div>
            </>
          )}

          {/* Enabled Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
            />
            <label htmlFor="enabled" className="text-sm text-gray-700 dark:text-gray-300">
              {t('channelManagement.channelForm.enabled')}
            </label>
          </div>

          {/* Config Fields（通用字段，飞书已管理的 key 已过滤） */}
          {visibleFields.length > 0 && (
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('channelManagement.channelForm.config')}
              </h4>
              {visibleFields
                .filter(f => f.key !== 'enabled')
                .map(field => (
                  <div key={field.key}>
                    <label className={labelClass}>
                      {isZh ? field.labelZh : field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {field.type === 'boolean' ? (
                      <input
                        type="checkbox"
                        checked={config[field.key] ?? false}
                        onChange={(e) => setConfig(prev => ({ ...prev, [field.key]: e.target.checked }))}
                        className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                      />
                    ) : (
                      <input
                        type={field.type}
                        value={config[field.key] || ''}
                        onChange={(e) => setConfig(prev => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={isZh ? (field as any).placeholderZh : (field as any).placeholder}
                        className={inputClass}
                      />
                    )}
                  </div>
                ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              {t('channelManagement.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !selectedId || (isFeishu && !instanceId.trim())}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {t('channelManagement.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
