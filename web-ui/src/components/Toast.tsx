// web-ui/src/components/Toast.tsx

import { useEffect } from 'react';

export interface ToastItem {
  id: string;
  content: string;
  category?: string;
  type?: 'memory' | 'warning';
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        toast.type === 'warning'
          ? <WarningToast key={toast.id} toast={toast} onDismiss={onDismiss} />
          : <MemoryToast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

interface MemoryToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

function MemoryToast({ toast, onDismiss }: MemoryToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const truncated = toast.content.length > 40
    ? toast.content.slice(0, 40) + '…'
    : toast.content;

  return (
    <div className="pointer-events-auto flex items-start gap-2 bg-indigo-950 border border-indigo-700 text-indigo-100 rounded-lg px-3 py-2.5 shadow-lg min-w-48 max-w-72 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <span className="text-sm mt-0.5 flex-shrink-0">💾</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-indigo-300">记忆已保存</div>
        <div className="text-xs text-indigo-200 mt-0.5 break-words">"{truncated}"</div>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 text-indigo-400 hover:text-indigo-200 transition-colors mt-0.5"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}

interface WarningToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

function WarningToast({ toast, onDismiss }: WarningToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const truncated = toast.content.length > 60
    ? toast.content.slice(0, 60) + '…'
    : toast.content;

  return (
    <div className="pointer-events-auto flex items-start gap-2 bg-amber-950 border border-amber-600 text-amber-100 rounded-lg px-3 py-2.5 shadow-lg min-w-48 max-w-80 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <span className="text-sm mt-0.5 flex-shrink-0">⚠️</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-amber-300">模型已自动切换</div>
        <div className="text-xs text-amber-200 mt-0.5 break-words">{truncated}</div>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 text-amber-400 hover:text-amber-200 transition-colors mt-0.5"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}
