import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { SceneResource } from '@ai-three-studio/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { MAX_ASSET_BYTES, validateAsset, validateAssetInput, type AssetImportInput } from './asset-validation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_RECORD_BYTES = 4 * Math.ceil(MAX_ASSET_BYTES / 3) + 32 * 1024;
const hash = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
interface DiskRecord { version: 1; resource: SceneResource; data: string }

/** Global, single-local-user catalog. No project owns or mutates these assets. */
@Injectable()
export class AssetStore implements OnModuleInit {
  private readonly logger = new Logger(AssetStore.name);
  private readonly records = new Map<string, SceneResource>();
  private readonly directory: string;
  private ready?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.directory = join(config.dataDir, 'assets');
  }

  onModuleInit(): Promise<void> {
    return this.ready ??= this.load();
  }

  private async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      // Temporary, unrelated and symlink entries are never catalog entries.
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      if (!UUID.test(id)) continue;
      try {
        const record = await this.readRecord(id);
        const validated = validateAsset({ name: record.resource.name, mimeType: record.resource.mimeType,
          data: record.data, ...(record.resource.attribution !== undefined ? { attribution: record.resource.attribution } : {}) });
        // Recompute bounds, image dimensions and provenance rather than trusting disk metadata.
        this.records.set(id, {
          id, name: record.resource.name, ...validated.metadata, url: `/api/assets/${id}/file`,
          sha256: hash(validated.data), bytes: validated.data.length, source: 'user-upload', createdAt: record.resource.createdAt,
          ...(record.resource.attribution !== undefined ? { attribution: record.resource.attribution } : {}),
        });
      } catch {
        this.logger.warn('Skipping an invalid or incomplete local asset record.');
      }
    }
  }

  list(): SceneResource[] {
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .map((resource) => structuredClone(resource));
  }

  get(id: string): SceneResource | undefined {
    const resource = this.records.get(id);
    return resource ? structuredClone(resource) : undefined;
  }

  async import(value: AssetImportInput): Promise<SceneResource> {
    // Validate boundary even for internal callers; capture caller-owned input before queuing.
    const input = validateAssetInput(value);
    await this.onModuleInit();
    const operation = this.writes.then(async () => {
      const validated = validateAsset(input);
      const id = randomUUID();
      const resource: SceneResource = {
        id, name: input.name, ...validated.metadata, url: `/api/assets/${id}/file`,
        sha256: hash(validated.data), bytes: validated.data.length, source: 'user-upload', createdAt: new Date().toISOString(),
        ...(input.attribution !== undefined ? { attribution: input.attribution } : {}),
      };
      // One envelope makes the metadata AND original bytes an atomic unit. Base64 is
      // disk-only; list/import never expose it and read() returns the original binary.
      const record: DiskRecord = { version: 1, resource, data: input.data };
      const temporary = join(this.directory, `${id}.${randomUUID()}.tmp`);
      const destination = join(this.directory, `${id}.json`);
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(record), 'utf8'); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, destination);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      // Readers only see successfully committed assets. There is no update/delete API.
      this.records.set(id, resource);
      return structuredClone(resource);
    });
    this.writes = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async read(id: string): Promise<{ resource: SceneResource; data: Buffer }> {
    await this.onModuleInit();
    const resource = this.get(id);
    if (!resource || !UUID.test(id)) throw new NotFoundException('Asset not found.');
    try {
      const record = await this.readRecord(id);
      const data = Buffer.from(record.data, 'base64');
      // Detect deleted, corrupted or changed files without serving new unvalidated content.
      if (hash(data) !== resource.sha256 || data.length !== resource.bytes || record.resource.mimeType !== resource.mimeType) throw new Error();
      return { resource, data };
    } catch {
      throw new NotFoundException('Asset file is missing or failed its integrity check.');
    }
  }

  private async readRecord(id: string): Promise<DiskRecord> {
    if (!UUID.test(id)) throw new Error('Invalid asset id');
    const file = await open(join(this.directory, `${id}.json`), 'r');
    let raw: string;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) throw new Error('Invalid asset record size');
      // Bound the read even if another local process grows the file after stat().
      const bytes = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== stat.size) throw new Error('Asset record changed while reading');
      raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
    } finally { await file.close(); }
    const record = JSON.parse(raw) as DiskRecord;
    if (record?.version !== 1 || record.resource?.id !== id || typeof record.data !== 'string') throw new Error('Invalid asset record');
    const resource = record.resource;
    validateAssetInput({ name: resource.name, mimeType: resource.mimeType, data: record.data,
      ...(resource.attribution !== undefined ? { attribution: resource.attribution } : {}) });
    if (typeof resource.createdAt !== 'string' || new Date(resource.createdAt).toISOString() !== resource.createdAt ||
      typeof resource.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(resource.sha256) || record.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(record.data)) throw new Error('Invalid asset metadata');
    const data = Buffer.from(record.data, 'base64');
    if (data.length === 0 || data.length > MAX_ASSET_BYTES || data.toString('base64') !== record.data || data.length !== resource.bytes || hash(data) !== resource.sha256) throw new Error('Asset integrity check failed');
    return record;
  }
}
