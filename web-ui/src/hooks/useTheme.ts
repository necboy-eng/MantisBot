import { useState, useEffect, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme-preference';

/** 根据模式和系统偏好，计算实际应该应用的 dark class */
function resolveAppliedDark(mode: ThemeMode): boolean {
  if (mode === 'light') return false;
  if (mode === 'dark') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 将 dark class 同步写到 <html> 元素 */
function applyToDocument(dark: boolean) {
  if (dark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    return saved ?? 'system';
  });

  /** 持久化并立即应用主题 */
  const setTheme = useCallback((mode: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    setThemeState(mode);
    applyToDocument(resolveAppliedDark(mode));
  }, []);

  /** 循环切换：light → dark → system → light */
  const cycleTheme = useCallback(() => {
    setTheme(
      theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    );
  }, [theme, setTheme]);

  // 初始化时应用一次
  useEffect(() => {
    applyToDocument(resolveAppliedDark(theme));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 当 mode 为 system 时，监听系统偏好变化
  useEffect(() => {
    if (theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => applyToDocument(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  return { theme, setTheme, cycleTheme };
}
