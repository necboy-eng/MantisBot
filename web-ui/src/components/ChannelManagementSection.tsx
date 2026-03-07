import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChannelFormModal } from './ChannelFormModal';
import { authFetch } from '../utils/auth';
import { cachedFetch, invalidateCache } from '../utils/configCache';

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

interface ChannelManagementSectionProps {
  isOpen?: boolean;
}

export function ChannelManagementSection({ isOpen }: ChannelManagementSectionProps) {
  const { t, i18n } = useTranslation();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [definitions, setDefinitions] = useState<ChannelDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isZh = i18n.language === 'zh-CN';

  useEffect(() => {
    if (isOpen) {
      fetchChannels();
      fetchDefinitions();
    }
  }, [isOpen]);

  async function fetchChannels() {
    try {
      const data = await cachedFetch('/api/channels', async () => {
        const res = await authFetch('/api/channels');
        return res.json();
      }) as { channels: Channel[] };
      setChannels(data.channels);
    } catch (err) {
      console.error('Failed to fetch channels:', err);
    }
  }

  async function fetchDefinitions() {
    try {
      const data = await cachedFetch('/api/channels/definitions', async () => {
        const res = await authFetch('/api/channels/definitions');
        return res.json();
      }) as { definitions: ChannelDefinition[] };
      setDefinitions(data.definitions);
    } catch (err) {
      console.error('Failed to fetch definitions:', err);
    }
  }

  async function toggleChannel(id: string, enabled: boolean) {
    setLoading(true);
    try {
      await authFetch(`/api/channels/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      setChannels(prev => prev.map(c => c.id === id ? { ...c, enabled } : c));
    } catch (err) {
      console.error('Failed to toggle channel:', err);
    } finally {
      setLoading(false);
    }
  }

  async function testConnection(id: string) {
    setTestingId(id);
    // 测试中时不显示结果，避免先显示红色失败提示
    setTestResults(prev => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });

    try {
      const res = await authFetch(`/api/channels/${id}/test`, { method: 'POST' });
      const data = await res.json();

      setTestResults(prev => ({
        ...prev,
        [id]: {
          success: data.success,
          message: data.message,
        },
      }));
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [id]: {
          success: false,
          message: err.message,
        },
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function deleteChannel(id: string) {
    if (!confirm(t('channelManagement.deleteChannelConfirm'))) return;

    setLoading(true);
    try {
      await authFetch(`/api/channels/${id}`, { method: 'DELETE' });
      invalidateCache('/api/channels');
      setChannels(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      console.error('Failed to delete channel:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(channel: Channel) {
    setEditingChannel(channel);
    setIsModalOpen(true);
  }

  function handleAdd() {
    setEditingChannel(null);
    setIsModalOpen(true);
  }

  async function handleSave(data: { id: string; enabled: boolean; config: Record<string, any> }) {
    setLoading(true);
    try {
      await authFetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      invalidateCache('/api/channels');
      await fetchChannels();
      setIsModalOpen(false);
    } catch (err) {
      console.error('Failed to save channel:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('settings.channelManagement')}
        </h3>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
        >
          {t('channelManagement.addChannel')}
        </button>
      </div>

      {/* Channel List */}
      <div className="grid gap-4">
        {channels.map(channel => (
          <div
            key={channel.id}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
          >
            <div className="flex items-center justify-between">
              {/* Channel Info */}
              <div className="flex items-center gap-4">
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl"
                  style={{ backgroundColor: `${channel.color}20` }}
                >
                  {channel.icon}
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-gray-100">
                    {isZh ? channel.nameZh : channel.name}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {channel.enabled ? t('channelManagement.channelStatus.connected') : t('channelManagement.channelStatus.disconnected')}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {/* Test Connection */}
                <button
                  onClick={() => testConnection(channel.id)}
                  disabled={testingId === channel.id}
                  className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  {testingId === channel.id ? t('channelManagement.testing') : t('channelManagement.testConnection')}
                </button>

                {/* Edit */}
                <button
                  onClick={() => handleEdit(channel)}
                  className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  {t('channelManagement.editChannel')}
                </button>

                {/* Delete */}
                {channel.id !== 'httpWs' && (
                  <button
                    onClick={() => deleteChannel(channel.id)}
                    disabled={loading}
                    className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded hover:bg-red-100 dark:hover:bg-red-900/40"
                  >
                    {t('channelManagement.delete')}
                  </button>
                )}

                {/* Toggle */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={channel.enabled}
                    onChange={(e) => toggleChannel(channel.id, e.target.checked)}
                    disabled={loading}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-primary-600"></div>
                </label>
              </div>
            </div>

            {/* Test Result */}
            {testResults[channel.id] && (
              <div className={`mt-3 p-2 rounded text-sm ${
                testResults[channel.id].success
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
              }`}>
                {testResults[channel.id].success ? t('channelManagement.connectionSuccess') : t('channelManagement.connectionFailed')}: {testResults[channel.id].message}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Form Modal */}
      <ChannelFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        channel={editingChannel}
        definitions={definitions}
        onSave={handleSave}
        loading={loading}
      />
    </div>
  );
}
