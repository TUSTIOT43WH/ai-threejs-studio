import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorldGenerationJob, WorldJobSummary } from '@ai-three-studio/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { ProjectStore } from './project.store';

interface StoredWorldJob {
  job: WorldGenerationJob;
  /** Commit intent only; never settings, credentials or an HTTP request. */
  targetWorldId?: string;
}

export const INTERRUPTED_WORLD_JOB = '服务重启中断，请手动重试';
const MISSING_WORLD = '已完成世界数据缺失或已变更，请手动重试。';

export function isActiveWorldJob(job: WorldGenerationJob): boolean {
  return job.status === 'pending' || job.status === 'running';
}

/** Explicit allowlist also keeps internal commit metadata out of list responses. */
function summary(job: WorldGenerationJob): WorldJobSummary {
  return {
    id: job.id,
    projectId: job.projectId,
    projectTitle: job.projectTitle,
    conceptId: job.conceptId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    phase: job.phase,
    status: job.status,
    ...(job.error === undefined ? {} : { error: job.error }),
  };
}

@Injectable()
export class WorldJobStore {
  private readonly entries = new Map<string, StoredWorldJob>();
  private readonly directory: string;
  private readonly file: string;
  private initialization?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly projects: ProjectStore,
  ) {
    this.directory = join(config.dataDir, 'world-jobs');
    this.file = join(this.directory, 'jobs.json');
  }

  initialize(): Promise<void> {
    return this.initialization ??= this.load();
  }

  private async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('无法读取建模任务记录。');
    }
    let saved: { version: number; jobs: StoredWorldJob[] };
    try {
      saved = JSON.parse(raw) as typeof saved;
      if (saved.version !== 1 || !Array.isArray(saved.jobs)) throw new Error();
    } catch {
      // Do not overwrite unreadable user data or disclose its content in logs.
      throw new Error('建模任务记录损坏，无法恢复。');
    }
    for (const entry of saved.jobs) {
      const job = entry?.job;
      if (!job || !['id', 'projectId', 'conceptId', 'createdAt', 'updatedAt'].every((key) =>
          typeof job[key as keyof WorldGenerationJob] === 'string' && Boolean(job[key as keyof WorldGenerationJob])) ||
          typeof job.projectTitle !== 'string' ||
          !['pending', 'running', 'succeeded', 'failed'].includes(job.status) ||
          !['queued', 'expanding', 'generating', 'validating', 'saving', 'complete', 'failed'].includes(job.phase)) {
        throw new Error('建模任务记录格式不正确，无法恢复。');
      }
    }
    for (const entry of saved.jobs.sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt))) {
      const job = entry.job;
      const wasActive = isActiveWorldJob(job);
      // All recovery uses the committed project file. Nest provider init hooks can
      // run concurrently, and a crash can happen after rename but before indexing.
      if (isActiveWorldJob(job) || job.status === 'succeeded') {
        const project = (await this.projects.readPersisted(job.projectId))?.project;
        const target = entry.targetWorldId ?? (job.status === 'succeeded' ? job.world?.id : undefined);
        if (target && project?.world?.id === target && project.analysis &&
            project.world.source.conceptId === job.conceptId &&
            (job.phase === 'saving' || job.status === 'succeeded')) {
          job.status = 'succeeded';
          job.phase = 'complete';
          job.world = project.world;
          job.analysis = project.analysis;
          delete job.error;
        } else {
          job.error = isActiveWorldJob(job) ? INTERRUPTED_WORLD_JOB : MISSING_WORLD;
          job.status = 'failed';
          job.phase = 'failed';
          delete job.world;
          delete job.analysis;
        }
        if (wasActive || job.status === 'failed') job.updatedAt = new Date().toISOString();
      }
      if (job.status === 'failed') {
        job.phase = 'failed';
        delete job.world;
        delete job.analysis;
        delete entry.targetWorldId;
      }
      this.entries.delete(job.projectId);
      this.entries.set(job.projectId, entry);
    }
    while (this.entries.size > 100) this.entries.delete(this.entries.keys().next().value!);
    await this.persist();
  }

  flush(): Promise<void> {
    return this.writes;
  }

  get(projectId: string): WorldGenerationJob | undefined {
    return this.entries.get(projectId)?.job;
  }

  list(): WorldJobSummary[] {
    return [...this.entries.values()].map(({ job }) => summary(job))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Reserve synchronously before the first await so concurrent POSTs deduplicate. */
  retain(job: WorldGenerationJob): Promise<void> {
    if (!this.entries.has(job.projectId) && this.entries.size >= 100) {
      const oldestCompleted = [...this.entries].find(([, entry]) => !isActiveWorldJob(entry.job));
      if (!oldestCompleted) throw new ConflictException('生成任务已达上限，请稍后再试。');
      this.entries.delete(oldestCompleted[0]);
    }
    this.entries.delete(job.projectId);
    this.entries.set(job.projectId, { job });
    return this.persist();
  }

  update(job: WorldGenerationJob, targetWorldId?: string): Promise<void> {
    const entry = this.entries.get(job.projectId);
    if (entry?.job.id !== job.id) return Promise.resolve();
    entry.job = job;
    if (targetWorldId) entry.targetWorldId = targetWorldId;
    if (job.status === 'failed') delete entry.targetWorldId;
    return this.persist();
  }

  remove(projectId: string): Promise<void> {
    this.entries.delete(projectId);
    return this.persist();
  }

  private persist(): Promise<void> {
    // Capture each immutable snapshot NOW, then serialize writes across projects.
    // A slow validating write can never overwrite a later complete/failed write.
    const data = JSON.stringify({
      version: 1,
      jobs: [...this.entries.values()].map(({ job, targetWorldId }) => ({
        job: {
          ...summary(job),
          ...(job.status === 'succeeded' ? { world: job.world, analysis: job.analysis } : {}),
        },
        ...(targetWorldId ? { targetWorldId } : {}),
      })),
    });
    const next = this.writes.then(async () => {
      const temporary = `${this.file}.tmp`;
      await writeFile(temporary, data, 'utf8');
      await rename(temporary, this.file);
    });
    this.writes = next.catch(() => {});
    return next;
  }
}
