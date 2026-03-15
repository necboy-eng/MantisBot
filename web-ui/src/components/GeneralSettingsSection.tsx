// web-ui/src/components/GeneralSettingsSection.tsx
// 通用设置页：聚合 Office 预览服务器、Firecrawl 等系统级配置

import { useState } from 'react';
import { OfficePreviewSettingsSection } from './OfficePreviewSettingsSection';
import { FirecrawlSettingsSection } from './FirecrawlSettingsSection';

type GeneralSubTab = 'office-preview' | 'firecrawl';

const SUB_TABS: { id: GeneralSubTab; label: string }[] = [
  { id: 'office-preview', label: 'Office 预览' },
  { id: 'firecrawl',      label: 'Firecrawl'   },
];

export function GeneralSettingsSection() {
  const [subTab, setSubTab] = useState<GeneralSubTab>('office-preview');

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* 子 Tab 导航 */}
      <div className="px-6 pt-3 pb-0 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex gap-5">
          {SUB_TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setSubTab(id)}
              className={`pb-2.5 text-xs font-medium border-b-2 transition-colors ${
                subTab === id
                  ? 'text-primary-600 border-primary-500'
                  : 'text-gray-400 dark:text-gray-500 border-transparent hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 子内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {subTab === 'office-preview' && <OfficePreviewSettingsSection />}
        {subTab === 'firecrawl'      && <FirecrawlSettingsSection />}
      </div>
    </div>
  );
}
