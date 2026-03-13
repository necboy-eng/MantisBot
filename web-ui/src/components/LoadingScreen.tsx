import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface LoadingScreenProps {
  status: 'checking' | 'initializing' | 'reconnecting' | 'loadingApp';
  retryCount?: number;
}

export function LoadingScreen({ status, retryCount = 0 }: LoadingScreenProps) {
  const { t } = useTranslation();
  const [dots, setDots] = useState('');

  // Animate dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const statusText = status === 'checking'
    ? t('backend.checking')
    : status === 'initializing'
      ? t('backend.initializing')
      : status === 'loadingApp'
        ? t('backend.loadingApp')
        : t('backend.reconnecting');

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex items-center justify-center overflow-hidden">
      {/* Animated grid background */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(56, 189, 248, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(56, 189, 248, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
          animation: 'grid-move 20s linear infinite',
        }} />
      </div>

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-sky-400 rounded-full opacity-60"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `float ${3 + Math.random() * 4}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 2}s`,
            }}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="relative flex flex-col items-center">
        {/* Hexagon loader */}
        <div className="relative w-32 h-32 mb-8">
          {/* Outer ring */}
          <div className="absolute inset-0 rounded-full border-2 border-sky-500/30 animate-spin" style={{ animationDuration: '3s' }} />

          {/* Middle ring */}
          <div className="absolute inset-2 rounded-full border border-sky-400/40 animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }} />

          {/* Inner ring */}
          <div className="absolute inset-4 rounded-full border border-sky-300/50 animate-spin" style={{ animationDuration: '1.5s' }} />

          {/* Core pulse */}
          <div className="absolute inset-8 rounded-full bg-gradient-to-br from-sky-400 to-cyan-300 animate-pulse" />

          {/* Center dot */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-4 h-4 rounded-full bg-white shadow-lg shadow-sky-400/50" />
          </div>

          {/* Orbiting dots */}
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-full bg-sky-400"
              style={{
                top: '50%',
                left: '50%',
                transform: `rotate(${i * 90}deg) translateX(56px) translateY(-50%)`,
                animation: `orbit 2s linear infinite`,
                animationDelay: `${i * 0.5}s`,
              }}
            />
          ))}
        </div>

        {/* Logo/Brand */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-cyan-300 to-sky-400 bg-clip-text text-transparent tracking-wider">
            MANTISBOT
          </h1>
          <div className="mt-1 text-xs text-sky-400/60 tracking-[0.3em] uppercase">
            Intelligent Office OS
          </div>
        </div>

        {/* Status text */}
        <div className="flex items-center gap-3 text-sky-300/80">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-sky-400"
                style={{
                  animation: 'pulse 1s ease-in-out infinite',
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            ))}
          </div>
          <span className="text-sm font-mono">
            {statusText}{dots}
            {retryCount > 0 && <span className="ml-2 text-sky-400/60">({retryCount})</span>}
          </span>
        </div>

        {/* Progress bar simulation */}
        <div className="mt-6 w-48 h-1 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 rounded-full"
            style={{
              animation: 'loading-bar 2s ease-in-out infinite',
            }}
          />
        </div>
      </div>

      {/* Corner decorations */}
      <div className="absolute top-4 left-4 text-sky-500/30 font-mono text-xs">
        <div>SYSTEM BOOT</div>
        <div className="text-sky-400/20">v{__APP_VERSION__}</div>
      </div>

      <div className="absolute bottom-4 right-4 text-sky-500/30 font-mono text-xs text-right">
        <div className="text-sky-400/40">{'<'}/{'> NEURAL LINK'}</div>
      </div>

      {/* Scan line effect */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(transparent 50%, rgba(56, 189, 248, 0.02) 50%)',
          backgroundSize: '100% 4px',
          animation: 'scan 8s linear infinite',
        }}
      />

      {/* CSS Animations */}
      <style>{`
        @keyframes grid-move {
          0% { transform: translate(0, 0); }
          100% { transform: translate(50px, 50px); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.6; }
          50% { transform: translateY(-20px) scale(1.2); opacity: 1; }
        }
        @keyframes orbit {
          0% { transform: rotate(0deg) translateX(56px) translateY(-50%); }
          100% { transform: rotate(360deg) translateX(56px) translateY(-50%); }
        }
        @keyframes loading-bar {
          0% { width: 0%; transform: translateX(0); }
          50% { width: 70%; }
          100% { width: 100%; transform: translateX(0); }
        }
        @keyframes scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
      `}</style>
    </div>
  );
}