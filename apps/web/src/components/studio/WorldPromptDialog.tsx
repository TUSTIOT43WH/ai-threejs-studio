import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { ConceptImage, PrepareWorldPromptResponse } from '@ai-three-studio/shared';
import { MAX_MODELING_PROMPT_LENGTH } from '@ai-three-studio/shared';
import { api, errorMessage, resolveMediaUrl } from '../../lib/api';
import { useStudioStore } from '../../stores/studio-store';
import {
  CubeIcon,
  SparklesIcon,
  WarningIcon,
  XIcon,
} from '../ui/icons';
import { Spinner } from '../ui/primitives';

interface WorldPromptDialogProps {
  projectId: string;
  concept: ConceptImage;
  regenerate: boolean;
  hasCurrentWorld: boolean;
  onClose: () => void;
  onGenerated: () => void;
}

export function WorldPromptDialog({
  projectId,
  concept,
  regenerate,
  hasCurrentWorld,
  onClose,
  onGenerated,
}: WorldPromptDialogProps) {
  const generateWorld = useStudioStore((state) => state.generateWorld);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [prepared, setPrepared] = useState<PrepareWorldPromptResponse | null>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const noteId = useId();
  const promptId = useId();
  const countId = useId();

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setPrepared(null);
    setPrompt('');
    setError(null);
    api.prepareWorldPrompt(projectId, { conceptId: concept.id }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setPrepared(response);
        setPrompt(response.analysis.modelingPrompt ?? '');
        setStatus('ready');
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(reason));
        setStatus('error');
      });
    return () => controller.abort();
  }, [projectId, concept.id, retryNonce]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (status === 'ready') textareaRef.current?.focus();
    else closeRef.current?.focus();
  }, [status]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (submitting) return;
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const originalPrompt = prepared?.analysis.modelingPrompt ?? '';
  const trimmedPrompt = prompt.trim();
  const promptTooLong = prompt.length > MAX_MODELING_PROMPT_LENGTH;

  const handleConfirm = async () => {
    if (!prepared || submitting) return;
    if (!trimmedPrompt) {
      setError('建模提示词不能为空，请补充后再确认生成。');
      textareaRef.current?.focus();
      return;
    }
    if (promptTooLong) {
      setError('建模提示词过长，请精简后再确认生成。');
      textareaRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    const submitted = await generateWorld(concept.id, regenerate, {
      promptDraftId: prepared.draftId,
      modelingPrompt: trimmedPrompt,
    });
    if (submitted) {
      onGenerated();
      return;
    }
    setError(useStudioStore.getState().error ?? '无法提交建模任务，请稍后重试。');
    setSubmitting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={noteId}
        aria-busy={submitting || status === 'loading'}
        onKeyDown={handleKeyDown}
        className="panel flex max-h-[92vh] w-full max-w-[780px] animate-rise flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a111b] shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-mint-300/20 bg-mint-300/[0.07]">
              {status === 'loading' ? <Spinner className="h-4 w-4 border-mint-200/25 border-t-mint-200" /> : status === 'error' ? <WarningIcon className="h-4 w-4 text-amber-200" /> : <SparklesIcon className="h-4 w-4 text-mint-200" />}
            </div>
            <div className="min-w-0">
              <h2 id={titleId} className="text-[15px] font-semibold tracking-tight text-white/90">
                {status === 'loading' ? '正在准备建模提示词' : status === 'error' ? '无法准备建模提示词' : '确认 Three.js 建模提示词'}
              </h2>
              <p id={noteId} className="mt-1 text-[11px] leading-5 text-white/40">
                {status === 'loading' ? '正在将扩写模板和所选概念图一起发送，生成可编辑的建模提示词。首次准备会调用一次建模 API，可能产生费用。' : status === 'error' ? '尚未开始场景生成。' : '提示词可编辑；只有点击确认后才会开始生成场景。'}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭提示词窗口，不生成场景"
            className="focus-ring rounded-lg border border-white/[0.08] p-1.5 text-white/45 transition hover:border-white/15 hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
            <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
              <img src={resolveMediaUrl(concept.imageUrl)} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-white/75">{concept.title}</div>
              <div className="mt-1 text-[10px] text-white/35">{concept.styleLabel} · Seed {concept.seed.toString(16).slice(-6)}</div>
            </div>
          </div>

          {status === 'loading' ? (
            <div className="mt-5 rounded-xl border border-mint-300/15 bg-mint-300/[0.035] p-4">
              <div className="flex items-center gap-2 text-[12px] text-mint-100/80">
                <Spinner className="h-3.5 w-3.5 border-mint-200/25 border-t-mint-200" />
                <span>看图理解并扩写建模提示词，请稍候…</span>
              </div>
              <p className="mt-2 text-[10px] leading-5 text-white/45">
                不会自动重试或切换为 Mock。关闭窗口不会撤销已经发出的请求；服务端可能仍会完成并保存草稿，供下次复用。
              </p>
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="mt-5 space-y-4">
              <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-3.5 py-3 text-[12px] leading-6 text-rose-100/90">
                <WarningIcon className="mt-1 h-4 w-4 shrink-0 text-rose-300" />
                <span className="break-words">{error}</span>
              </p>
              <p className="text-[10px] leading-5 text-white/40">
                重新尝试会再次调用看图扩写 API，可能再次产生费用；不会自动重试。已有概念图和世界会保留。
              </p>
            </div>
          ) : null}

          {status === 'ready' && prepared ? (
            <div className="mt-5 space-y-4">
              <div className={`rounded-xl border px-3.5 py-3 text-[11px] leading-5 ${prepared.reused ? 'border-mint-300/15 bg-mint-300/[0.035] text-mint-100/70' : 'border-amber-200/15 bg-amber-200/[0.045] text-amber-100/75'}`}>
                {prepared.reused
                  ? '已复用现有看图扩写结果，没有再次调用看图 API。'
                  : '本次看图扩写已完成并可能已产生费用。'}
                {' '}确认后将再调用一次建模 API 生成场景，可能收费；不会自动重试或切换为 Mock。
              </div>

              <div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <label htmlFor={promptId} className="text-[11px] font-medium text-white/70">
                    建模提示词（可编辑）
                  </label>
                  <div className="flex items-center gap-3 text-[10px]">
                    {prompt !== originalPrompt ? (
                      <button type="button" onClick={() => setPrompt(originalPrompt)} className="focus-ring rounded text-mint-200/80 underline decoration-mint-200/30 underline-offset-4 hover:text-mint-100">
                        恢复准备时的提示词
                      </button>
                    ) : null}
                    <span id={countId} aria-live="polite" className={promptTooLong ? 'text-rose-200' : 'tabular-nums text-white/35'}>
                      {prompt.length.toLocaleString()} / {MAX_MODELING_PROMPT_LENGTH.toLocaleString()}
                    </span>
                  </div>
                </div>
                <textarea
                  ref={textareaRef}
                  id={promptId}
                  aria-describedby={countId}
                  value={prompt}
                  onChange={(event) => { setPrompt(event.target.value); if (error) setError(null); }}
                  maxLength={MAX_MODELING_PROMPT_LENGTH}
                  disabled={submitting}
                  spellCheck={false}
                  rows={14}
                  className="focus-ring mt-2 block w-full resize-y rounded-xl border border-white/[0.08] bg-black/35 p-4 font-sans text-[12px] leading-6 text-white/80 disabled:opacity-60"
                />
                <p className="mt-2 text-[10px] leading-5 text-white/35">
                  修改只影响本次生成；成功后草稿会清除。若生成失败，当前世界会保留，草稿会保留以便手动重试。
                </p>
              </div>

              {prepared.analysis.assumptions?.length ? (
                <details className="rounded-xl border border-white/[0.07] bg-white/[0.018] px-3.5 py-3">
                  <summary className="focus-ring cursor-pointer rounded text-[11px] font-medium text-white/60">查看推断与假设</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[10px] leading-5 text-white/45">
                    {prepared.analysis.assumptions.map((assumption, index) => (
                      <li key={index} className="break-words">{assumption}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {prepared.analysis.disclaimer ? (
                <p className="text-[10px] leading-5 text-white/40">{prepared.analysis.disclaimer}</p>
              ) : null}

              {hasCurrentWorld ? (
                <p role="note" className="rounded-xl border border-amber-200/15 bg-amber-200/[0.045] px-3.5 py-2.5 text-[11px] leading-5 text-amber-100/75">
                  生成成功后将替换当前世界及其编辑，失败会保留当前世界。需要保留的修改请先在工作室中保存。
                </p>
              ) : null}
            </div>
          ) : null}

          {error && status === 'ready' ? (
            <p role="alert" className="mt-4 break-words rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-3.5 py-2.5 text-[11px] leading-5 text-rose-100/90">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-4 sm:px-6">
          {status === 'error' ? (
            <button
              type="button"
              onClick={() => setRetryNonce((value) => value + 1)}
              className="focus-ring rounded-lg border border-white/[0.1] px-3.5 py-2 text-[11px] text-white/65 transition hover:border-white/20 hover:text-white/90"
            >
              重新尝试看图扩写
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="focus-ring rounded-lg border border-white/[0.1] px-3.5 py-2 text-[11px] text-white/65 transition hover:border-white/20 hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === 'ready' ? '关闭，不生成' : '关闭'}
          </button>
          {status === 'ready' ? (
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={submitting || !trimmedPrompt || promptTooLong}
              className="focus-ring inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-mint-300 to-teal-200 px-4 py-2 text-[11px] font-semibold text-[#06201d] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? <Spinner className="h-3.5 w-3.5 border-[#06201d]/25 border-t-[#06201d]" /> : <CubeIcon className="h-3.5 w-3.5" />}
              {submitting ? '正在提交…' : '确认并开始生成'}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}