import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorldJobSummary } from '@ai-three-studio/shared';
import { useStudioStore } from '../../stores/studio-store';

const phases: Record<WorldJobSummary['phase'], string> = {
  queued: '排队中', expanding: '看图理解并扩写建模提示词',
  generating: '等待 AI 返回建模结果', validating: '校验模型结构',
  saving: '保存建模结果', complete: '建模完成', failed: '建模失败',
};

function elapsed(createdAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function BackgroundJobs() {
  const jobs = useStudioStore((state) => state.worldJobs);
  const notifications = useStudioStore((state) => state.jobNotifications);
  const connectionError = useStudioStore((state) => state.jobsConnectionError);
  const refresh = useStudioStore((state) => state.refreshWorldJobs);
  const dismiss = useStudioStore((state) => state.dismissJobNotification);
  const open = useStudioStore((state) => state.openWorldJob);
  const [now, setNow] = useState(Date.now);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const navigate = useNavigate();
  const active = jobs.filter((job) => job.status === 'pending' || job.status === 'running');

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const resume = () => void refresh();
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
    };
  }, [refresh]);

  useEffect(() => {
    if (!active.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active.length]);

  const openResult = async (job: WorldJobSummary) => {
    const { saveState } = useStudioStore.getState();
    if (saveState === 'saving') { setOpenError('请等当前保存完成后打开生成结果。'); return; }
    if ((saveState === 'dirty' || saveState === 'error') && !window.confirm('打开生成结果将放弃当前未保存的编辑预览，继续吗？')) return;
    setOpening(job.id);
    setOpenError(null);
    if (await open(job)) navigate(`/projects/${job.projectId}/studio`);
    else setOpenError(useStudioStore.getState().error ?? '无法打开生成结果。');
    setOpening(null);
  };

  if (!active.length && !notifications.length && !connectionError) return null;
  return (
    <aside aria-label="后台建模任务" className="fixed bottom-24 right-4 z-40 max-h-[60vh] w-[min(360px,calc(100vw-32px))] space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-[#0a111b]/95 p-4 text-white shadow-2xl backdrop-blur-xl">
      {active.map((job) => (
        <div key={job.id} className="space-y-2 rounded-xl border border-mint-300/15 bg-mint-300/[0.025] p-3">
          <div className="truncate text-xs font-medium">Three.js 后台建模 · {job.projectTitle}</div>
          <div className="flex justify-between gap-2 text-[11px] text-mint-200/85"><span>{phases[job.phase]}</span><time className="tabular-nums">{elapsed(job.createdAt, now)}</time></div>
          <progress aria-label={`${job.projectTitle} 建模进度`} aria-valuetext={phases[job.phase]} className="h-1.5 w-full accent-[#6ee7c4]" />
          <p className="text-[10px] leading-5 text-white/45">阶段进度：服务商未提供真实百分比。可切换页面或刷新，完成后通知；请保持后端服务运行。</p>
        </div>
      ))}
      {connectionError ? <p role="status" className="text-[11px] leading-5 text-amber-200/80">{connectionError}</p> : null}
      {notifications.map((job) => (
        <div key={job.id} role={job.status === 'failed' ? 'alert' : 'status'} className="rounded-xl border border-white/10 p-3">
          <div className="text-xs font-medium">{job.status === 'succeeded' ? 'Three.js 建模完成' : 'Three.js 建模未完成'} · {job.projectTitle}</div>
          <p className="mt-2 text-[11px] leading-5 text-white/55">{job.status === 'succeeded' ? '结果已保存，可打开预览并导出 Three.js 文件。' : job.error}</p>
          <div className="mt-3 flex gap-3 text-xs">
            {job.status === 'succeeded' ? <button type="button" disabled={opening !== null} onClick={() => void openResult(job)} className="focus-ring rounded bg-mint-300 px-3 py-1.5 text-[#06201d] disabled:opacity-50">{opening === job.id ? '打开中…' : '打开生成结果'}</button> : <button type="button" onClick={() => { dismiss(job.id); navigate(`/projects/${job.projectId}/concepts`); }} className="focus-ring rounded border border-white/15 px-3 py-1.5">前往项目</button>}
            <button type="button" onClick={() => dismiss(job.id)} className="focus-ring rounded px-2 text-white/50">关闭提示</button>
          </div>
        </div>
      ))}
      {openError ? <p role="alert" className="text-xs text-rose-200">{openError}</p> : null}
    </aside>
  );
}
