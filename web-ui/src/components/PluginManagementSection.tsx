import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, ToggleLeft, ToggleRight, ChevronDown, ChevronRight, FileText, Command, Sparkles } from 'lucide-react';
import { authFetch } from '../utils/auth';

interface PluginSkill {
  name: string;
  description: string;
  content?: string;
  pluginName: string;
}

interface PluginCommand {
  name: string;
  description: string;
  content?: string;
  pluginName: string;
}

interface Plugin {
  name: string;
  version: string;
  description: string;
  author?: string;
  enabled: boolean;
  skillsCount: number;
  commandsCount: number;
  path: string;
  skills?: PluginSkill[];
  commands?: PluginCommand[];
}

export function PluginManagementSection() {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [togglingPlugin, setTogglingPlugin] = useState<string | null>(null);

  useEffect(() => {
    fetchPlugins();
  }, []);

  async function fetchPlugins() {
    setLoading(true);
    try {
      const res = await authFetch('/api/plugins');
      if (!res.ok) throw new Error('Failed to fetch plugins');
      const data = await res.json();
      setPlugins(data);
    } catch (err) {
      console.error('Failed to fetch plugins:', err);
    } finally {
      setLoading(false);
    }
  }

  async function togglePlugin(pluginName: string) {
    setTogglingPlugin(pluginName);
    try {
      const res = await authFetch(`/api/plugins/${pluginName}/toggle`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to toggle plugin');
      const data = await res.json();

      // Update local state
      setPlugins(prev => prev.map(p =>
        p.name === pluginName ? { ...p, enabled: data.enabled } : p
      ));
    } catch (err) {
      console.error('Failed to toggle plugin:', err);
    } finally {
      setTogglingPlugin(null);
    }
  }

  async function loadPluginDetails(pluginName: string) {
    // Check if already loaded
    const plugin = plugins.find(p => p.name === pluginName);
    if (plugin?.skills && plugin?.commands) {
      setExpandedPlugin(expandedPlugin === pluginName ? null : pluginName);
      return;
    }

    try {
      const res = await authFetch(`/api/plugins/${pluginName}`);
      if (!res.ok) throw new Error('Failed to fetch plugin details');
      const data = await res.json();

      setPlugins(prev => prev.map(p =>
        p.name === pluginName ? { ...p, skills: data.skills, commands: data.commands } : p
      ));
      setExpandedPlugin(expandedPlugin === pluginName ? null : pluginName);
    } catch (err) {
      console.error('Failed to load plugin details:', err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  if (plugins.length === 0) {
    return (
      <div className="text-center py-12">
        <Package className="w-12 h-12 mx-auto text-gray-400 mb-4" />
        <p className="text-gray-500 dark:text-gray-400">
          {t('plugins.noPlugins', '暂无已安装的插件')}
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
          {t('plugins.hint', '将插件放入 plugins 目录即可自动加载')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold dark:text-white">
            {t('plugins.title', '插件管理')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('plugins.description', '管理已安装的插件及其 Skills 和 Commands')}
          </p>
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {plugins.filter(p => p.enabled).length} / {plugins.length} {t('plugins.enabled', '已启用')}
        </div>
      </div>

      {/* Plugin List */}
      <div className="space-y-3">
        {plugins.map(plugin => (
          <div
            key={plugin.name}
            className={`border rounded-lg overflow-hidden transition-colors ${
              plugin.enabled
                ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 opacity-75'
            }`}
          >
            {/* Plugin Header */}
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <button
                  onClick={() => loadPluginDetails(plugin.name)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  {expandedPlugin === plugin.name ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronRight className="w-5 h-5" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium dark:text-white truncate">
                      {plugin.name}
                    </span>
                    {plugin.version && (
                      <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                        v{plugin.version}
                      </span>
                    )}
                    {!plugin.enabled && (
                      <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400 rounded">
                        {t('plugins.disabled', '已禁用')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {plugin.description}
                  </p>
                  {plugin.author && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {t('plugins.author', '作者')}: {plugin.author}
                    </p>
                  )}
                </div>
              </div>

              {/* Stats & Toggle */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-1" title={t('plugins.skillsCount', 'Skills')}>
                    <Sparkles className="w-4 h-4" />
                    <span>{plugin.skillsCount}</span>
                  </div>
                  <div className="flex items-center gap-1" title={t('plugins.commandsCount', 'Commands')}>
                    <Command className="w-4 h-4" />
                    <span>{plugin.commandsCount}</span>
                  </div>
                </div>
                <button
                  onClick={() => togglePlugin(plugin.name)}
                  disabled={togglingPlugin === plugin.name}
                  className="transition-colors disabled:opacity-50"
                  title={plugin.enabled ? t('plugins.clickToDisable', '点击禁用') : t('plugins.clickToEnable', '点击启用')}
                >
                  {plugin.enabled ? (
                    <ToggleRight className="w-8 h-8 text-green-500" />
                  ) : (
                    <ToggleLeft className="w-8 h-8 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Expanded Details */}
            {expandedPlugin === plugin.name && (
              <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Skills */}
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      <Sparkles className="w-4 h-4" />
                      {t('plugins.skills', 'Skills')} ({plugin.skills?.length || 0})
                    </h4>
                    {plugin.skills && plugin.skills.length > 0 ? (
                      <div className="space-y-2">
                        {plugin.skills.map(skill => (
                          <div
                            key={skill.name}
                            className="p-2 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600"
                          >
                            <div className="font-medium text-sm dark:text-white">
                              {skill.name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {skill.description}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500">
                        {t('plugins.noSkills', '无 Skills')}
                      </p>
                    )}
                  </div>

                  {/* Commands */}
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      <Command className="w-4 h-4" />
                      {t('plugins.commands', 'Commands')} ({plugin.commands?.length || 0})
                    </h4>
                    {plugin.commands && plugin.commands.length > 0 ? (
                      <div className="space-y-2">
                        {plugin.commands.map(cmd => (
                          <div
                            key={cmd.name}
                            className="p-2 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600"
                          >
                            <div className="font-mono text-sm text-primary-600 dark:text-primary-400">
                              /{plugin.name}:{cmd.name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {cmd.description}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500">
                        {t('plugins.noCommands', '无 Commands')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Path */}
                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-600">
                  <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                    <FileText className="w-3.5 h-3.5" />
                    <span className="font-mono truncate">{plugin.path}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Help Text */}
      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
          {t('plugins.aboutTitle', '关于插件')}
        </h4>
        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
          <li>• {t('plugins.aboutSkill', 'Skills: 在 Agent 对话中自动生效的指导规则')}</li>
          <li>• {t('plugins.aboutCommand', 'Commands: 通过 /plugin:command 显式调用的命令')}</li>
          <li>• {t('plugins.aboutToggle', '禁用插件后，其 Skills 和 Commands 都将失效')}</li>
        </ul>
      </div>
    </div>
  );
}
