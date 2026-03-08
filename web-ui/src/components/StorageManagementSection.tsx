import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Edit,
  Trash2,
  TestTube,
  RefreshCw,
  HardDrive,
  Server,
  CheckCircle,
  AlertCircle,
  Loader2,
  Settings,
  X
} from 'lucide-react';
import { StorageProviderForm } from './StorageProviderForm';
import { authFetch } from '../utils/auth';

interface StorageProvider {
  id: string;
  name: string;
  type: 'local' | 'nas';
  connected: boolean;
  enabled: boolean;
  protocol?: 'webdav' | 'smb';
  // Local storage
  path?: string;
  // NAS storage
  url?: string;
  username?: string;
  hasPassword?: boolean;
  basePath?: string;
  timeout?: number;
}

interface CurrentProvider {
  id: string;
  name: string;
  type: 'local' | 'nas';
  connected: boolean;
}

export function StorageManagementSection() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [currentProvider, setCurrentProvider] = useState<CurrentProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<StorageProvider | null>(null);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  // 加载存储提供者列表
  const loadProviders = async () => {
    try {
      const response = await authFetch('/api/storage/providers');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setProviders(data);
    } catch (error) {
      console.error('Failed to load storage providers:', error);
      setError(error instanceof Error ? error.message : 'Failed to load storage providers');
    }
  };

  // 加载当前存储提供者
  const loadCurrentProvider = async () => {
    try {
      const response = await authFetch('/api/storage/current');
      if (response.ok) {
        const data = await response.json();
        setCurrentProvider(data);
      } else if (response.status === 404) {
        setCurrentProvider(null);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to load current provider:', error);
    }
  };

  // 初始化数据
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([loadProviders(), loadCurrentProvider()]);
      setLoading(false);
    };
    loadData();
  }, []);

  // 刷新数据
  const refreshData = async () => {
    setError(null);
    await Promise.all([loadProviders(), loadCurrentProvider()]);
  };

  // 获取存储类型图标
  const getStorageIcon = (type: 'local' | 'nas') => {
    switch (type) {
      case 'local':
        return <HardDrive className="w-5 h-5" />;
      case 'nas':
        return <Server className="w-5 h-5" />;
    }
  };

  // 添加提供者
  const handleAddProvider = () => {
    setFormMode('add');
    setEditingProvider(null);
    setIsFormOpen(true);
  };

  // 编辑提供者
  const handleEditProvider = async (provider: StorageProvider) => {
    setFormMode('edit');

    // 获取完整的 provider 配置（包含密码）
    try {
      const response = await authFetch(`/api/storage/providers/${provider.id}`);
      if (response.ok) {
        const fullProvider = await response.json();
        setEditingProvider(fullProvider);
      } else {
        // 如果获取失败，使用列表中的基本信息
        console.warn('Failed to load full provider config, using basic info');
        setEditingProvider(provider);
      }
    } catch (error) {
      console.error('Failed to load provider config:', error);
      setEditingProvider(provider);
    }

    setIsFormOpen(true);
  };

  // 删除提供者
  const handleDeleteProvider = async (id: string) => {
    if (!confirm(t('storage.deleteConfirm'))) {
      return;
    }

    setDeletingId(id);
    try {
      const response = await authFetch(`/api/storage/providers/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      await refreshData();
    } catch (error) {
      console.error('Failed to delete provider:', error);
      setError(error instanceof Error ? error.message : 'Failed to delete provider');
    } finally {
      setDeletingId(null);
    }
  };

  // 测试连接
  const handleTestConnection = async (id: string) => {
    setTestingId(id);
    try {
      const response = await authFetch(`/api/storage/test/${id}`, {
        method: 'POST',
      });

      const result = await response.json();

      if (result.success && result.connected) {
        await refreshData(); // 重新加载状态
      }
    } catch (error) {
      console.error('Failed to test connection:', error);
    } finally {
      setTestingId(null);
    }
  };

  // 表单提交
  const handleFormSubmit = async (providerData: Omit<StorageProvider, 'connected'>) => {
    try {
      const url = formMode === 'add'
        ? '/api/storage/providers'
        : `/api/storage/providers/${providerData.id}`;

      const method = formMode === 'add' ? 'POST' : 'PUT';

      const response = await authFetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      await refreshData();
      setIsFormOpen(false);
    } catch (error) {
      console.error('Failed to save provider:', error);
      throw error; // 让表单组件处理错误
    }
  };

  // 测试新提供者连接
  const handleTestNewProvider = async (providerData: Omit<StorageProvider, 'connected'>): Promise<{ success: boolean; connected: boolean; message: string }> => {
    try {
      const response = await authFetch('/api/storage/providers/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerData),
      });

      const result = await response.json();
      return result;
    } catch (error) {
      return {
        success: false,
        connected: false,
        message: error instanceof Error ? error.message : t('storage.testResult.failed')
      };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        <span className="text-gray-600 dark:text-gray-400">{t('storage.loading', 'Loading storage providers...')}</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* 头部 */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            {t('storage.title')}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t('storage.description')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refreshData}
            className="flex items-center gap-2 px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            {t('storage.refresh')}
          </button>
          <button
            onClick={handleAddProvider}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('storage.addStorage')}
          </button>
        </div>
      </div>

      {/* 错误显示 */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            <div className="text-sm text-red-800 dark:text-red-200">{error}</div>
            <button
              onClick={() => setError(null)}
              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 ml-auto"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 存储提供者列表 */}
      <div className="space-y-4">
        {providers.length === 0 ? (
          <div className="text-center py-8">
            <Settings className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              {t('storage.noProviders')}
            </h4>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {t('storage.noProvidersDesc')}
            </p>
            <button
              onClick={handleAddProvider}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('storage.addProvider')}
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {providers.map((provider) => {
              const isActive = currentProvider?.id === provider.id;
              const isDeleting = deletingId === provider.id;
              const isTesting = testingId === provider.id;

              return (
                <div
                  key={provider.id}
                  className={`border rounded-lg p-4 transition-colors ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {getStorageIcon(provider.type)}
                      <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                          <span>{provider.name}</span>
                          {isActive && (
                            <span className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-100 rounded">
                              {t('storage.active')}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {provider.type === 'local'
                            ? `${t('storage.localType')} • ${provider.path || provider.id}`
                            : `${t('storage.nasType')} • ${provider.protocol?.toUpperCase() ?? 'NAS'} • ${provider.url || provider.id}`
                          }
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {provider.connected ? (
                          <div title={t('storage.connected')}>
                            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                          </div>
                        ) : (
                          <div title={t('storage.disconnected')}>
                            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* 测试连接按钮 */}
                      {provider.type === 'nas' && (
                        <button
                          onClick={() => handleTestConnection(provider.id)}
                          disabled={isTesting || isDeleting}
                          className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
                          title={t('storage.testConnection')}
                        >
                          {isTesting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <TestTube className="w-4 h-4" />
                          )}
                        </button>
                      )}

                      {/* 编辑按钮 */}
                      <button
                        onClick={() => handleEditProvider(provider)}
                        disabled={isDeleting}
                        className="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-50"
                        title={t('storage.edit')}
                      >
                        <Edit className="w-4 h-4" />
                      </button>

                      {/* 删除按钮 */}
                      {(!isActive || providers.length > 1) && (
                        <button
                          onClick={() => handleDeleteProvider(provider.id)}
                          disabled={isDeleting}
                          className="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                          title={t('storage.delete')}
                        >
                          {isDeleting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 表单模态框 */}
      <StorageProviderForm
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleFormSubmit}
        onTest={handleTestNewProvider}
        editingProvider={editingProvider}
        mode={formMode}
      />
    </div>
  );
}
