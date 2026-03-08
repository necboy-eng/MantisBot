import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive, Server, CheckCircle, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { authFetch } from '../utils/auth';

interface StorageProvider {
  id: string;
  name: string;
  type: 'local' | 'nas';
  connected: boolean;
}

interface CurrentProvider {
  id: string;
  name: string;
  type: 'local' | 'nas';
  connected: boolean;
}

interface StorageSelectorProps {
  onStorageChanged?: (providerId: string, mountPath?: string) => void;
  className?: string;
}

export const StorageSelector: React.FC<StorageSelectorProps> = ({
  onStorageChanged,
  className = ""
}) => {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<StorageProvider[]>([]);
  const [currentProvider, setCurrentProvider] = useState<CurrentProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setError(error instanceof Error ? error.message : t('storage.testResult.failed'));
    }
  };

  // 加载当前存储提供者
  const loadCurrentProvider = async () => {
    try {
      const response = await authFetch('/api/storage/current');
      if (response.ok) {
        const data = await response.json();
        // __local__ 表示本地文件系统模式，currentProvider 保持 null
        if (data.id === '__local__') {
          setCurrentProvider(null);
        } else {
          setCurrentProvider(data);
        }
      } else if (response.status === 404) {
        setCurrentProvider(null);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to load current provider:', error);
    }
  };

  // 初始化加载数据
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);

      await Promise.all([
        loadProviders(),
        loadCurrentProvider()
      ]);

      setLoading(false);
    };

    loadData();
  }, []);

  // 切换存储提供者
  const switchProvider = async (providerId: string) => {
    setSwitching(providerId);
    setError(null);

    try {
      const response = await authFetch('/api/storage/switch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ providerId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const result = await response.json();
      console.log('[StorageSelector] switch result:', result);

      // 切换回本地文件系统
      if (result.currentProvider === '__local__') {
        setCurrentProvider(null);
      } else {
        // 更新当前提供者
        setCurrentProvider({
          id: result.currentProvider,
          name: providers.find(p => p.id === result.currentProvider)?.name || 'Unknown',
          type: providers.find(p => p.id === result.currentProvider)?.type || 'local',
          connected: result.connected
        });
      }

      // 通知父组件存储已切换，附带挂载路径
      const mountPath = result.localMountPath || undefined;
      onStorageChanged?.(providerId, mountPath);

      // 自动挂载成功时提示用户
      if (result.autoMounted && result.localMountPath) {
        console.info(`[StorageSelector] NAS auto-mounted to: ${result.localMountPath}`);
      }

      // 重新加载提供者状态
      await loadProviders();

    } catch (error) {
      console.error('Failed to switch storage:', error);
      setError(error instanceof Error ? error.message : t('storage.testResult.failed'));
    } finally {
      setSwitching(null);
    }
  };

  // 测试连接
  const testConnection = async (providerId: string) => {
    try {
      const response = await authFetch(`/api/storage/test/${providerId}`, {
        method: 'POST',
      });

      const result = await response.json();

      if (result.connected) {
        // 重新加载提供者状态（connected 已更新）
        await loadProviders();
      } else {
        setError(result.message || result.hint || t('storage.testResult.failed'));
      }
    } catch (error) {
      console.error('Failed to test connection:', error);
      setError(error instanceof Error ? error.message : t('storage.testResult.failed'));
    }
  };

  // 刷新数据
  const refresh = async () => {
    setLoading(true);
    setError(null);
    await Promise.all([
      loadProviders(),
      loadCurrentProvider()
    ]);
    setLoading(false);
  };

  // 获取存储类型图标
  const getStorageIcon = (type: 'local' | 'nas') => {
    switch (type) {
      case 'local':
        return <HardDrive className="w-4 h-4" />;
      case 'nas':
        return <Server className="w-4 h-4" />;
      default:
        return <HardDrive className="w-4 h-4" />;
    }
  };

  // 获取存储类型翻译标签
  const getStorageTypeLabel = (type: 'local' | 'nas') => {
    return type === 'nas' ? t('storage.nasType') : t('storage.localType');
  };

  if (loading) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <Loader2 className="w-4 h-4 animate-spin text-gray-500 dark:text-gray-400" />
        <span className="text-sm text-gray-600 dark:text-gray-400">{t('storage.loading')}</span>
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <HardDrive className="w-4 h-4 text-gray-400 dark:text-gray-500" />
        <span className="text-sm text-gray-600 dark:text-gray-400">{t('storage.noProviders')}</span>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* 当前存储状态 */}
      {currentProvider && (
        <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-md">
          <div className="flex items-center space-x-2">
            {getStorageIcon(currentProvider.type)}
            <span className="text-sm font-medium text-blue-900 dark:text-blue-300">{currentProvider.name}</span>
            {currentProvider.connected ? (
              <CheckCircle className="w-4 h-4 text-green-500 dark:text-green-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
            )}
          </div>
          <span className="text-xs text-blue-600 dark:text-blue-400">{t('storage.currentlyActive')}</span>
        </div>
      )}

      {/* 错误显示 */}
      {error && (
        <div className="p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-md">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
            <span className="text-sm text-red-800 dark:text-red-300">{error}</span>
          </div>
        </div>
      )}

      {/* 存储提供者列表 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('storage.title')}</h4>
          <button
            onClick={refresh}
            disabled={loading}
            className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title={t('storage.refresh')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1">
          {/* 本地文件系统固定条目 */}
          {(() => {
            const isActive = currentProvider === null;
            const isSwitching = switching === '__local__';
            return (
              <div
                className={`
                  flex items-center justify-between p-2 border rounded-md transition-colors
                  ${isActive
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }
                `}
              >
                <div className="flex items-center space-x-3">
                  <HardDrive className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {t('storage.localType')} Filesystem
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t('storage.localType')} Storage
                    </div>
                  </div>
                  <CheckCircle className="w-4 h-4 text-green-500 dark:text-green-400" />
                </div>
                <div className="flex items-center space-x-2">
                  {!isActive && (
                    <button
                      onClick={() => switchProvider('__local__')}
                      disabled={isSwitching}
                      className="px-3 py-1 text-xs rounded transition-colors text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50"
                    >
                      {isSwitching ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        t('storage.switch')
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {providers.map((provider) => {
            const isActive = currentProvider?.id === provider.id;
            const isSwitching = switching === provider.id;

            return (
              <div
                key={provider.id}
                className={`
                  flex items-center justify-between p-2 border rounded-md transition-colors
                  ${isActive
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }
                `}
              >
                <div className="flex items-center space-x-3">
                  {getStorageIcon(provider.type)}
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {provider.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {getStorageTypeLabel(provider.type)} Storage
                    </div>
                  </div>
                  <div className="flex items-center space-x-1">
                    {provider.connected ? (
                      <CheckCircle className="w-4 h-4 text-green-500 dark:text-green-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {/* 测试连接按钮 */}
                  {provider.type === 'nas' && (
                    <button
                      onClick={() => testConnection(provider.id)}
                      disabled={isSwitching}
                      className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                      title={t('storage.testConnection')}
                    >
                      {t('storage.testConnection')}
                    </button>
                  )}

                  {/* 切换按钮 */}
                  {!isActive && (
                    <button
                      onClick={() => switchProvider(provider.id)}
                      disabled={isSwitching || !provider.connected}
                      className={`
                        px-3 py-1 text-xs rounded transition-colors
                        ${provider.connected
                          ? 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                          : 'text-gray-400 dark:text-gray-600 bg-gray-100 dark:bg-gray-800 cursor-not-allowed'
                        }
                      `}
                    >
                      {isSwitching ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        t('storage.switch')
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
