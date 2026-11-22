import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConceptAnalysis, ImageArtifact, Project, ProjectSummary } from '@ai-three-studio/shared';
import { APP_CONFIG, type AppConfig } from '../config';

export interface StoredWorldPromptDraft {
  id: string;
  conceptId: string;
  preparedAt: string;
  analysis: ConceptAnalysis;
}

export interface StoredProjectRecord {
  project: Project;
  /** Legacy raw SVG strings remain readable without migrating user data. */
  artifacts: Record<string, ImageArtifact | string>;
  /** Non-secret planner identity for cache compatibility (mode/model/endpoint). */
  worldPlannerKey?: string;
  /** Prepared but unconfirmed expansion; never exposed by project reads. */
  worldPromptDraft?: StoredWorldPromptDraft;
}

@Injectable()
export class ProjectStore implements OnModuleInit {
  private readonly logger = new Logger(ProjectStore.name);
  private readonly records = new Map<string, StoredProjectRecord>();
  private readonly artifactIndex = new Map<string, ImageArtifact | string>();
  private readonly directory: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.directory = join(config.dataDir, 'projects');
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const entries = await readdir(this.directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.directory, entry.name), 'utf8');
        const record = JSON.parse(raw) as StoredProjectRecord;
        if (!record?.project?.id) continue;
        this.index(record);
      } catch {
        this.logger.warn('Skipping an unreadable project file.');
      }
    }
    this.logger.log(
      `Loaded ${this.records.size} project(s) from ${this.directory}`,
    );
  }

  private index(record: StoredProjectRecord): void {
    const projectId = record.project.id;
    for (const key of this.artifactIndex.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        this.artifactIndex.delete(key);
      }
    }
    for (const [conceptId, artifact] of Object.entries(record.artifacts ?? {})) {
      this.artifactIndex.set(`${projectId}:${conceptId}`, artifact);
    }
    this.records.set(projectId, record);
  }

  async save(record: StoredProjectRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = join(this.directory, `${record.project.id}.json`);
    const temporary = `${file}.tmp`;
    await writeFile(temporary, JSON.stringify(record), 'utf8');
    await rename(temporary, file);
    this.index(record);
  }

  get(projectId: string): StoredProjectRecord | null {
    return this.records.get(projectId) ?? null;
  }

  getArtifact(projectId: string, conceptId: string): ImageArtifact | string | null {
    return this.artifactIndex.get(`${projectId}:${conceptId}`) ?? null;
  }

  /** Read the committed file, not the index, when reconciling an interrupted save. */
  async readPersisted(projectId: string): Promise<StoredProjectRecord | null> {
    if (!/^[a-zA-Z0-9-]+$/.test(projectId)) return null;
    try {
      const raw = await readFile(join(this.directory, `${projectId}.json`), 'utf8');
      const record = JSON.parse(raw) as StoredProjectRecord;
      return record?.project?.id === projectId ? record : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  listSummaries(): ProjectSummary[] {
    return [...this.records.values()]
      .map(({ project }) => ({
        id: project.id,
        prompt: project.prompt,
        title: project.world?.title ?? project.expansion.sceneLabel,
        coverImageUrl: project.concepts[0]?.imageUrl,
        conceptCount: project.concepts.length,
        hasWorld: Boolean(project.world),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
