import { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { authFetch } from '../utils/auth';

// 提供商配置：支持 OpenAI 和 Anthropic 两种协议的端点
export const MODEL_PROVIDERS: Record<string, {
  id: string;
  name: string;
  openai: string;
  anthropic: string;
  defaultProtocol: 'openai' | 'anthropic';
  supportsAnthropic: boolean;
}> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    openai: 'https://api.openai.com/v1',
    anthropic: '',
    defaultProtocol: 'openai',
    supportsAnthropic: false,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    openai: '',
    anthropic: 'https://api.anthropic.com',
    defaultProtocol: 'anthropic',
    supportsAnthropic: true,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    openai: 'https://api.deepseek.com/v1',
    anthropic: '',
    defaultProtocol: 'openai',
    supportsAnthropic: false,
  },
  alibaba: {
    id: 'alibaba',
    name: '阿里百炼 (通义千问)',
    openai: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    anthropic: '',
    defaultProtocol: 'openai',
    supportsAnthropic: false,
  },
  'alibaba-coding': {
    id: 'alibaba-coding',
    name: '阿里百炼 Coding Plan',
    openai: 'https://coding.dashscope.aliyuncs.com/v1',
    anthropic: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    defaultProtocol: 'openai',
    supportsAnthropic: true,
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    openai: 'https://api.moonshot.cn/v1',
    anthropic: '',
    defaultProtocol: 'openai',
    supportsAnthropic: false,
  },
  zhipu: {
    id: 'zhipu',
    name: '智谱 AI (GLM)',
    openai: 'https://open.bigmodel.cn/api/paas/v4',
    anthropic: '',
    defaultProtocol: 'openai',
    supportsAnthropic: false,
  },
  'zhipu-coding': {
    id: 'zhipu-coding',
    name: '智谱 GLM Coding Plan',
    openai: 'https://open.bigmodel.cn/api/coding/paas/v4',
    anthropic: 'https://open.bigmodel.cn/api/anthropic',
    defaultProtocol: 'openai',
    supportsAnthropic: true,
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax 国内版',
    openai: 'https://api.minimaxi.com/v1',
    anthropic: 'https://api.minimaxi.com/anthropic',
    defaultProtocol: 'openai',
    supportsAnthropic: true,
  },
  'minimax-intl': {
    id: 'minimax-intl',
    name: 'MiniMax 国际版',
    openai: 'https://api.minimax.io/v1',
    anthropic: 'https://api.minimax.io/anthropic',
    defaultProtocol: 'openai',
    supportsAnthropic: true,
  },
  xai: {
    id: 'xai',
    name: 'xAI (Grok)',
    openai: 'https://api.x.ai/v1',
    anthropic: '',
    defaultProtocol: 'openai',
    supportsAnthropic: false,
  },
  google: {
    id: 'google',
    name: 'Google AI (Gemini)',
    openai: 'https://generativelanguage.googleapis.com/v1beta',
    anthropic: '',
    defaultProtocol: 'openai',
    supportsAnthropic: false,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (本地)',
    openai: 'http://localhost:11434/v1',
    anthropic: '',
    defaultProtocol: 'openai',
    supportsAnthropic: false,
  },
  custom: {
    id: 'custom',
    name: '自定义',
    openai: '',
    anthropic: '',
    defaultProtocol: 'openai',
    supportsAnthropic: true,
  },
};

// 提供商列表（用于下拉选择）
export const PROVIDER_LIST = Object.values(MODEL_PROVIDERS);

interface Model {
  name: string;
  protocol?: 'openai' | 'anthropic';
  provider?: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  baseURL?: string;
  endpoint?: string;
}

interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: any;
}

interface ModelFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  model?: Model;
  onSave: (model: Model) => Promise<void>;
}

export function ModelFormModal({ isOpen, onClose, model, onSave }: ModelFormModalProps) {
  const [formData, setFormData] = useState<Model>({
    name: '',
    protocol: 'openai',
    provider: 'openai',
    model: '',
    apiKey: '',
    baseUrl: MODEL_PROVIDERS.openai.openai,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const isEditMode = !!model;

  // 根据提供商和协议获取默认端点
  function getDefaultEndpoint(providerId: string, protocol: 'openai' | 'anthropic'): string {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return '';
    return provider[protocol] || provider[provider.defaultProtocol] || '';
  }

  // 判断是否应该更新端点（如果用户没有自定义端点）
  function shouldUpdateEndpoint(
    currentEndpoint: string | undefined,
    currentProvider: string | undefined
  ): boolean {
    if (!currentEndpoint) return true;
    if (!currentProvider) return true;
    const provider = MODEL_PROVIDERS[currentProvider];
    if (!provider) return true;
    // 如果当前端点是该提供商任一协议的默认端点，则应该更新
    if (currentEndpoint === provider.openai || currentEndpoint === provider.anthropic) {
      return true;
    }
    return false;
  }

  // Initialize form data when model changes
  useEffect(() => {
    if (model) {
      // 编辑模式：从现有模型加载
      let providerId = model.provider || 'custom';
      let protocol: 'openai' | 'anthropic' = model.protocol || 'openai';

      // 检查提供商是否支持当前协议
      const provider = MODEL_PROVIDERS[providerId];
      if (provider && protocol === 'anthropic' && !provider.supportsAnthropic) {
        protocol = 'openai';
      }

      setFormData({
        name: model.name,
        protocol,
        provider: providerId,
        model: model.model,
        apiKey: model.apiKey || '',
        baseUrl: model.baseUrl || model.baseURL || model.endpoint || '',
      });
    } else {
      // 新建模式：使用默认值
      setFormData({
        name: '',
        protocol: 'openai',
        provider: 'openai',
        model: '',
        apiKey: '',
        baseUrl: MODEL_PROVIDERS.openai.openai,
      });
    }
    setError(null);
    setTestResult(null);
  }, [model, isOpen]);

  // 当提供商或协议改变时，更新端点默认值
  function handleProviderChange(providerId: string) {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return;

    // 确定协议：如果当前协议不被支持，切换到默认协议
    let newProtocol: 'openai' | 'anthropic' = formData.protocol || provider.defaultProtocol;
    if (newProtocol === 'anthropic' && !provider.supportsAnthropic) {
      newProtocol = provider.defaultProtocol;
    }

    const newEndpoint = shouldUpdateEndpoint(formData.baseUrl, formData.provider)
      ? getDefaultEndpoint(providerId, newProtocol)
      : formData.baseUrl;

    setFormData(prev => ({
      ...prev,
      provider: providerId,
      protocol: newProtocol,
      baseUrl: newEndpoint,
    }));
    setTestResult(null);
  }

  // 当协议改变时，更新端点默认值
  function handleProtocolChange(protocol: 'openai' | 'anthropic') {
    const newEndpoint = shouldUpdateEndpoint(formData.baseUrl, formData.provider)
      ? getDefaultEndpoint(formData.provider || 'custom', protocol)
      : formData.baseUrl;

    setFormData(prev => ({
      ...prev,
      protocol,
      baseUrl: newEndpoint,
    }));
    setTestResult(null);
  }

  function handleChange(field: keyof Model, value: string) {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
    // 清除测试结果当配置变化时
    if (field === 'apiKey' || field === 'model' || field === 'baseUrl') {
      setTestResult(null);
    }
  }

  // 测试模型配置
  async function handleTest() {
    // 基本验证
    if (!formData.model.trim()) {
      setTestResult({ success: false, error: '请先填写模型 ID' });
      return;
    }
    // 编辑模式下如果 API Key 是 ***，说明使用的是已保存的密钥
    // 新建模式下必须填写 API Key（除非是 Ollama）
    const isUsingSavedKey = isEditMode && formData.apiKey === '***';
    if (!formData.apiKey?.trim() && formData.provider !== 'ollama' && !isUsingSavedKey) {
      setTestResult({ success: false, error: '请先填写 API 密钥' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const response = await authFetch('/api/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          protocol: formData.protocol,
          provider: formData.provider,
          model: formData.model,
          apiKey: formData.apiKey,
          baseUrl: formData.baseUrl,
        }),
      });

      const result = await response.json();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        error: err instanceof Error ? err.message : '测试失败',
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validation
    if (!formData.name.trim()) {
      setError('模型名称不能为空');
      return;
    }
    if (!formData.model.trim()) {
      setError('模型 ID 不能为空');
      return;
    }
    if (!formData.provider) {
      setError('请选择提供商');
      return;
    }
    if (!formData.protocol) {
      setError('请选择协议类型');
      return;
    }

    // 自定义提供商必须填写端点
    if (formData.provider === 'custom' && !formData.baseUrl?.trim()) {
      setError('自定义提供商必须填写 API 端点');
      return;
    }

    try {
      setLoading(true);

      // Prepare data for saving
      const modelToSave: Model = {
        name: formData.name.trim(),
        protocol: formData.protocol,
        provider: formData.provider,
        model: formData.model.trim(),
        apiKey: formData.apiKey?.trim() || undefined,
        baseUrl: formData.baseUrl?.trim() || undefined,
      };

      await onSave(modelToSave);
    } catch (err) {
      console.error('Failed to save model:', err);
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  function getProviderHint(providerId: string | undefined): string {
    switch (providerId) {
      case 'ollama':
        return '本地模型通常不需要 API 密钥';
      case 'anthropic':
        return '需要 Anthropic API Key';
      case 'openai':
        return '需要 OpenAI API Key';
      case 'deepseek':
        return '需要 DeepSeek API Key';
      case 'alibaba':
        return '需要阿里云 DashScope API Key';
      case 'moonshot':
        return '需要 Moonshot API Key';
      case 'zhipu':
        return '需要智谱 API Key';
      case 'minimax':
        return '需要 MiniMax API Key';
      case 'xai':
        return '需要 xAI API Key';
      case 'google':
        return '需要 Google AI API Key';
      default:
        return '';
    }
  }

  // 获取当前提供商支持的协议选项
  function getAvailableProtocols(): { value: 'openai' | 'anthropic'; label: string; disabled: boolean }[] {
    const provider = MODEL_PROVIDERS[formData.provider || 'custom'];
    return [
      {
        value: 'openai',
        label: 'OpenAI 兼容协议',
        disabled: !provider || !provider.openai,
      },
      {
        value: 'anthropic',
        label: 'Anthropic 协议',
        disabled: !provider || !provider.supportsAnthropic,
      },
    ];
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {isEditMode ? '编辑模型' : '添加模型'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 推荐信息 */}
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              <strong>推荐：</strong>使用 MiniMax Coding Plan，性价比高，适合编程任务。
              <a
                href="https://platform.minimaxi.com/subscribe/coding-plan"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-200"
              >
                立即注册 →
              </a>
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {/* Test Result */}
          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg ${
              testResult.success
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
            }`}>
              {testResult.success ? (
                <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              )}
              <div className="text-sm">
                <p>{testResult.success ? testResult.message : testResult.error}</p>
                {testResult.details && testResult.success && (
                  <p className="text-xs mt-1 opacity-75">
                    模型: {testResult.details.model}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Model Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              模型名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="例如: gpt-4, claude-3, deepseek-chat"
              disabled={isEditMode}
              className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent ${
                isEditMode ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {isEditMode ? '模型名称是主键，不可修改' : '用于识别模型的友好名称'}
            </p>
          </div>

          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              模型提供商 <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {PROVIDER_LIST.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          {/* Protocol */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              API 协议 <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.protocol}
              onChange={(e) => handleProtocolChange(e.target.value as 'openai' | 'anthropic')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {getAvailableProtocols().map(p => (
                <option key={p.value} value={p.value} disabled={p.disabled}>
                  {p.label} {p.disabled ? '(不支持)' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              决定使用哪种 API 格式调用模型
            </p>
          </div>

          {/* Model ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              模型 ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.model}
              onChange={(e) => handleChange('model', e.target.value)}
              placeholder="例如: gpt-4-turbo, claude-3-opus, deepseek-chat"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              模型的实际调用 ID
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              API 密钥
            </label>
            <input
              type="password"
              value={formData.apiKey}
              onChange={(e) => handleChange('apiKey', e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {getProviderHint(formData.provider)}
            </p>
          </div>

          {/* API Endpoint */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              API 端点
            </label>
            <input
              type="text"
              value={formData.baseUrl}
              onChange={(e) => handleChange('baseUrl', e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {formData.provider === 'custom'
                ? '自定义端点必须填写'
                : '留空使用提供商默认端点，或自定义端点'}
            </p>
          </div>

          {/* Footer */}
          <div className="flex justify-between gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            {/* Test Button */}
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || loading}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              {testing ? '测试中...' : '测试连接'}
            </button>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading && (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
