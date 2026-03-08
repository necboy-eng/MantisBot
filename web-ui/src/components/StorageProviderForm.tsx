import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Eye, EyeOff, TestTube, Save, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

interface StorageProvider {
  id: string;
  name: string;
  type: 'local' | 'nas';
  enabled: boolean;
  // Local storage
  path?: string;
  // NAS storage
  url?: string;
  username?: string;
  password?: string;
  protocol?: 'webdav' | 'smb';
  basePath?: string;
  timeout?: number;
  // SMB 专属字段
  domain?: string;  // Windows AD 域（可选，格式：DOMAIN）
  share?: string;   // SMB 共享名（从 URL 中解析，也可单独填写）
  // 本地挂载路径（可选）
  localMountPath?: string;
}

interface StorageProviderFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (provider: Omit<StorageProvider, 'connected'>) => Promise<void>;
  onTest?: (provider: StorageProvider) => Promise<{ success: boolean; connected: boolean; message: string }>;
  editingProvider?: (StorageProvider & { connected?: boolean }) | null;
  mode: 'add' | 'edit';
}

interface ValidationErrors {
  id?: string;
  name?: string;
  type?: string;
  path?: string;
  url?: string;
  username?: string;
  password?: string;
  protocol?: string;
  basePath?: string;
  timeout?: string;
  domain?: string;
}

export function StorageProviderForm({
  isOpen,
  onClose,
  onSubmit,
  onTest,
  editingProvider,
  mode
}: StorageProviderFormProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<StorageProvider>({
    id: '',
    name: '',
    type: 'local',  // 默认使用local而不是nas，避免在添加本地存储时包含��NAS字段
    enabled: true,
    url: '',
    username: '',
    password: '',
    protocol: 'smb',  // 默认使用 SMB 协议
    timeout: 30000
  });

  const [errors, setErrors] = useState<ValidationErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; connected: boolean; message: string } | null>(null);

  // 初始化表单数据
  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && editingProvider) {
        setFormData({
          ...editingProvider,
          password: editingProvider.password || '' // 编辑时密码为空，需要重新输入
        });
        setShowPassword(false);
      } else {
        // 添加模式，重置表单
        setFormData({
          id: '',
          name: '',
          type: 'nas',
          enabled: true,
          url: '',
          username: '',
          password: '',
          protocol: 'smb',  // NAS 类型默认使用 SMB 协议
          timeout: 30000
        });
      }
      setErrors({});
      setTestResult(null);
    }
  }, [isOpen, mode, editingProvider]);

  // 表单字段更新
  const updateField = (field: keyof StorageProvider, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // 清除对应字段的错误（只清除存在的字段）
    if (field in errors) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  // 表单验证
  const validateForm = (): boolean => {
    const newErrors: ValidationErrors = {};

    // ID验证（仅添加模式）
    if (mode === 'add') {
      if (!formData.id.trim()) {
        newErrors.id = t('storage.validation.idRequired');
      } else if (!/^[a-zA-Z0-9-_]+$/.test(formData.id)) {
        newErrors.id = t('storage.validation.idFormat');
      }
    }

    // 名称验证
    if (!formData.name.trim()) {
      newErrors.name = t('storage.validation.nameRequired');
    }

    // 类型特定验证
    if (formData.type === 'local') {
      if (!formData.path?.trim()) {
        newErrors.path = t('storage.validation.pathRequired');
      }
    } else if (formData.type === 'nas') {
      if (!formData.url || !formData.url.trim()) {
        newErrors.url = t('storage.validation.urlRequired');
      } else if (formData.protocol === 'smb') {
        // SMB 格式: smb://host/share 或 //host/share（必须包含 share 名）
        let smbUrl = formData.url.trim();
        if (!smbUrl.includes('://')) smbUrl = 'smb:' + smbUrl;
        try {
          const parsed = new URL(smbUrl);
          const shareParts = parsed.pathname.split('/').filter(Boolean);
          if (shareParts.length === 0) {
            newErrors.url = t('storage.validation.smbShareRequired', '请填写共享名，格式：smb://192.168.1.100/共享名');
          }
        } catch {
          newErrors.url = t('storage.validation.urlInvalid');
        }
      } else {
        // WebDAV 协议需要有效的 HTTP URL
        try {
          new URL(formData.url);
        } catch {
          newErrors.url = t('storage.validation.urlInvalid');
        }
      }

      if (!formData.username?.trim()) {
        newErrors.username = t('storage.validation.usernameRequired');
      }

      if (!formData.password?.trim()) {
        newErrors.password = t('storage.validation.passwordRequired');
      }

      if (!formData.protocol?.trim()) {
        newErrors.protocol = t('storage.validation.protocolRequired');
      }

      if (formData.timeout && (isNaN(formData.timeout) || formData.timeout < 1000)) {
        newErrors.timeout = t('storage.validation.timeoutMin');
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 连接测试
  const handleTest = async () => {
    if (!validateForm() || !onTest) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await onTest(formData);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        connected: false,
        message: error instanceof Error ? error.message : t('storage.testResult.failed')
      });
    } finally {
      setIsTesting(false);
    }
  };

  // 表单提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      onClose();
    } catch (error) {
      // 错误由父组件处理
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {mode === 'add' ? t('storage.addProviderTitle') : t('storage.editProviderTitle')}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ID字段（仅添加模式显示） */}
          {mode === 'add' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('storage.id')} *
              </label>
              <input
                type="text"
                value={formData.id}
                onChange={(e) => updateField('id', e.target.value)}
                placeholder={t('storage.placeholder.id')}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800 dark:border-gray-700 ${
                  errors.id ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
              {errors.id && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.id}</p>}
            </div>
          )}

          {/* 名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('storage.name')} *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder={t('storage.placeholder.name')}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800 dark:border-gray-700 ${
                errors.name ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
            />
            {errors.name && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.name}</p>}
          </div>

          {/* 类型（仅添加模式可选择） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('storage.type')} *
            </label>
            {mode === 'add' ? (
              <select
                value={formData.type}
                onChange={(e) => updateField('type', e.target.value as 'local' | 'nas')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800"
              >
                <option value="nas">{t('storage.nasType')}</option>
                <option value="local">{t('storage.localType')}</option>
              </select>
            ) : (
              <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400">
                {formData.type === 'nas' ? t('storage.nasType') : t('storage.localType')}
              </div>
            )}
          </div>

          {/* NAS 协议选择 */}
          {formData.type === 'nas' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('storage.protocol')}
              </label>
              {mode === 'add' ? (
                <select
                  value={formData.protocol || 'webdav'}
                  onChange={(e) => updateField('protocol', e.target.value as 'webdav' | 'smb')}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800"
                >
                  <option value="webdav">WebDAV</option>
                  <option value="smb">SMB/CIFS</option>
                </select>
              ) : (
                <div className="px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-600 dark:text-gray-400">
                  {formData.protocol === 'smb' ? 'SMB/CIFS' : 'WebDAV'}
                </div>
              )}
            </div>
          )}

          {/* 类型特定字段 */}
          {formData.type === 'local' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('storage.path')} *
              </label>
              <input
                type="text"
                value={formData.path || ''}
                onChange={(e) => updateField('path', e.target.value)}
                placeholder={t('storage.placeholder.path')}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800 dark:border-gray-700 ${
                  errors.path ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600'
                }`}
              />
              {errors.path && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.path}</p>}
            </div>
          ) : (
            <>
              {/* NAS URL */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {formData.protocol === 'smb' ? t('storage.smbSharePath', 'SMB 共享路径') : t('storage.url')} *
                </label>
                <input
                  type="text"
                  value={formData.url || ''}
                  onChange={(e) => updateField('url', e.target.value)}
                  placeholder={
                    formData.protocol === 'smb'
                      ? t('storage.placeholder.smbShare', 'smb://192.168.1.100/共享名')
                      : t('storage.placeholder.url')
                  }
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800 dark:border-gray-700 ${
                    errors.url ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {formData.protocol === 'smb' && !errors.url && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('storage.smbShareHint', '格式：smb://IP地址/共享名，例如 smb://192.168.1.100/documents')}
                  </p>
                )}
                {errors.url && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.url}</p>}
              </div>

              {/* 用户名 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('storage.username')} *
                </label>
                <input
                  type="text"
                  value={formData.username || ''}
                  onChange={(e) => updateField('username', e.target.value)}
                  placeholder={t('storage.username')}
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800 dark:border-gray-700 ${
                    errors.username ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {errors.username && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.username}</p>}
              </div>

              {/* SMB Domain（仅 SMB 协议显示，可选） */}
              {formData.protocol === 'smb' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('storage.domain', 'Windows Domain')}
                    <span className="text-xs text-gray-400 ml-1">{t('storage.optional', '(optional)')}</span>
                  </label>
                  <input
                    type="text"
                    value={formData.domain || ''}
                    onChange={(e) => updateField('domain', e.target.value)}
                    placeholder={t('storage.placeholder.domain', 'e.g. WORKGROUP or corp.example.com')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('storage.domainHint', 'Required for Active Directory / domain-joined NAS. Leave blank for standalone servers.')}
                  </p>
                </div>
              )}

              {/* 密码 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('storage.password')} *
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password || ''}
                    onChange={(e) => updateField('password', e.target.value)}
                    placeholder={mode === 'edit' ? t('storage.placeholder.password') : t('storage.password')}
                    autoComplete="current-password"
                    className={`w-full px-3 py-2 pr-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800 dark:border-gray-700 ${
                      errors.password ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.password}</p>}
              </div>

              {/* 超时设置 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('storage.timeout')}
                </label>
                <input
                  type="number"
                  value={formData.timeout || 30000}
                  onChange={(e) => updateField('timeout', parseInt(e.target.value) || 30000)}
                  min="1000"
                  step="1000"
                  placeholder={t('storage.placeholder.timeout')}
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800 dark:border-gray-700 ${
                    errors.timeout ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600'
                  }`}
                />
                {errors.timeout && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.timeout}</p>}
              </div>

              {/* 本地挂载路径（可选） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  本地挂载路径
                  <span className="text-xs text-gray-400 ml-1">(可选)</span>
                </label>
                <input
                  type="text"
                  value={formData.localMountPath || ''}
                  onChange={(e) => updateField('localMountPath', e.target.value)}
                  placeholder={
                    navigator.platform.startsWith('Win')
                      ? '例：Z:\\ 或 \\\\192.168.1.100\\share'
                      : '例：/Volumes/MyNAS 或 /mnt/nas'
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors dark:bg-gray-800"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  若已通过操作系统将 NAS 挂载为本地目录（macOS Finder 连接服务器、Windows 映射网络驱动器），
                  填入该本地路径后，AI 可直接以本地文件方式读写 NAS 文件，无需通过 SMB/WebDAV 协议。
                </p>
              </div>
            </>
          )}

          {/* 启用状态 */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="enabled"
              checked={formData.enabled}
              onChange={(e) => updateField('enabled', e.target.checked)}
              className="mr-2 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="enabled" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('storage.enabled')}
            </label>
          </div>

          {/* 测试结果 */}
          {testResult && (
            <div className={`p-3 rounded-lg ${
              testResult.connected ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}>
              <div className="flex items-center gap-2">
                {testResult.connected ? (
                  <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                )}
                <span className={`text-sm ${
                  testResult.connected ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
                }`}>
                  {testResult.message}
                </span>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-3 pt-4">
            {/* 测试连接按钮 */}
            {formData.type === 'nas' && onTest && (
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
              >
                {isTesting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <TestTube className="w-4 h-4" />
                )}
                {t('storage.testConnection')}
              </button>
            )}

            {/* 取消按钮 */}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
            >
              {t('storage.cancel')}
            </button>

            {/* 保存按钮 */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {mode === 'add' ? t('storage.addProvider') : t('storage.saveChanges')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
