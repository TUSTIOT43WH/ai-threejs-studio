import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '@ai-three-studio/shared';
import { api, errorMessage, resolveMediaUrl } from '../lib/api';
import { formatRelativeTime } from '../lib/labels';
import { useMeta } from '../hooks/use-meta';
import { useStudioStore } from '../stores/studio-store';
import {
  ArrowRightIcon,
  CubeIcon,
  ImageIcon,
  LayersIcon,
  RefreshIcon,
  SparklesIcon,
  UploadIcon,
  WandIcon,
  XIcon,
} from '../components/ui/icons';
import {
  BrandMark,
  ErrorBanner,
  PhaseBadge,
  Spinner,
} from '../components/ui/primitives';

const EXAMPLES = [
  '林中小屋',
  '赛博朋克城市',
  '黄昏的海边小镇',
  '雪山营地',
  '春日林间空地',
  '雾中的霓虹小巷',
];

const PIPELINE_STAGES = [
  {
    index: '01',
    label: '短描述生成预览图',
    name: 'Concept Image Generator',
    kind: 'image' as const,
  },
  {
    index: '02',
    label: '选择真实 PNG / JPEG 预览',
    name: '所选生成图将发送给建模 API',
    kind: 'selection' as const,
  },
  {
    index: '03',
    label: '看图理解并扩写建模提示词',
    name: 'Image Analyzer',
    kind: 'vision' as const,
  },
  {
    index: '04',
    label: '同一建模模型生成场景',
    name: 'World Planner',
    kind: 'world-planner' as const,
  },
  {
    index: '05',
    label: '校验结构并组装 Three.js 场景',
    name: 'Scene Builder',
    kind: 'runtime' as const,
  },
];

const ROADMAP = [
  {
    phase: 'Phase 1',
    title: '可运行的创作链路',
    description:
      '短描述生成五种风格预览、选图后看图扩写、World Schema 与程序化 3D 实时预览。',
    active: true,
  },
  {
    phase: 'Phase 2',
    title: '真实 AI 生成',
    description:
      '独立文生图 API、同一建模模型两次调用完成看图扩写与场景生成、后台任务与 Three.js 导出；非图生 GLB。',
    active: true,
  },
  {
    phase: 'Phase 3',
    title: '角色与动态环境',
    description:
      '已支持 Rapier 角色、第三人称跟随、WASD 移动与跳跃；继续完善动态环境。',
    active: true,
  },
  {
    phase: 'Phase 4',
    title: '编辑与游戏生成',
    description:
      '自然语言增量编辑、游戏逻辑模板，以及在受限沙箱中编译与测试生成代码。',
    active: false,
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const meta = useMeta();
  const setProject = useStudioStore((state) => state.setProject);

  const prefill = (location.state as { prompt?: string } | null)?.prompt ?? '';
  const [prompt, setPrompt] = useState(prefill);
  const [reference, setReference] = useState<{
    dataUrl: string;
    fileName: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ProjectSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadHistory = () => {
    setHistoryLoading(true);
    setHistoryError(null);
    api
      .listProjects()
      .then((response) => setHistory(response.projects))
      .catch((reason: unknown) => setHistoryError(errorMessage(reason)))
      .finally(() => setHistoryLoading(false));
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('参考图只支持 PNG / JPEG / WebP 格式。');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError('参考图请控制在 3MB 以内。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReference({ dataUrl: reader.result, fileName: file.name });
        setError(null);
      }
    };
    reader.onerror = () => setError('读取参考图失败，请重试。');
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (submitting) return;
    if (prompt.trim().length < 2) {
      setError('请输入至少 2 个字符的场景描述。');
      inputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.createProject({
        prompt: prompt.trim(),
        referenceImageDataUrl: reference?.dataUrl,
        referenceFileName: reference?.fileName,
      });
      setProject(response.project);
      navigate(`/projects/${response.project.id}/concepts`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  };

  const openProject = (project: ProjectSummary) => {
    navigate(
      `/projects/${project.id}/${project.hasWorld ? 'studio' : 'concepts'}`,
    );
  };

  return (
    <div className="app-background min-h-screen overflow-x-hidden">
      <div className="dot-grid pointer-events-none fixed inset-0 opacity-[0.35]" />
      <div className="pointer-events-none fixed left-1/2 top-[-260px] h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-mint-400/[0.055] blur-[120px]" />

      <div className="relative mx-auto max-w-[1200px] px-6 pb-16">
        <header className="flex h-[76px] items-center justify-between border-b border-white/[0.06]">
          <BrandMark />
          <div className="flex items-center gap-2.5">
            <nav className="mr-2 hidden items-center gap-6 text-[12px] text-white/45 md:flex">
              <a className="transition hover:text-white/85" href="#composer">
                创作台
              </a>
              <a className="transition hover:text-white/85" href="#pipeline">
                技术管线
              </a>
              <a className="transition hover:text-white/85" href="#history">
                历史项目
              </a>
            </nav>
            <Link to="/settings" className="focus-ring rounded-lg border border-mint-300/20 px-3 py-1.5 text-[11px] text-mint-200/80 transition hover:bg-mint-300/5">API 设置</Link>
            <PhaseBadge />
            <span className="text-[10px] text-mint-200/75">图片 / 建模 API 独立配置</span>
          </div>
        </header>

        <main>
          <section className="relative grid gap-10 pb-10 pt-14 lg:grid-cols-[1.08fr_0.92fr] lg:gap-12 lg:pt-20">
            <div className="animate-rise">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-mint-300/20 bg-mint-300/[0.06] px-3 py-1.5 text-[11px] font-medium text-mint-200/90">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint-300 opacity-50" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint-300" />
                </span>
                从一句话到可探索、可编辑的 3D 世界
              </div>

              <h1 className="font-display text-[42px] font-semibold leading-[1.12] tracking-[-0.035em] text-white sm:text-[56px]">
                把一句话，
                <br />
                变成
                <span className="text-gradient"> 可以走进去的世界。</span>
              </h1>

              <p className="mt-6 max-w-[560px] text-[14px] leading-7 text-white/48">
                AI Three.js Studio
                先将简短描述生成预览图。选定真实预览后，建模模型看图扩写提示词，再由同一模型生成经校验的 World
                Schema 与实时 Three.js 场景。无需手动建模，也无需复杂提示词。
              </p>

              <div
                id="composer"
                className="panel mt-8 rounded-[22px] p-2 shadow-[0_30px_80px_rgba(0,0,0,0.35)]"
              >
                <form onSubmit={handleSubmit}>
                  <div className="rounded-[16px] border border-white/[0.055] bg-black/25 p-4 sm:p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white/35">
                        <WandIcon className="h-3.5 w-3.5 text-mint-300/80" />
                        描述你的世界
                      </div>
                      <span className="text-[10px] tabular-nums text-white/25">
                        {prompt.length} / 600
                      </span>
                    </div>

                    <textarea
                      ref={inputRef}
                      value={prompt}
                      onChange={(event) => {
                        setPrompt(event.target.value.slice(0, 600));
                        setError(null);
                      }}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                          void handleSubmit();
                        }
                      }}
                      rows={3}
                      placeholder="例如：清晨林间的小屋，湖边有一条木栈道，远处有薄雾…"
                      className="focus-ring w-full resize-none bg-transparent text-[15px] leading-7 text-white/90 placeholder:text-white/24"
                    />

                    {reference ? (
                      <div className="mb-3 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2 pr-3">
                        <img
                          src={reference.dataUrl}
                          alt="参考图预览"
                          className="h-11 w-11 rounded-lg object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] text-white/75">
                            {reference.fileName}
                          </div>
                          <div className="mt-0.5 text-[10px] text-white/35">
                            上传参考图仅保存，不参与生成或看图理解；建模使用后续选中的生成预览图
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setReference(null)}
                          className="focus-ring rounded-md p-1 text-white/35 transition hover:bg-white/10 hover:text-white"
                          aria-label="移除参考图"
                        >
                          <XIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] text-white/48 transition hover:border-white/15 hover:bg-white/[0.04] hover:text-white/80"
                        >
                          <UploadIcon className="h-3.5 w-3.5" />
                          参考图
                        </button>
                        <input
                          ref={fileRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={handleFile}
                        />
                        <span className="hidden text-[10px] text-white/25 sm:inline">
                          PNG / JPEG / WebP · ≤ 3MB
                        </span>
                      </div>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="focus-ring group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-mint-300 to-teal-200 px-4 py-2.5 text-[13px] font-semibold text-[#06201d] shadow-[0_10px_30px_rgba(45,212,191,0.18)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {submitting ? (
                          <>
                            <Spinner className="h-4 w-4 border-[#06201d]/25 border-t-[#06201d]" />
                            正在生成预览图…
                          </>
                        ) : (
                          <>
                            生成概念方案
                            <ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </form>

                {error ? (
                  <ErrorBanner
                    message={error}
                    onDismiss={() => setError(null)}
                    className="mx-2 mb-2 mt-1"
                  />
                ) : null}

                <div className="flex flex-wrap items-center gap-1.5 px-3 py-3">
                  <span className="mr-1 text-[10px] uppercase tracking-[0.14em] text-white/28">
                    试试
                  </span>
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => {
                        setPrompt(example);
                        setError(null);
                        inputRef.current?.focus();
                      }}
                      className="focus-ring rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 text-[11px] text-white/45 transition hover:border-mint-300/25 hover:bg-mint-300/[0.05] hover:text-mint-100/85"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[10px] text-white/30">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-mint-300/70" />
                  无需 API Key 可体验 Mock 演示
                </span>
                <span>Ctrl / ⌘ + Enter 快速生成</span>
                <span>所有 AI 调用均经过后端 Provider 抽象</span>
              </div>
            </div>

            <div className="animate-rise stagger-2 lg:pt-3">
              <div className="panel relative overflow-hidden rounded-[22px] p-5 sm:p-6">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mint-300/50 to-transparent" />
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                      Preview to 3D Pipeline
                    </div>
                    <h2 className="mt-2 font-display text-[18px] font-semibold tracking-tight text-white/90">
                      一句话如何成为世界
                    </h2>
                  </div>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
                    <LayersIcon className="h-4 w-4 text-mint-300/80" />
                  </div>
                </div>

                <div className="mt-6 space-y-1">
                  {PIPELINE_STAGES.map((stage, index) => {
                    const provider =
                      stage.kind === 'runtime' || stage.kind === 'selection'
                        ? null
                        : meta?.providers.find(
                            (entry) => entry.kind === stage.kind,
                          );
                    return (
                      <div key={stage.index} className="group relative flex gap-3.5">
                        <div className="flex flex-col items-center">
                          <div
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold tabular-nums ${
                              stage.kind === 'runtime'
                                ? 'border-mint-300/30 bg-mint-300/[0.08] text-mint-200'
                                : 'border-white/[0.09] bg-white/[0.03] text-white/40'
                            }`}
                          >
                            {stage.index}
                          </div>
                          {index < PIPELINE_STAGES.length - 1 ? (
                            <div className="my-1 h-5 w-px bg-gradient-to-b from-white/12 to-white/[0.03]" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1 pb-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12px] font-medium text-white/72">
                              {stage.label}
                            </span>
                            <span
                              className={`rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] ${
                                stage.kind === 'runtime'
                                  ? 'border-mint-300/20 bg-mint-300/[0.06] text-mint-200/80'
                                  : 'border-amber-200/15 bg-amber-200/[0.05] text-amber-100/60'
                              }`}
                            >
                              {stage.kind === 'runtime' ? 'Runtime' : stage.kind === 'selection' ? '选择' : provider?.mode === 'live' ? 'AI' : 'Mock'}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-[10px] text-white/28">
                            {stage.kind === 'runtime'
                              ? 'React Three Fiber · 独立对象实时渲染'
                              : stage.kind === 'selection'
                                ? stage.name
                                : provider?.displayName ?? '等待后端 Provider 元数据'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-3">
                  <div className="flex items-center gap-2 text-[10px] text-white/38">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-200/80" />
                    图片 API 先生成预览；选中的真实 PNG / JPEG 交给建模 API 看图扩写，再由同一模型生成结构化场景，经校验后组装 Three.js 几何。两套 API 独立配置，关闭时明确标注 Mock；不执行不可信 AI 代码。
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {[
                    { icon: ImageIcon, label: '5 种风格', value: '概念方向' },
                    { icon: LayersIcon, label: 'World Schema', value: '可编辑对象' },
                    { icon: CubeIcon, label: 'R3F', value: '实时 3D' },
                  ].map(({ icon: Icon, label, value }) => (
                    <div
                      key={label}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                    >
                      <Icon className="h-3.5 w-3.5 text-white/30" />
                      <div className="mt-2 text-[10px] text-white/35">{label}</div>
                      <div className="mt-0.5 text-[11px] font-medium text-white/65">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-start gap-2.5 px-2 text-[10px] leading-5 text-white/28">
                <SparklesIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/22" />
                <p>
                  在「API 设置」分别配置图片与建模服务。启用图片 API 后，生成概念方案会调用 5 张图片并按服务商规则计费；每次新建模由同一模型完成看图扩写与场景生成，两次调用均可能收费，不自动重试或降级。建模在后台运行，完成后通知。
                  密钥仅保存在本地服务端；上传参考图仅保存、不参与分析，发送给建模服务的是选中的生成预览图。
                </p>
              </div>
            </div>
          </section>

          <section
            id="history"
            className="animate-rise stagger-3 border-t border-white/[0.06] pt-12"
          >
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">
                  Your drafts
                </div>
                <h2 className="mt-2 font-display text-[24px] font-semibold tracking-tight text-white/90">
                  历史项目
                </h2>
              </div>
              <button
                type="button"
                onClick={loadHistory}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] text-white/45 transition hover:border-white/15 hover:text-white/80"
              >
                <RefreshIcon className={`h-3.5 w-3.5 ${historyLoading ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>

            {historyError ? (
              <ErrorBanner message={historyError} className="mb-4" />
            ) : null}

            {historyLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }, (_, index) => (
                  <div
                    key={index}
                    className="h-[220px] animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.025]"
                  />
                ))}
              </div>
            ) : history.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {history.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => openProject(project)}
                    className="focus-ring group overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0d1118]/70 text-left transition duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:bg-[#111721]"
                  >
                    <div className="relative aspect-[16/9] overflow-hidden border-b border-white/[0.06] bg-[#11161f]">
                      {project.coverImageUrl ? (
                        <img
                          src={resolveMediaUrl(project.coverImageUrl)}
                          alt={`${project.title} 概念图`}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-white/20">
                          <ImageIcon className="h-8 w-8" />
                        </div>
                      )}
                      <div className="absolute left-3 top-3 rounded-full border border-amber-200/20 bg-black/50 px-2 py-0.5 text-[9px] text-amber-100">
                        概念参考封面
                      </div>
                      {project.hasWorld ? (
                        <div className="absolute right-3 top-3 rounded-full border border-mint-300/25 bg-[#071412]/80 px-2 py-0.5 text-[9px] font-medium text-mint-200/90 backdrop-blur">
                          3D 已生成
                        </div>
                      ) : null}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="truncate text-[13px] font-medium text-white/85">
                          {project.title}
                        </h3>
                        <span className="shrink-0 text-[10px] text-white/28">
                          {formatRelativeTime(project.updatedAt)}
                        </span>
                      </div>
                      <p className="mt-1.5 line-clamp-1 text-[11px] text-white/38">
                        {project.prompt}
                      </p>
                      <div className="mt-3 flex items-center justify-between text-[10px] text-white/30">
                        <span>
                          {project.conceptCount} 张概念图 ·{' '}
                          {project.hasWorld ? '继续编辑' : '选择概念'}
                        </span>
                        <ArrowRightIcon className="h-3.5 w-3.5 text-white/20 transition group-hover:translate-x-0.5 group-hover:text-mint-300/70" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-12 text-center">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
                  <LayersIcon className="h-5 w-5 text-white/25" />
                </div>
                <div className="mt-4 text-[13px] text-white/60">
                  还没有项目草稿
                </div>
                <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-5 text-white/30">
                  在上方输入一句描述生成第一组概念图。项目会自动保存到本地
                  Node 服务的 <code className="text-white/40">.data</code> 目录。
                </p>
              </div>
            )}
          </section>

          <section
            id="pipeline"
            className="animate-rise stagger-4 border-t border-white/[0.06] pt-12"
          >
            <div className="mb-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/32">
                Roadmap
              </div>
              <h2 className="mt-2 font-display text-[24px] font-semibold tracking-tight text-white/90">
                分阶段构建，而不是一次堆满
              </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {ROADMAP.map((stage) => (
                <div
                  key={stage.phase}
                  className={`rounded-2xl border p-4 ${
                    stage.active
                      ? 'border-mint-300/20 bg-mint-300/[0.045]'
                      : 'border-white/[0.06] bg-white/[0.018]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                        stage.active ? 'text-mint-200/80' : 'text-white/28'
                      }`}
                    >
                      {stage.phase}
                    </span>
                    {stage.active ? (
                      <span className="rounded-full bg-mint-300/10 px-1.5 py-0.5 text-[8px] font-semibold text-mint-200/80">
                        NOW
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3 text-[13px] font-medium text-white/75">
                    {stage.title}
                  </h3>
                  <p className="mt-1.5 text-[10px] leading-5 text-white/32">
                    {stage.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <footer className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-white/[0.06] pt-6 text-[10px] leading-5 text-white/25 sm:flex-row sm:items-center">
            <span>AI Three.js Studio · 可编辑建模与第三人称漫游</span>
            <span>
              概念图与建模使用独立 API；AI 建模生成结构化几何场景，不是照片重建或图生 GLB。
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
