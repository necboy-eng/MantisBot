import { useState, useEffect, useCallback } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ScrollButtonsProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

export function ScrollButtons({ scrollContainerRef }: ScrollButtonsProps) {
  const { t } = useTranslation();
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // 检查滚动位置
  const checkScrollPosition = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const threshold = 50;

    // 内容是否超出可视区域
    const hasScrollableContent = scrollHeight > clientHeight + threshold;

    // 距离顶部超过阈值时显示回到顶部按钮
    setShowScrollTop(hasScrollableContent && scrollTop > threshold);

    // 距离底部超过阈值时显示滚动到底部按钮
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollBottom(hasScrollableContent && distanceToBottom > threshold);
  }, [scrollContainerRef]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // 初始检查
    const initialCheck = setTimeout(checkScrollPosition, 200);

    // 滚动事件监听
    const handleScroll = () => checkScrollPosition();
    container.addEventListener('scroll', handleScroll, { passive: true });

    // 内容变化监听
    const mutationObserver = new MutationObserver(() => {
      setTimeout(checkScrollPosition, 50);
    });
    mutationObserver.observe(container, { childList: true, subtree: true });

    // 容器大小变化监听
    const resizeObserver = new ResizeObserver(() => checkScrollPosition());
    resizeObserver.observe(container);

    return () => {
      clearTimeout(initialCheck);
      container.removeEventListener('scroll', handleScroll);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [checkScrollPosition, scrollContainerRef]);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollContainerRef]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [scrollContainerRef]);

  // 两个按钮都不显示则不渲染
  if (!showScrollTop && !showScrollBottom) return null;

  return (
    <div className="absolute right-3 bottom-3 flex flex-col gap-2 z-10">
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          title={t('scroll.scrollToTop', '回到顶部')}
          className="w-10 h-10 rounded-full bg-white/90 dark:bg-gray-800/90 shadow-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 hover:text-primary-500 dark:hover:text-primary-400 transition-all duration-200 hover:scale-110 cursor-pointer backdrop-blur-sm"
        >
          <ChevronUp className="w-5 h-5" />
        </button>
      )}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          title={t('scroll.scrollToBottom', '滚动到底部')}
          className="w-10 h-10 rounded-full bg-white/90 dark:bg-gray-800/90 shadow-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 hover:text-primary-500 dark:hover:text-primary-400 transition-all duration-200 hover:scale-110 cursor-pointer backdrop-blur-sm"
        >
          <ChevronDown className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}