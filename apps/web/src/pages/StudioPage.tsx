import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  OBJECT_KIND_COLORS,
  OBJECT_KIND_LABELS,
  SEASON_LABELS,
  TIME_LABELS,
  WEATHER_LABELS,
} from '../lib/labels';
import { useStudioStore } from '../stores/studio-store';
import { SceneViewport } from '../components/scene/SceneViewport';
import type { ViewMode } from '../components/scene/CharacterExplorer';
import { Inspector } from '../components/studio/Inspector';
import { LeftPanel } from '../components/studio/LeftPanel';
import { StudioTopbar } from '../components/studio/StudioTopbar';
import {
  ArrowRightIcon,
  FocusIcon,
  GridIcon,
  MaximizeIcon,
  MinimizeIcon,
  MouseIcon,
  WarningIcon,
} from '../components/ui/icons';
import {
  BrandMark,
  ErrorBanner,
  MockBadge,
  PhaseBadge,
  Spinner,
} from '../components/ui/primitives';

function StudioGate({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#07090d] text-white">
      <div className="pointer-events-none absolute inset-0 app-background opacity-60" />
      <div className="relative z-10 flex min-h-dvh flex-col">
        {children}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <StudioGate>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6">
        <BrandMark />
        <div className="flex items-center gap-2.5 text-[11px] text-white/35">
          <Spinner className="h-3.5 w-3.5" />
          正在载入项目与 World Schema…
        </div>
      </div>
    </StudioGate>
  );
}

function MissingState({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <StudioGate>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.025] p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-rose-300/15 bg-rose-300/[0.06]">
            <WarningIcon className="h-5 w-5 text-rose-200/60" />
          </div>
          <h1 className="mt-4 text-sm font-medium text-white/80">
            无法载入这个项目
          </h1>
          <p className="mt-2 text-[11px] leading-5 text-white/35">
            {error ?? '项目不存在，或已被移除。'}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="focus-ring rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-[11px] text-white/65 transition hover:bg-white/[0.07]"
            >
              重试
            </button>
            <Link
              to="/"
              className="focus-ring rounded-lg bg-gradient-to-r from-mint-300 to-teal-200 px-3 py-2 text-[11px] font-semibold text-[#06201d]"
            >
              返回首页
            </Link>
          </div>
          <p className="mt-5 text-[9px] leading-4 text-white/20">
            请确认 API 服务运行在 4000 端口，或检查 VITE_API_BASE_URL 配置。
          </p>
        </div>
      </div>
    </StudioGate>
  );
}

function NoWorldState({
  onSelectConcept,
}: {
  onSelectConcept: () => void;
}) {
  return (
    <StudioGate>
      <StudioTopbar />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#0b0f15]/85 p-7 text-center shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-mint-300/15 bg-mint-300/[0.05]">
            <GridIcon className="h-5 w-5 text-mint-200/55" />
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <h1 className="text-base font-medium text-white/85">
              还没有 3D 世界
            </h1>
            <MockBadge compact />
          </div>
          <p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-white/35">
            这个项目已生成概念图，但尚未选择方案并构建世界。回到概念图页面选择一张图，即可生成可编辑的 Three.js 场景。
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link
              to="/"
              className="focus-ring rounded-lg border border-white/[0.09] px-3.5 py-2 text-[11px] text-white/45 transition hover:text-white/75"
            >
              返回首页
            </Link>
            <button
              type="button"
              onClick={onSelectConcept}
              className="focus-ring inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-mint-300 to-teal-200 px-4 py-2 text-[11px] font-semibold text-[#06201d] shadow-[0_10px_30px_rgba(45,212,191,0.18)] transition hover:brightness-105"
            >
              去选择概念图
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-5 flex justify-center">
            <PhaseBadge />
          </div>
        </div>
      </div>
    </StudioGate>
  );
}

function ViewerOverlay({
  fullscreen,
  onToggleFullscreen,
  viewMode,
  onViewModeChange,
  onRespawn,
  controlActive,
}: {
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onRespawn: () => void;
  controlActive: boolean;
}) {
  const world = useStudioStore((state) => state.world);
  const selectedObjectId = useStudioStore((state) => state.selectedObjectId);
  const gridVisible = useStudioStore((state) => state.gridVisible);
  const toggleGrid = useStudioStore((state) => state.toggleGrid);
  const resetCamera = useStudioStore((state) => state.resetCamera);
  const selectedObject =
    world?.objects.find((object) => object.id === selectedObjectId) ?? null;

  if (!world) return null;
  const environment = world.environment;

  const controlClass =
    'focus-ring pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-black/40 text-white/50 backdrop-blur-md transition hover:border-white/20 hover:bg-black/60 hover:text-white/85';

  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 self-start rounded-md border border-white/10 bg-black/40 px-2 py-1 backdrop-blur-md">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-300/60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint-300" />
          </span>
          <span className="text-[9px] tracking-wide text-white/55">
            实时 3D 预览
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span className="text-[8px] text-white/28">{world.meta.mock ? 'Mock 场景' : 'AI 建模场景'}</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <span className="rounded border border-white/[0.08] bg-black/30 px-1.5 py-0.5 text-[8px] text-white/45 backdrop-blur-md">
            {SEASON_LABELS[environment.season]}
          </span>
          <span className="rounded border border-white/[0.08] bg-black/30 px-1.5 py-0.5 text-[8px] text-white/45 backdrop-blur-md">
            {WEATHER_LABELS[environment.weather]}
          </span>
          <span className="rounded border border-white/[0.08] bg-black/30 px-1.5 py-0.5 text-[8px] text-white/45 backdrop-blur-md">
            {TIME_LABELS[environment.timeOfDay]}
          </span>
        </div>
      </div>

      <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggleGrid}
          className={`${controlClass} ${
            gridVisible ? 'border-mint-300/30 text-mint-200/80' : ''
          }`}
          title={gridVisible ? '隐藏网格' : '显示网格'}
          aria-label={gridVisible ? '隐藏网格' : '显示网格'}
        >
          <GridIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={resetCamera}
          className={controlClass}
          title="重置相机"
          aria-label="重置相机"
        >
          <FocusIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          className={controlClass}
          title={fullscreen ? '退出全屏' : '全屏预览'}
          aria-label={fullscreen ? '退出全屏' : '全屏预览'}
        >
          {fullscreen ? (
            <MinimizeIcon className="h-3.5 w-3.5" />
          ) : (
            <MaximizeIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="absolute left-3 top-20 z-20 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-1 rounded-lg border border-white/10 bg-black/55 p-1 backdrop-blur-md" aria-label="视角模式">
        {([
          ['edit', '编辑视角'],
          ['third-person', '第三人称漫游'],
        ] as const).map(([mode, label]) => (
          <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => onViewModeChange(mode)} className={`focus-ring rounded-md px-2 py-1.5 text-[10px] transition ${viewMode === mode ? 'bg-mint-300/20 text-mint-200' : 'text-white/55 hover:bg-white/10 hover:text-white'}`}>
            {label}
          </button>
        ))}
        {viewMode !== 'edit' ? (
          <button type="button" onClick={onRespawn} className="focus-ring rounded-md px-2 py-1.5 text-[10px] text-white/55 hover:bg-white/10">回到出生点</button>
        ) : null}
      </div>
      {viewMode !== 'edit' ? (
        <>
          <div className="pointer-events-none absolute left-3 top-[132px] z-20 max-w-[calc(100%-24px)] rounded-md bg-black/50 px-2.5 py-2 text-[10px] leading-5 text-white/65 backdrop-blur-md">
            {controlActive ? 'WASD / 方向键移动 · Shift 奔跑 · 空格跳跃 · R 重生' : '点击场景开始操作角色；侧栏输入时暂停移动'}
            <br />鼠标转向 · Esc 释放鼠标；若无法锁定鼠标，可按住左键拖动转向
          </div>
        </>
      ) : null}

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 hidden items-center gap-2 rounded-md border border-white/[0.08] bg-black/40 px-2.5 py-1.5 backdrop-blur-md sm:flex">
        <MouseIcon className="h-3 w-3 text-white/30" />
        <span className="text-[8px] text-white/40">
          {viewMode === 'edit' ? '拖拽旋转 · 滚轮缩放 · 右键平移' : '角色漫游 · 胶囊碰撞 · 自动跨小台阶'}
        </span>
        <span className="h-3 w-px bg-white/10" />
        <span className="text-[8px] text-white/28">{viewMode === 'edit' ? '点击物体编辑' : '返回编辑视角可选中物体'}</span>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 z-20">
        {selectedObject ? (
          <div className="flex max-w-[240px] items-center gap-2 rounded-md border border-mint-300/20 bg-black/50 px-2.5 py-1.5 backdrop-blur-md">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                backgroundColor: OBJECT_KIND_COLORS[selectedObject.kind],
              }}
            />
            <span className="truncate text-[9px] text-white/70">
              {selectedObject.name}
            </span>
            <span className="shrink-0 text-[8px] text-mint-200/50">
              {OBJECT_KIND_LABELS[selectedObject.kind]}
            </span>
          </div>
        ) : (
          <div className="rounded-md border border-white/[0.07] bg-black/35 px-2.5 py-1.5 text-[8px] text-white/28 backdrop-blur-md">
            未选中对象 · 点击场景中的独立物体
          </div>
        )}
      </div>
    </>
  );
}

export function StudioPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const project = useStudioStore((state) => state.project);
  const world = useStudioStore((state) => state.world);
  const projectLoading = useStudioStore((state) => state.projectLoading);
  const error = useStudioStore((state) => state.error);
  const clearError = useStudioStore((state) => state.clearError);
  const loadProject = useStudioStore((state) => state.loadProject);
  const selectedObjectId = useStudioStore((state) => state.selectedObjectId);
  const selectObject = useStudioStore((state) => state.selectObject);
  const gridVisible = useStudioStore((state) => state.gridVisible);
  const cameraToken = useStudioStore((state) => state.cameraToken);
  const navigate = useNavigate();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [respawnToken, setRespawnToken] = useState(0);
  const [controlActive, setControlActive] = useState(false);
  const [exportToken, setExportToken] = useState(0);
  const [exportMessage, setExportMessage] = useState('');

  const currentProject = project?.id === projectId ? project : null;

  useEffect(() => {
    if (!project || project.id !== projectId) {
      void loadProject(projectId);
    }
    // The project is intentionally not a dependency: loading it updates the
    // store and must not retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === viewportRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (viewportRef.current) {
        await viewportRef.current.requestFullscreen();
      }
    } catch {
      setFullscreen(false);
    }
  };

  if (!currentProject) {
    if (projectLoading) return <LoadingState />;
    return (
      <MissingState
        error={error}
        onRetry={() => void loadProject(projectId)}
      />
    );
  }

  if (!world) {
    return (
      <NoWorldState
        onSelectConcept={() => navigate(`/projects/${projectId}/concepts`)}
      />
    );
  }

  return (
    <div className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-[#07090d] text-white">
      <div className="pointer-events-none absolute inset-0 app-background opacity-40" />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <StudioTopbar onExport={() => { setExportMessage(''); setExportToken((value) => value + 1); }} />
        {exportMessage ? (
          <div role="status" className="flex items-center justify-between gap-3 border-b border-mint-300/15 bg-[#10201d] px-4 py-2 text-[11px] text-mint-100">
            <span>{exportMessage}</span>
            <button type="button" onClick={() => setExportMessage('')} className="focus-ring rounded px-2 py-1">关闭</button>
          </div>
        ) : null}

        {error ? (
          <div className="pointer-events-auto fixed left-1/2 top-[68px] z-[60] w-[min(92vw,520px)] -translate-x-1/2 animate-fade">
            <ErrorBanner message={error} onDismiss={clearError} />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-2 lg:overflow-hidden">
          <div className="grid min-h-0 gap-2 lg:h-full lg:grid-cols-[264px_minmax(0,1fr)_330px] xl:grid-cols-[282px_minmax(0,1fr)_346px]">
            <div className="h-[380px] min-h-0 lg:h-full">
              <LeftPanel />
            </div>

            <div
              ref={viewportRef}
              className="relative flex h-[58vh] min-h-[430px] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a0d12] shadow-[0_24px_80px_rgba(0,0,0,0.45)] lg:h-full lg:min-h-0"
            >
              <div className="absolute inset-0">
                <SceneViewport
                  world={world}
                  selectedObjectId={selectedObjectId}
                  onSelectObject={selectObject}
                  gridVisible={gridVisible}
                  resetToken={cameraToken}
                  viewMode={viewMode}
                  respawnToken={respawnToken}
                  onControlActive={setControlActive}
                  exportToken={exportToken}
                  onExportResult={setExportMessage}
                />
              </div>
              <ViewerOverlay
                fullscreen={fullscreen}
                onToggleFullscreen={() => void toggleFullscreen()}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                onRespawn={() => setRespawnToken((token) => token + 1)}
                controlActive={controlActive}
              />
            </div>

            <div className="h-[660px] min-h-0 lg:h-full">
              <Inspector />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
