import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { ChatSettings, ConceptImage, ImageSettings } from '@ai-three-studio/shared';
import { api, errorMessage, resolveMediaUrl } from '../lib/api';
import {
  STYLE_TONES,
} from '../lib/labels';
import { useStudioStore } from '../stores/studio-store';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CubeIcon,
  ImageIcon,
  LayersIcon,
  RefreshIcon,
  ShuffleIcon,
  SparklesIcon,
  WandIcon,
} from '../components/ui/icons';
import {
  BrandMark,
  ErrorBanner,
  MockBadge,
  Spinner,
} from '../components/ui/primitives';
import { WorldPromptDialog } from '../components/studio/WorldPromptDialog';

function ConceptCard({
  concept,
  selected,
  onSelect,
  index,
}: {
  concept: ConceptImage;
  selected: boolean;
  onSelect: () => void;
  index: number;
}) {
  const tone = STYLE_TONES[concept.styleId];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`focus-ring animate-rise group relative overflow-hidden rounded-2xl border text-left transition duration-300 ${
        selected
          ? 'border-mint-300/55 bg-[#0f1919] shadow-[0_0_0_1px_rgba(94,234,212,0.25),0_22px_60px_rgba(0,0,0,0.4)]'
          : 'border-white/[0.08] bg-[#0d1118]/75 hover:-translate-y-1 hover:border-white/20 hover:bg-[#111722]'
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
      aria-pressed={selected}
    >
      <div className="relative aspect-[16/10] overflow-hidden border-b border-white/[0.06] bg-[#0a0d12]">
        <img
          src={resolveMediaUrl(concept.imageUrl)}
          alt={concept.title}
          className={`h-full w-full object-cover transition duration-500 ${
            selected ? 'scale-[1.015]' : 'group-hover:scale-[1.025]'
          }`}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium backdrop-blur-md ${tone.chip}`}
          >
            <span
              className="h-1 w-1 rounded-full"
              style={{ backgroundColor: tone.dot }}
            />
            {concept.styleLabel}
          </span>
          <span className="rounded-full border border-white/10 bg-black/50 px-2 py-1 text-[9px] font-medium text-white/80 backdrop-blur-md">
            {concept.mock ? 'Mock 概念图' : 'AI 生成概念图'}
          </span>
        </div>
        <div
          className={`absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-md transition ${
            selected
              ? 'border-mint-300/60 bg-mint-300 text-[#06201d]'
              : 'border-white/20 bg-black/25 text-transparent group-hover:border-white/40'
          }`}
        >
          <CheckIcon className="h-3.5 w-3.5" />
        </div>
        <div className="absolute inset-x-3 bottom-3">
          <h3 className="text-[14px] font-semibold tracking-tight text-white drop-shadow-md">
            {concept.title}
          </h3>
        </div>
      </div>
      <div className="p-3.5">
        <p className="line-clamp-2 min-h-[34px] text-[11px] leading-[1.6] text-white/40">
          {concept.description}
        </p>
        <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2.5">
          <span className="text-[9px] uppercase tracking-[0.12em] text-white/25">
            Seed {concept.seed.toString(16).slice(-6)}
          </span>
          <span
            className={`text-[10px] font-medium transition ${
              selected ? 'text-mint-200/90' : 'text-white/25 group-hover:text-white/50'
            }`}
          >
            {selected ? '已选择' : '选择此方向'}
          </span>
        </div>
      </div>
    </button>
  );
}

export function ConceptsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const project = useStudioStore((state) => state.project);
  const loadProject = useStudioStore((state) => state.loadProject);
  const chooseConcept = useStudioStore((state) => state.chooseConcept);
  const generateConcepts = useStudioStore((state) => state.generateConcepts);
  const generateWorld = useStudioStore((state) => state.generateWorld);
  const projectLoading = useStudioStore((state) => state.projectLoading);
  const conceptsLoading = useStudioStore((state) => state.conceptsLoading);
  const worldGenerating = useStudioStore((state) => state.worldGenerating);
  const error = useStudioStore((state) => state.error);
  const clearError = useStudioStore((state) => state.clearError);
  const [hint, setHint] = useState<string | null>(null);
  const [promptDialog, setPromptDialog] = useState<{ conceptId: string; regenerate: boolean } | null>(null);
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [imageSettings, setImageSettings] = useState<ImageSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const worldJobStatus = useStudioStore((state) => state.worldJobStatus);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      Promise.all([api.getChatSettings(), api.getImageSettings()]).then(([value, images]) => {
        if (active) { setSettings(value); setImageSettings(images); setSettingsError(null); }
      }).catch((reason) => {
        if (active) { setSettings(null); setSettingsError(errorMessage(reason)); }
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    if (!project || project.id !== projectId) {
      void loadProject(projectId);
    }
  }, [projectId, project, loadProject]);

  const activeProject = project?.id === projectId ? project : null;
  const concepts = activeProject?.concepts ?? [];
  const selectedId = activeProject?.selectedConceptId ?? null;
  const selectedConcept =
    concepts.find((concept) => concept.id === selectedId) ?? null;
  const hasCurrentWorld = Boolean(
    activeProject?.world &&
      activeProject.world.source.conceptId === selectedId,
  );
  const requiresRealPreview = settings?.modelingEnabled === true && selectedConcept?.mock === true;
  // Completed analysis belongs to the world's source concept, not a newly selected card.
  const selectedAnalysis = hasCurrentWorld && selectedConcept && activeProject?.analysis &&
    !activeProject.analysis.mock && activeProject.analysis.modelingPrompt
    ? activeProject.analysis
    : null;
  const promptConcept = promptDialog
    ? concepts.find((concept) => concept.id === promptDialog.conceptId) ?? null
    : null;

  const handleMore = async () => {
    setHint(null);
    await generateConcepts('more');
  };

  const handleSimilar = async () => {
    if (!selectedId) {
      setHint('请先选择一张概念图，再生成相似方案。');
      return;
    }
    setHint(null);
    await generateConcepts('similar', selectedId);
  };

  const handlePrimary = async (regenerate = false) => {
    if (!selectedConcept) {
      setHint('请先选择一张概念图。');
      return;
    }
    setHint(null);
    if (hasCurrentWorld && !regenerate) {
      navigate(`/projects/${projectId}/studio`);
      return;
    }
    if (!settings) { setHint('请先读取 API 设置，或前往设置页检查连接。'); return; }
    if (requiresRealPreview) {
      setHint('所选图片是 Mock 占位图。请先启用图片 API 并生成、选择真实 PNG / JPEG 预览；不会为占位图调用付费建模或降级替代。');
      return;
    }
    if (settings.modelingEnabled) {
      setPromptDialog({ conceptId: selectedConcept.id, regenerate });
      return;
    }
    if (regenerate && !window.confirm('重新生成成功后将替换当前世界及其编辑。本次使用 Mock。失败将保留原世界。继续吗？')) return;
    const submitted = await generateWorld(selectedConcept.id, regenerate);
    if (submitted) setHint('建模任务已提交到后台。可以切换页面或刷新；完成后会提示，不会自动跳转。');
  };

  if (!activeProject) {
    if (projectLoading) {
      return (
        <div className="app-background flex min-h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-4 text-white/45">
            <Spinner className="h-7 w-7" />
            <span className="text-[12px]">正在载入概念方案…</span>
          </div>
        </div>
      );
    }
    return (
      <div className="app-background flex min-h-screen items-center justify-center px-6">
        <div className="panel w-full max-w-md rounded-2xl p-6 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
            <ImageIcon className="h-5 w-5 text-white/35" />
          </div>
          <h1 className="mt-4 text-[16px] font-medium text-white/80">
            无法打开这个项目
          </h1>
          <p className="mt-2 text-[12px] leading-6 text-white/35">
            {error ?? '项目可能已被清理，或链接不完整。'}
          </p>
          <Link
            to="/"
            className="focus-ring mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-[12px] font-semibold text-[#0a0d12]"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-background min-h-screen pb-32">
      <div className="dot-grid pointer-events-none fixed inset-0 opacity-[0.28]" />
      <header className="relative z-10 border-b border-white/[0.06] bg-[#07090d]/65 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-[1280px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-5">
            <Link to="/" className="focus-ring rounded-lg">
              <BrandMark />
            </Link>
            <div className="hidden h-4 w-px bg-white/10 sm:block" />
            <div className="hidden items-center gap-2 text-[11px] text-white/30 sm:flex">
              <span>概念方向</span>
              <span className="text-white/15">/</span>
              <span className="max-w-[240px] truncate text-white/55">
                {activeProject.expansion.sceneLabel}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {concepts.every((concept) => concept.mock) ? <MockBadge compact /> : <span className="text-[11px] text-mint-200">AI 概念预览</span>}
            <button
              type="button"
              onClick={() =>
                navigate('/', { state: { prompt: activeProject.prompt } })
              }
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] text-white/50 transition hover:border-white/15 hover:text-white/80"
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" />
              修改描述
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1280px] px-6 pt-9">
        <div className="animate-rise flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-mint-200/60">
              <SparklesIcon className="h-3 w-3" />
              Step 2 · Concept directions
            </div>
            <h1 className="mt-3 font-display text-[30px] font-semibold tracking-[-0.025em] text-white/92 sm:text-[36px]">
              选择一种世界的气质
            </h1>
            <p className="mt-2 max-w-[620px] text-[12px] leading-6 text-white/38">
              短描述先生成预览图。选中真实 PNG / JPEG 后，建模 API 先看图理解并结合原始描述扩写 Three.js 建模提示词，再由同一模型生成场景；经校验的程序化几何可预览与导出。图片与建模 API 独立配置，每张图标注实际来源。
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-white/28">
            <span className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1">
              Batch {String(activeProject.batchIndex + 1).padStart(2, '0')}
            </span>
            <span className="rounded-md border border-white/[0.07] bg-white/[0.025] px-2 py-1">
              {concepts.length} 张概念图
            </span>
          </div>
        </div>

        <div className="animate-rise stagger-1 panel mt-6 rounded-2xl p-4 sm:p-5">
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                <WandIcon className="h-4 w-4 text-mint-300/70" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.14em] text-white/28">
                  原始描述
                </div>
                <p className="mt-1 break-words text-[14px] text-white/78">
                  “{activeProject.prompt}”
                </p>
                <p className="mt-1 text-[10px] leading-5 text-white/40">
                  {selectedAnalysis ? '已保存所选预览的看图扩写结果，可展开查看建模提示词。' : '选图后，点击 AI 生成会先看图扩写并弹窗显示提示词；编辑并确认后才开始场景生成。Mock 建模不进行真实看图理解。'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {selectedAnalysis ? (
          <details key={selectedId} className="panel mt-4 min-w-0 rounded-2xl p-4 sm:p-5">
            <summary className="focus-ring cursor-pointer rounded text-xs font-medium text-mint-200">
              查看建模提示词
            </summary>
            <p className="mt-3 text-[11px] leading-5 text-white/45">所选预览的已保存扩写结果（只读），用于后续场景生成。如需修改，点击底部「用 AI 重新生成」，在弹窗中编辑并确认。</p>
            <pre tabIndex={0} aria-label="已保存的建模提示词（只读）" className="focus-ring mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.07] bg-black/25 p-4 font-sans text-xs leading-6 text-white/75">
              {selectedAnalysis.modelingPrompt}
            </pre>
            {selectedAnalysis.assumptions?.length ? (
              <div className="mt-4 text-[11px] leading-6 text-white/55">
                <h2 className="font-medium text-white/70">推断与假设</h2>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {selectedAnalysis.assumptions.map((assumption, index) => <li key={index} className="break-words">{assumption}</li>)}
                </ul>
              </div>
            ) : null}
            <p className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-6 text-white/45">
              {selectedAnalysis.disclaimer || '看图扩写可能包含对遮挡部分、尺寸与布局的推断；结果为程序化几何，不是真实摄影测量重建或图生 GLB。'}
            </p>
          </details>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-mint-300/15 bg-mint-300/[0.035] p-4 text-xs text-white/60">
          <span>{settings ? settings.modelingEnabled ? `AI 建模已启用 · ${settings.model} · 看图扩写后先确认可编辑提示词，再调用一次场景生成；均可能收费，不自动重试或降级` : 'Mock 建模模式 · 到 API 设置填写密钥并开启 AI 建模' : '正在读取建模设置…'}</span>
          <span className="text-[11px] text-white/45">{imageSettings?.enabled ? `图片 API · ${imageSettings.model}；换批/相似会按张调用并计费` : '图片 API 未启用，新图片使用明确标记的 Mock'}</span>
          <Link to="/settings" className="focus-ring rounded-md border border-white/10 px-3 py-1.5 text-mint-200">分别配置图片 / 建模 API</Link>
        </div>
        {requiresRealPreview ? (
          <p role="status" className="mt-4 rounded-xl border border-amber-200/15 bg-amber-200/[0.045] px-3.5 py-2.5 text-[11px] leading-6 text-amber-100/80">
            所选图片是 Mock 占位图，不能用于真实 AI 建模。请先在 API 设置启用图片生成，再点击「换一批」生成并选择真实 PNG / JPEG 预览。不会为占位图调用付费建模，也不会自动降级；已有世界仍可打开。
          </p>
        ) : null}
        {settingsError ? <ErrorBanner message={settingsError} className="mt-4" /> : null}
        {error ? (
          <ErrorBanner message={error} onDismiss={clearError} className="mt-4" />
        ) : null}
        {hint ? (
          <div className="mt-4 rounded-xl border border-amber-200/15 bg-amber-200/[0.045] px-3.5 py-2.5 text-[11px] text-amber-100/70">
            {hint}
          </div>
        ) : null}

        <div className="relative mt-6">
          {conceptsLoading ? (
            <div className="absolute inset-0 z-20 flex min-h-[320px] items-center justify-center rounded-2xl border border-white/[0.08] bg-[#07090d]/72 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <Spinner className="h-6 w-6" />
                <div className="text-[12px] text-white/55">
                  正在切换概念批次…
                </div>
                <div className="text-[10px] text-white/25">
                  {imageSettings?.enabled ? '正在调用独立图片 API，完成后展示新图片' : '正在生成本地 Mock 风格方案'}
                </div>
              </div>
            </div>
          ) : null}

          <div
            className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${
              conceptsLoading ? 'pointer-events-none opacity-45' : ''
            }`}
          >
            {concepts.map((concept, index) => (
              <ConceptCard
                key={concept.id}
                concept={concept}
                selected={concept.id === selectedId}
                onSelect={() => {
                  chooseConcept(concept.id);
                  setHint(null);
                }}
                index={index}
              />
            ))}

            <div className="animate-rise stagger-4 flex flex-col justify-between rounded-2xl border border-dashed border-white/[0.09] bg-white/[0.012] p-5">
              <div>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.025]">
                  <LayersIcon className="h-4 w-4 text-white/30" />
                </div>
                <h3 className="mt-4 text-[13px] font-medium text-white/65">
                  关于这一批方案
                </h3>
                <p className="mt-2 text-[10px] leading-5 text-white/30">
                  AI 图片来自所配置的图片服务；Mock 图片为程序化占位图，均单独标注。选中的真实 PNG / JPEG 将发送给建模 API 看图扩写，不会贴到平面上冒充 3D 模型。
                </p>
                <div className="mt-4 space-y-2">
                  {[
                    '不同构图角度',
                    '不同调色与光照',
                    '一致的世界元素语义',
                  ].map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-2 text-[10px] text-white/38"
                    >
                      <CheckIcon className="h-3 w-3 text-mint-300/55" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5 border-t border-white/[0.06] pt-3 text-[9px] leading-4 text-white/22">
                相似方案保留所选风格，其余批次会轮换风格与种子。
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.018] px-4 py-3 text-[10px] leading-5 text-white/28">
          <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/22" />
          <span>
            真实建模流程：选中 PNG / JPEG 生成预览 → 看图扩写建模提示词 → 确认并编辑提示词 → 同一模型结合预览图和提示词生成程序化几何与相机光照。图中遮挡、尺寸等内容可能由模型推断，不是真实摄影测量重建或图生 GLB。原始上传参考图仅保存、不参与分析。生成后可编辑各部件并导出 Three.js 模块。
          </span>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-[#080b10]/88 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            {selectedConcept ? (
              <>
                <div className="h-10 w-14 shrink-0 overflow-hidden rounded-lg border border-white/[0.1] bg-black/30">
                  <img
                    src={resolveMediaUrl(selectedConcept.imageUrl)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium text-white/72">
                    {selectedConcept.title}
                  </div>
                  <div className="mt-0.5 text-[9px] text-white/30">
                    {selectedConcept.styleLabel} · Seed{' '}
                    {selectedConcept.seed.toString(16).slice(-6)}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-white/35">
                <ImageIcon className="h-4 w-4" />
                选择一张概念图以继续
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleMore()}
              disabled={conceptsLoading || worldGenerating}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] px-3 py-2 text-[11px] text-white/55 transition hover:border-white/18 hover:bg-white/[0.04] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
              换一批
            </button>
            <button
              type="button"
              onClick={() => void handleSimilar()}
              disabled={!selectedId || conceptsLoading || worldGenerating}
              className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] px-3 py-2 text-[11px] text-white/55 transition hover:border-white/18 hover:bg-white/[0.04] hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ShuffleIcon className="h-3.5 w-3.5" />
              基于所选生成相似方案
            </button>
            {hasCurrentWorld || worldJobStatus === 'failed' ? (
              <button type="button" onClick={() => void handlePrimary(true)} disabled={!settings || !selectedConcept || conceptsLoading || worldGenerating || requiresRealPreview} className="focus-ring rounded-lg border border-mint-300/25 bg-mint-300/5 px-3 py-2 text-[11px] text-mint-200 disabled:opacity-40">
                {worldJobStatus === 'failed' ? '重试建模' : settings?.modelingEnabled ? '用 AI 重新生成' : '重新生成 Mock 世界'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handlePrimary()}
              disabled={!selectedConcept || conceptsLoading || worldGenerating || (!hasCurrentWorld && (!settings || requiresRealPreview))}
              className="focus-ring group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-mint-300 to-teal-200 px-4 py-2.5 text-[12px] font-semibold text-[#06201d] shadow-[0_10px_30px_rgba(45,212,191,0.16)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {hasCurrentWorld ? (
                <>
                  <CubeIcon className="h-4 w-4" />
                  打开已生成的 3D 世界
                  <ArrowRightIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </>
              ) : (
                <>
                  <CubeIcon className="h-4 w-4" />
                  {worldGenerating ? '建模已在后台运行' : settings?.modelingEnabled ? 'AI 生成 Three.js 模型' : '生成 Mock 3D 世界'}
                  <ArrowRightIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {promptDialog && promptConcept ? (
        <WorldPromptDialog
          projectId={activeProject.id}
          concept={promptConcept}
          regenerate={promptDialog.regenerate}
          hasCurrentWorld={hasCurrentWorld}
          onClose={() => setPromptDialog(null)}
          onGenerated={() => {
            setHint('建模任务已提交到后台。可以切换页面或刷新；完成后会提示，不会自动跳转。');
            setPromptDialog(null);
          }}
        />
      ) : null}

    </div>
  );
}
