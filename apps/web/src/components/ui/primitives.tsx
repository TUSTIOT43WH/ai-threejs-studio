import type { ReactNode } from 'react';
import { SparklesIcon, WarningIcon, XIcon } from './icons';

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] shadow-[0_10px_30px_rgba(45,212,191,0.12)]">
        <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true">
          <defs>
            <linearGradient id="brand-gradient" x1="3" y1="2" x2="29" y2="30">
              <stop stopColor="#5eead4" />
              <stop offset="0.55" stopColor="#818cf8" />
              <stop offset="1" stopColor="#f0abfc" />
            </linearGradient>
          </defs>
          <path
            d="M16 3.5 28 10v12L16 28.5 4 22V10L16 3.5Z"
            fill="none"
            stroke="url(#brand-gradient)"
            strokeWidth="1.6"
          />
          <path
            d="m16 9 7 4v7l-7 4-7-4v-7l7-4Z"
            fill="url(#brand-gradient)"
            opacity="0.9"
          />
          <path
            d="M16 9v8m7-4-7 4-7-4"
            fill="none"
            stroke="#080b10"
            strokeWidth="1.4"
          />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="font-display text-[15px] font-semibold tracking-tight text-white">
          AI Three.js Studio
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-white/38">
          World Forge
        </div>
      </div>
    </div>
  );
}

export function MockBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-200/20 bg-amber-200/[0.07] font-medium text-amber-100/90 ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
      }`}
      title="此内容来自本地 Mock Provider，不是真实 AI 生成结果"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-200/80" />
      MOCK 管线
    </span>
  );
}

export function WorldBadge({ mock }: { mock: boolean }) {
  return mock ? <MockBadge compact /> : (
    <span title="真实 AI 生成场景结构，由受信任的 Three.js 几何代码组装；不是图生 GLB 模型" className="inline-flex items-center rounded-full border border-mint-300/25 bg-mint-300/10 px-2 py-0.5 text-[10px] font-medium text-mint-200">
      AI 建模
    </span>
  );
}

export function PhaseBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] font-medium text-white/55">
      <SparklesIcon className="h-3 w-3 text-mint-300" />
      Phase 1 · MVP
    </span>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-white/20 border-t-white/80 ${className}`}
      aria-hidden="true"
    />
  );
}

export function ErrorBanner({
  message,
  onDismiss,
  className = '',
}: {
  message: string;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-3.5 py-3 text-[12px] leading-relaxed text-rose-100/90 ${className}`}
    >
      <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
      <span className="flex-1">{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="focus-ring rounded-md p-0.5 text-rose-200/60 transition hover:bg-white/10 hover:text-white"
          aria-label="关闭错误提示"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function SectionLabel({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/38">
        {children}
      </span>
      {action}
    </div>
  );
}
