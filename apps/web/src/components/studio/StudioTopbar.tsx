import { useNavigate } from 'react-router-dom';
import { useStudioStore } from '../../stores/studio-store';
import {
  ArrowLeftIcon,
  CheckIcon,
  SaveIcon,
  WarningIcon,
} from '../ui/icons';
import { BrandMark, WorldBadge, Spinner } from '../ui/primitives';

const STATUS_COPY: Record<
  ReturnType<typeof useStudioStore.getState>['saveState'],
  { label: string; className: string }
> = {
  idle: { label: '已载入', className: 'text-white/28' },
  dirty: { label: '有未保存修改', className: 'text-amber-200/65' },
  saving: { label: '正在写入…', className: 'text-mint-200/75' },
  saved: { label: '已保存', className: 'text-mint-200/75' },
  error: { label: '保存失败', className: 'text-rose-300/75' },
};

export function StudioTopbar({ onExport }: { onExport?: () => void }) {
  const navigate = useNavigate();
  const project = useStudioStore((state) => state.project);
  const world = useStudioStore((state) => state.world);
  const saveState = useStudioStore((state) => state.saveState);
  const saveWorld = useStudioStore((state) => state.saveWorld);

  const worldGenerating = useStudioStore((state) => state.worldGenerating);
  const canSave = !worldGenerating && (saveState === 'dirty' || saveState === 'error');
  const status = STATUS_COPY[saveState];

  const goSettings = () => {
    if (saveState === 'saving') return;
    if (saveState === 'dirty' || saveState === 'error') {
      if (!window.confirm('当前世界有未保存的修改，离开后可能丢失。请先保存世界，或确认继续前往 API 设置。')) return;
    }
    navigate('/settings');
  };

  const goBack = () => {
    if (saveState === 'dirty' || saveState === 'error') {
      const proceed = window.confirm(
        '当前世界有未保存的修改，离开后这些修改会丢失。确定返回概念图选择吗？',
      );
      if (!proceed) return;
    }
    navigate(`/projects/${project?.id}/concepts`);
  };

  return (
    <header className="relative z-30 flex min-h-[58px] shrink-0 flex-wrap items-center justify-between gap-3 py-2 border-b border-white/[0.07] bg-[#080b10]/90 px-3 backdrop-blur-xl sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <BrandMark />
        <div className="hidden h-8 w-px bg-white/[0.07] md:block" />
        <div className="hidden min-w-0 md:block">
          <div className="flex items-center gap-2">
            <span className="max-w-[260px] truncate text-[12px] font-medium text-white/75">
              {world?.title ?? project?.expansion.sceneLabel ?? '未命名世界'}
            </span>
            <WorldBadge mock={world?.meta.mock ?? true} />
          </div>
          <div className="mt-0.5 max-w-[300px] truncate text-[10px] text-white/28">
            {project?.prompt ?? '加载中…'}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onExport && world ? (
          <button type="button" onClick={onExport} title="导出当前编辑预览为静态 Three.js 模块，不含角色控制和天气动画" className="focus-ring rounded-lg border border-mint-300/20 bg-mint-300/5 px-2.5 py-1.5 text-[11px] text-mint-200 hover:bg-mint-300/10">
            导出 Three.js
          </button>
        ) : null}
        <div className="mr-1 hidden items-center gap-2 text-[10px] lg:flex">
          {saveState === 'saving' ? (
            <Spinner className="h-3 w-3" />
          ) : saveState === 'saved' ? (
            <CheckIcon className="h-3.5 w-3.5 text-mint-300/70" />
          ) : saveState === 'error' ? (
            <WarningIcon className="h-3.5 w-3.5 text-rose-300/70" />
          ) : (
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                saveState === 'dirty' ? 'bg-amber-200/70' : 'bg-white/20'
              }`}
            />
          )}
          <span className={status.className}>{status.label}</span>
        </div>

        <button
          type="button"
          onClick={goSettings}
          disabled={saveState === 'saving'}
          className="focus-ring rounded-lg border border-mint-300/20 px-2.5 py-1.5 text-[11px] text-mint-200/75 transition hover:bg-mint-300/5 disabled:opacity-40"
        >
          API 设置
        </button>

        <button
          type="button"
          onClick={goBack}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] text-white/48 transition hover:border-white/16 hover:bg-white/[0.04] hover:text-white/80"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">概念图</span>
        </button>

        <button
          type="button"
          onClick={() => void saveWorld()}
          disabled={!canSave}
          className={`focus-ring inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
            canSave
              ? 'bg-gradient-to-r from-mint-300 to-teal-200 text-[#06201d] shadow-[0_8px_24px_rgba(45,212,191,0.16)] hover:brightness-105'
              : saveState === 'saved'
                ? 'border border-mint-300/20 bg-mint-300/[0.06] text-mint-200/70'
                : 'cursor-not-allowed border border-white/[0.07] bg-white/[0.025] text-white/28'
          }`}
        >
          {saveState === 'saving' ? (
            <Spinner className="h-3.5 w-3.5 border-[#06201d]/30 border-t-[#06201d]" />
          ) : saveState === 'saved' ? (
            <CheckIcon className="h-3.5 w-3.5" />
          ) : (
            <SaveIcon className="h-3.5 w-3.5" />
          )}
          {saveState === 'saving'
            ? '保存中'
            : saveState === 'saved'
              ? '已保存'
              : saveState === 'error'
                ? '重试保存'
                : '保存世界'}
        </button>
      </div>
    </header>
  );
}
