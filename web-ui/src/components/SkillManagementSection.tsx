import { Search, ChevronDown, ChevronRight, FileCode, FileText, Palette, Apple, Wrench, Brain, Music, Utensils, MessageCircle, BookOpen, Folder, RotateCw, Github, Download, Loader2, Pencil, Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { SkillEditorPanel } from './SkillEditorPanel';
import { usePermission } from '../hooks/usePermission';

interface Skill {
  name: string;
  description: string;
  enabled: boolean;
  source: string;
  filePath: string;
}

interface SkillManagementSectionProps {
  skills: Skill[];
  searchQuery: string;
  loading: boolean;
  reloading?: boolean;
  downloadingSkills?: Set<string>;
  onToggle: (name: string) => void;
  onSearch: (query: string) => void;
  onReload: () => void;
  onInstall: () => void;
  onDownload: (name: string) => void;
  onLoadFiles: (skillName: string) => Promise<string[]>;
  onLoadContent: (skillName: string, filePath: string) => Promise<string>;
  onSaveContent: (skillName: string, filePath: string, content: string) => Promise<boolean>;
  onEditorChange?: (open: boolean) => void;
}

// Skill category definitions
interface SkillCategory {
  id: string;
  name: string;
  nameEn: string;
  icon: React.ReactNode;
  skills: string[];
}

const SKILL_CATEGORIES: SkillCategory[] = [
  {
    id: 'office',
    name: '办公效率',
    nameEn: 'Office & Productivity',
    icon: <FileText className="w-4 h-4" />,
    skills: ['pptx', 'docx', 'xlsx', 'pdf', 'nano-pdf', 'doc-coauthoring']
  },
  {
    id: 'design',
    name: '设计创作',
    nameEn: 'Design & Creative',
    icon: <Palette className="w-4 h-4" />,
    skills: ['algorithmic-art', 'canvas', 'canvas-design', 'frontend-design', 'theme-factory', 'web-artifacts-builder', 'brand-guidelines']
  },
  {
    id: 'apple',
    name: '苹果生态',
    nameEn: 'Apple Ecosystem',
    icon: <Apple className="w-4 h-4" />,
    skills: ['apple-notes', 'apple-reminders', 'bear-notes', 'camsnap', 'himalaya', 'imsg', 'things-mac', 'bluebubbles', 'spotify-player']
  },
  {
    id: 'developer',
    name: '开发者工具',
    nameEn: 'Developer Tools',
    icon: <Wrench className="w-4 h-4" />,
    skills: ['coding-agent', 'github', 'mcp-builder', 'skill-creator', 'session-logs', 'tmux', 'webapp-testing', 'oracle']
  },
  {
    id: 'ai',
    name: 'AI 模型',
    nameEn: 'AI & Models',
    icon: <Brain className="w-4 h-4" />,
    skills: ['deep-research', 'gemini', 'openai-image-gen', 'openai-whisper', 'openai-whisper-api', 'model-usage', 'summarize', 'nano-banana-pro', 'sag']
  },
  {
    id: 'media',
    name: '音乐与媒体',
    nameEn: 'Music & Media',
    icon: <Music className="w-4 h-4" />,
    skills: ['gog', 'openhue', 'sonoscli', 'sherpa-onnx-tts', 'voice-call', 'songsee', 'video-frames', 'gifgrep', 'slack-gif-creator']
  },
  {
    id: 'lifestyle',
    name: '生活服务',
    nameEn: 'Lifestyle',
    icon: <Utensils className="w-4 h-4" />,
    skills: ['food-order', 'goplaces', 'weather', 'healthcheck', 'ordercli']
  },
  {
    id: 'communication',
    name: '通讯协作',
    nameEn: 'Communication',
    icon: <MessageCircle className="w-4 h-4" />,
    skills: ['discord', 'feishu-calendar', 'feishu-mail', 'internal-comms', 'slack', 'wacli', 'blucli']
  },
  {
    id: 'knowledge',
    name: '笔记知识',
    nameEn: 'Notes & Knowledge',
    icon: <BookOpen className="w-4 h-4" />,
    skills: ['notion', 'obsidian', 'blogwatcher']
  },
  {
    id: 'other',
    name: '其他工具',
    nameEn: 'Other Tools',
    icon: <Folder className="w-4 h-4" />,
    skills: ['1password', 'clawhub', 'mcporter', 'peekaboo', 'preference-detector', 'trello', 'eightctl', 'algorithmic-art']
  }
];

// Map skill name to category
function getSkillCategory(skillName: string): SkillCategory | undefined {
  for (const category of SKILL_CATEGORIES) {
    if (category.skills.includes(skillName)) {
      return category;
    }
  }
  return SKILL_CATEGORIES.find(c => c.id === 'other');
}

// Group skills by category
function groupSkillsByCategory(skills: Skill[]): Map<SkillCategory, Skill[]> {
  const grouped = new Map<SkillCategory, Skill[]>();

  // Initialize all categories
  SKILL_CATEGORIES.forEach(cat => {
    grouped.set(cat, []);
  });

  // Group skills
  skills.forEach(skill => {
    const category = getSkillCategory(skill.name) ?? SKILL_CATEGORIES.find(c => c.id === 'other')!;
    const existing = grouped.get(category) || [];
    grouped.set(category, [...existing, skill]);
  });

  // Remove empty categories
  grouped.forEach((skillList, category) => {
    if (skillList.length === 0) {
      grouped.delete(category);
    }
  });

  return grouped;
}

export function SkillManagementSection({
  skills,
  searchQuery,
  loading,
  reloading = false,
  downloadingSkills = new Set(),
  onToggle,
  onSearch,
  onReload,
  onInstall,
  onDownload,
  onLoadFiles,
  onLoadContent,
  onSaveContent,
  onEditorChange
}: SkillManagementSectionProps) {
  const { t } = useTranslation();
  const canEdit = usePermission('installSkills');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grouped' | 'list'>('grouped');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  function handleSelectSkill(skill: Skill | null) {
    setSelectedSkill(skill);
    onEditorChange?.(skill !== null);
  }

  // Filter skills based on search query
  const filteredSkills = skills.filter(skill =>
    skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    skill.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group filtered skills by category
  const groupedSkills = groupSkillsByCategory(filteredSkills);

  // Toggle category expansion
  const toggleCategory = (categoryId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryId)) {
      newExpanded.delete(categoryId);
    } else {
      newExpanded.add(categoryId);
    }
    setExpandedCategories(newExpanded);
  };

  // Expand all categories
  const expandAll = () => {
    setExpandedCategories(new Set(SKILL_CATEGORIES.map(c => c.id)));
  };

  // Collapse all categories
  const collapseAll = () => {
    setExpandedCategories(new Set());
  };

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left panel: skill list (full width when no skill selected, fixed width when split) */}
      <div className={`flex flex-col min-h-0 overflow-hidden ${selectedSkill ? 'w-80 flex-shrink-0 border-r border-gray-200 dark:border-gray-700' : 'flex-1'}`}>
        {/* Search Bar & View Controls */}
        <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder={t('skills.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => onSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          {/* Install from GitHub Button - 仅有权限时显示 */}
          {canEdit && (
            <button
              onClick={onInstall}
              className={`flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-600 dark:text-gray-400 transition-colors ${selectedSkill ? 'p-2' : 'px-3 py-2'}`}
              title={t('skills.install.title')}
            >
              <Github className="w-4 h-4" />
              {!selectedSkill && <span className="hidden sm:inline">{t('skills.install.shortLabel')}</span>}
            </button>
          )}

          {/* Reload Button - 仅有权限时显示 */}
          {canEdit && (
            <button
              onClick={onReload}
              disabled={reloading}
              className={`flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-600 dark:text-gray-400 disabled:opacity-50 transition-colors ${selectedSkill ? 'p-2' : 'px-3 py-2'}`}
              title="重新加载 skills（无需重启服务）"
            >
              <RotateCw className={`w-4 h-4 ${reloading ? 'animate-spin' : ''}`} />
              {!selectedSkill && <span className="hidden sm:inline">{reloading ? t('common.loading') : t('skills.reload')}</span>}
            </button>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('grouped')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                viewMode === 'grouped'
                  ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
              title="分类视图"
            >
              <Folder className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
              title="列表视图"
            >
              <FileCode className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Category expand/collapse controls */}
        {viewMode === 'grouped' && (
          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
            <button onClick={expandAll} className="hover:text-primary-600">{t('skills.expandAll')}</button>
            <span>|</span>
            <button onClick={collapseAll} className="hover:text-primary-600">{t('skills.collapseAll')}</button>
          </div>
        )}
        {!canEdit && (
          <div className="flex items-center gap-2 mt-2 px-2 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
            <span>当前账号仅可查看，无权启用/禁用或编辑 Skills。</span>
          </div>
        )}
      </div>

      {/* Skills List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredSkills.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            {searchQuery ? '没有找到匹配的 skills' : '没有可用的 skills'}
          </div>
        ) : viewMode === 'grouped' ? (
          // Grouped View
          <div className="p-2">
            {Array.from(groupedSkills.entries()).map(([category, categorySkills]) => (
              <div key={category.id} className="mb-2">
                {/* Category Header */}
                <button
                  onClick={() => toggleCategory(category.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  {expandedCategories.has(category.id) ? (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  )}
                  <span className="text-gray-500 dark:text-gray-400">{category.icon}</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {i18n.language === 'en' ? category.nameEn : category.name}
                  </span>
                  <span className="text-xs text-gray-400">({categorySkills.length})</span>
                  <span className="text-xs text-gray-500 dark:text-gray-500 ml-auto">
                    {categorySkills.filter(s => s.enabled).length} 启用
                  </span>
                </button>

                {/* Category Skills */}
                {expandedCategories.has(category.id) && (
                  <div className="ml-4 border-l-2 border-gray-200 dark:border-gray-700 pl-2 space-y-1">
                    {categorySkills.map(skill => (
                      <SkillItem
                        key={skill.name}
                        skill={skill}
                        onToggle={onToggle}
                        onDownload={onDownload}
                        onView={() => handleSelectSkill(skill)}
                        loading={loading}
                        downloading={downloadingSkills.has(skill.name)}
                        selected={selectedSkill?.name === skill.name}
                        canEdit={canEdit}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          // List View
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {filteredSkills.map(skill => (
              <SkillItem
                key={skill.name}
                skill={skill}
                onToggle={onToggle}
                onDownload={onDownload}
                onView={() => handleSelectSkill(skill)}
                loading={loading}
                downloading={downloadingSkills.has(skill.name)}
                selected={selectedSkill?.name === skill.name}
                canEdit={canEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>{t('skills.total')}: {skills.length} {t('skills.skillsCount')}</span>
          <span>{t('skills.enabled')}: {skills.filter(s => s.enabled).length} | {t('skills.disabled')}: {skills.filter(s => !s.enabled).length}</span>
        </div>
      </div>
      </div>{/* end left panel */}

      {/* Right panel: editor */}
      {selectedSkill && (
        <div className="flex-1 min-w-0 overflow-hidden">
          <SkillEditorPanel
            skill={selectedSkill}
            onClose={() => handleSelectSkill(null)}
            onLoadFiles={onLoadFiles}
            onLoadContent={onLoadContent}
            onSaveContent={onSaveContent}
            readOnly={!canEdit}
          />
        </div>
      )}
    </div>
  );
}

// Skill Item Component
interface SkillItemProps {
  skill: Skill;
  onToggle: (name: string) => void;
  onDownload: (name: string) => void;
  onView: () => void;
  loading: boolean;
  downloading?: boolean;
  selected?: boolean;
  canEdit?: boolean;
}

function SkillItem({ skill, onToggle, onDownload, onView, loading, downloading = false, selected = false, canEdit = false }: SkillItemProps) {
  return (
    <div className={`p-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors rounded-lg ${selected ? 'bg-primary-50 dark:bg-primary-900/10' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {skill.name}
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
              {skill.source}
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
            {skill.description}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
            {skill.filePath}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Edit Button - 无权限时禁用 */}
          <button
            onClick={canEdit ? onView : undefined}
            disabled={!canEdit}
            className={`p-1 rounded transition-colors ${
              !canEdit
                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed opacity-50'
                : selected
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
            }`}
            title={canEdit ? '编辑 skill 文件' : '无权限编辑'}
          >
            <Pencil className="w-4 h-4" />
          </button>

          {/* Download Button - 无权限时禁用 */}
          <button
            onClick={() => canEdit && onDownload(skill.name)}
            disabled={downloading || !canEdit}
            className={`p-1 rounded transition-colors ${
              !canEdit
                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed opacity-50'
                : 'text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
            title={!canEdit ? '无权限下载' : '下载 .skill 文件'}
          >
            {downloading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />
            }
          </button>

          {/* Toggle Switch - 仅有权限时可操作 */}
          <button
            onClick={() => canEdit && onToggle(skill.name)}
            disabled={loading || !canEdit}
            className={`w-10 h-5 rounded-full relative transition-colors ${
              skill.enabled
                ? 'bg-primary-600'
                : 'bg-gray-300 dark:bg-gray-700'
            } ${(loading || !canEdit) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            title={!canEdit ? '无权限操作' : skill.enabled ? '点击禁用' : '点击启用'}
          >
            <div
              className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-all ${
                skill.enabled ? 'right-0.5' : 'left-0.5'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
