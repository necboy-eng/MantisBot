import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemeMode } from '../hooks/useTheme';

const ICONS: Record<ThemeMode, React.ElementType> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const TITLES: Record<ThemeMode, string> = {
  light: '当前：亮色模式，点击切换为暗色',
  dark: '当前：暗色模式，点击切换为跟随系统',
  system: '当前：跟随系统，点击切换为亮色',
};

export function ThemeSwitcher() {
  const { theme, cycleTheme } = useTheme();
  const Icon = ICONS[theme];

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-colors"
      title={TITLES[theme]}
      aria-label={TITLES[theme]}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
