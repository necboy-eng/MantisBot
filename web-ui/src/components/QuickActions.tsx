import { useTranslation } from 'react-i18next';

interface QuickAction {
  id: string;
  icon: string;
  iconBg: string;
  titleKey: string;
  descKey: string;
  promptKey: string;
}

const quickActions: QuickAction[] = [
  {
    id: 'code',
    icon: '💻',
    iconBg: 'bg-sky-100 dark:bg-sky-900/40',
    titleKey: 'quickActions.codeTitle',
    descKey: 'quickActions.codeDesc',
    promptKey: 'quickActions.codePrompt',
  },
  {
    id: 'web',
    icon: '🌐',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    titleKey: 'quickActions.webTitle',
    descKey: 'quickActions.webDesc',
    promptKey: 'quickActions.webPrompt',
  },
  {
    id: 'file',
    icon: '📁',
    iconBg: 'bg-amber-100 dark:bg-amber-900/40',
    titleKey: 'quickActions.fileTitle',
    descKey: 'quickActions.fileDesc',
    promptKey: 'quickActions.filePrompt',
  },
  {
    id: 'data',
    icon: '📊',
    iconBg: 'bg-violet-100 dark:bg-violet-900/40',
    titleKey: 'quickActions.dataTitle',
    descKey: 'quickActions.dataDesc',
    promptKey: 'quickActions.dataPrompt',
  },
  {
    id: 'automation',
    icon: '⚡',
    iconBg: 'bg-rose-100 dark:bg-rose-900/40',
    titleKey: 'quickActions.automationTitle',
    descKey: 'quickActions.automationDesc',
    promptKey: 'quickActions.automationPrompt',
  },
  {
    id: 'memory',
    icon: '🧠',
    iconBg: 'bg-indigo-100 dark:bg-indigo-900/40',
    titleKey: 'quickActions.memoryTitle',
    descKey: 'quickActions.memoryDesc',
    promptKey: 'quickActions.memoryPrompt',
  },
];

interface QuickActionsProps {
  onActionClick: (prompt: string) => void;
}

export function QuickActions({ onActionClick }: QuickActionsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      {/* Welcome Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary-500 to-sky-600 flex items-center justify-center shadow-lg">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">
          {t('quickActions.welcome')}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          {t('quickActions.subtitle')}
        </p>
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-3xl w-full">
        {quickActions.map((action) => (
          <button
            key={action.id}
            onClick={() => onActionClick(t(action.promptKey))}
            className="group text-left p-4 rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/50 hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-md transition-all duration-200"
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg ${action.iconBg} flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-110 transition-transform duration-200`}>
                {action.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-gray-800 dark:text-gray-200 text-sm mb-1 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {t(action.titleKey)}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                  {t(action.descKey)}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Hint */}
      <p className="mt-6 text-xs text-gray-400 dark:text-gray-500 text-center">
        {t('quickActions.hint')}
      </p>
    </div>
  );
}