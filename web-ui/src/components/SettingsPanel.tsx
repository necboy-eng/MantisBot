import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SkillManagementSection } from './SkillManagementSection';
import { ModelConfigSection } from './ModelConfigSection';
import { ProfileManagementSection } from './ProfileManagementSection';
import { EvolutionSection } from './EvolutionSection';
import { AllowedPathsSection } from './AllowedPathsSection';
import { ChannelManagementSection } from './ChannelManagementSection';
import { EmailConfigSection } from './EmailConfigSection';
import { AuthSettingsSection } from './AuthSettingsSection';
import { FirecrawlSettingsSection } from './FirecrawlSettingsSection';
import { AgentTeamsSection } from './AgentTeamsSection';
import { PluginManagementSection } from './PluginManagementSection';
import { StorageManagementSection } from './StorageManagementSection';
import { InstallSkillModal } from './InstallSkillModal';
import { authFetch } from '../utils/auth';
import { invalidateAllCache } from '../utils/configCache';

interface Skill {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  filePath: string;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [downloadingSkills, setDownloadingSkills] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'skills' | 'models' | 'profiles' | 'evolutions' | 'paths' | 'channels' | 'email' | 'auth' | 'firecrawl' | 'teams' | 'plugins' | 'storage'>('models');
  const [activeProfile, setActiveProfile] = useState('default');
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [reloadingConfig, setReloadingConfig] = useState(false);
  const [skillEditorOpen, setSkillEditorOpen] = useState(false);

  // Fetch skills on mount
  useEffect(() => {
    if (isOpen) {
      fetchSkills();
    }
  }, [isOpen]);

  async function fetchSkills() {
    try {
      const res = await authFetch('/api/skills');
      if (!res.ok) throw new Error('Failed to fetch skills');
      const data = await res.json();
      setSkills(data.skills);
    } catch (err) {
      console.error('Failed to fetch skills:', err);
    }
  }

  async function reloadSkills() {
    setReloading(true);
    try {
      const res = await authFetch('/api/skills/reload', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to reload skills');
      await fetchSkills();
    } catch (err) {
      console.error('Failed to reload skills:', err);
    } finally {
      setReloading(false);
    }
  }

  async function toggleSkill(skillName: string) {
    setLoading(true);
    try {
      const res = await authFetch(`/api/skills/${skillName}/toggle`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to toggle skill');
      const data = await res.json();

      // Update local state
      setSkills(prev => prev.map(s =>
        s.name === skillName ? { ...s, enabled: data.enabled } : s
      ));
    } catch (err) {
      console.error('Failed to toggle skill:', err);
      // Revert on error by refetching
      await fetchSkills();
    } finally {
      setLoading(false);
    }
  }

  async function downloadSkill(skillName: string) {
    if (downloadingSkills.has(skillName)) return;
    setDownloadingSkills(prev => new Set(prev).add(skillName));
    try {
      const res = await authFetch(`/api/skills/${skillName}/download`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        console.error('Failed to download skill:', err.error);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${skillName}.skill`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download skill:', err);
    } finally {
      setDownloadingSkills(prev => {
        const next = new Set(prev);
        next.delete(skillName);
        return next;
      });
    }
  }

  const loadSkillFiles = useCallback(async (skillName: string): Promise<string[]> => {
    try {
      const res = await authFetch(`/api/skills/${skillName}/files`);
      if (!res.ok) throw new Error('Failed to load skill files');
      const data = await res.json();
      return data.files as string[];
    } catch (err) {
      console.error('Failed to load skill files:', err);
      return [];
    }
  }, []);

  const loadSkillFileContent = useCallback(async (skillName: string, filePath: string): Promise<string> => {
    try {
      const res = await authFetch(`/api/skills/${skillName}/file?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error('Failed to load skill file content');
      const data = await res.json();
      return data.content as string;
    } catch (err) {
      console.error('Failed to load skill file content:', err);
      return '';
    }
  }, []);

  const saveSkillFileContent = useCallback(async (skillName: string, filePath: string, content: string): Promise<boolean> => {
    try {
      const res = await authFetch(`/api/skills/${skillName}/file?path=${encodeURIComponent(filePath)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      return res.ok;
    } catch (err) {
      console.error('Failed to save skill file content:', err);
      return false;
    }
  }, []);

  async function reloadConfig() {
    setReloadingConfig(true);
    try {
      await authFetch('/api/config/reload', { method: 'POST' });
      // 服务端配置已从磁盘重载，清空前端所有缓存确保下次读取拿到最新数据
      invalidateAllCache();
    } catch (err) {
      console.error('Failed to reload config:', err);
    } finally {
      setReloadingConfig(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className={`bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full transition-all duration-200 ${skillEditorOpen ? 'max-w-6xl max-h-[90vh]' : 'max-w-5xl max-h-[80vh]'} flex flex-col`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {t('settings.title')}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={reloadConfig}
              disabled={reloadingConfig}
              title={t('settings.reloadConfig')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reloadingConfig ? 'animate-spin' : ''}`} />
              {t('settings.reloadConfig')}
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('models')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'models'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.modelConfig')}
            </button>
            <button
              onClick={() => setActiveTab('skills')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'skills'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.skillManagement')}
            </button>
            <button
              onClick={() => setActiveTab('profiles')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'profiles'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.agentProfile')}
            </button>
            <button
              onClick={() => setActiveTab('evolutions')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'evolutions'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.evolution')}
            </button>
            <button
              onClick={() => setActiveTab('paths')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'paths'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.allowedPaths')}
            </button>
            <button
              onClick={() => setActiveTab('channels')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'channels'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.channelManagement')}
            </button>
            <button
              onClick={() => setActiveTab('email')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'email'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.emailConfig') || '邮件配置'}
            </button>
            <button
              onClick={() => setActiveTab('auth')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'auth'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.auth')}
            </button>
            <button
              onClick={() => setActiveTab('firecrawl')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'firecrawl'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              Firecrawl
            </button>
            <button
              onClick={() => setActiveTab('teams')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'teams'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.teams') || '团队'}
            </button>
            <button
              onClick={() => setActiveTab('plugins')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'plugins'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.plugins') || '插件'}
            </button>
            <button
              onClick={() => setActiveTab('storage')}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'storage'
                  ? 'text-primary-600 border-primary-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t('settings.storage') || '存储'}
            </button>
          </div>
        </div>

        {/* Content Area */}
        {activeTab === 'skills' ? (
          <SkillManagementSection
            skills={skills}
            searchQuery={searchQuery}
            loading={loading}
            reloading={reloading}
            downloadingSkills={downloadingSkills}
            onToggle={toggleSkill}
            onSearch={setSearchQuery}
            onReload={reloadSkills}
            onInstall={() => setInstallModalOpen(true)}
            onDownload={downloadSkill}
            onLoadFiles={loadSkillFiles}
            onLoadContent={loadSkillFileContent}
            onSaveContent={saveSkillFileContent}
            onEditorChange={setSkillEditorOpen}
          />
        ) : activeTab === 'models' ? (
          <ModelConfigSection />
        ) : activeTab === 'profiles' ? (
          <ProfileManagementSection
            activeProfile={activeProfile}
            onProfileChange={setActiveProfile}
          />
        ) : activeTab === 'paths' ? (
          <AllowedPathsSection />
        ) : activeTab === 'channels' ? (
          <ChannelManagementSection isOpen={activeTab === 'channels'} />
        ) : activeTab === 'email' ? (
          <EmailConfigSection />
        ) : activeTab === 'auth' ? (
          <AuthSettingsSection />
        ) : activeTab === 'firecrawl' ? (
          <FirecrawlSettingsSection />
        ) : activeTab === 'teams' ? (
          <AgentTeamsSection />
        ) : activeTab === 'plugins' ? (
          <PluginManagementSection />
        ) : activeTab === 'storage' ? (
          <StorageManagementSection />
        ) : (
          <EvolutionSection />
        )}
      </div>

      <InstallSkillModal
        isOpen={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        onInstalled={() => fetchSkills()}
      />
    </div>
  );
}
