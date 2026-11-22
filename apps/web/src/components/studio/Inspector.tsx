import { useEffect, useState } from 'react';
import type {
  SeasonId,
  TimeOfDayId,
  WeatherId,
  WorldObject,
} from '@ai-three-studio/shared';
import { resolveMediaUrl } from '../../lib/api';
import { recommendedLighting } from '../../lib/environment-visuals';
import {
  OBJECT_KIND_COLORS,
  OBJECT_KIND_LABELS,
  SEASON_OPTIONS,
  TIME_LABELS,
  TIME_OPTIONS,
  WEATHER_LABELS,
  WEATHER_OPTIONS,
} from '../../lib/labels';
import { useStudioStore } from '../../stores/studio-store';
import {
  CubeIcon,
  ImageIcon,
  MouseIcon,
  SlidersIcon,
} from '../ui/icons';
import { WorldBadge, SectionLabel } from '../ui/primitives';

type Axis = 0 | 1 | 2;

const AXES: Array<{ axis: Axis; label: string; color: string }> = [
  { axis: 0, label: 'X', color: '#fda4af' },
  { axis: 1, label: 'Y', color: '#6ee7b7' },
  { axis: 2, label: 'Z', color: '#7dd3fc' },
];

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 100) / 100);
}

function safeColor(value: string | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#9aa39d';
}

function NumberField({
  axis,
  value,
  onChange,
  onCommit,
}: {
  axis: (typeof AXES)[number];
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  const formatted = formatNumber(value);
  const [draft, setDraft] = useState(formatted);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(formatNumber(value));
  }, [value, focused]);

  return (
    <label className="relative block">
      <span
        className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] font-bold"
        style={{ color: axis.color }}
      >
        {axis.label}
      </span>
      <input
        value={draft}
        inputMode="decimal"
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = Number(next);
          if (next.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
        }}
        onBlur={() => {
          setFocused(false);
          const parsed = Number(draft);
          if (draft.trim() === '' || !Number.isFinite(parsed)) {
            setDraft(formatNumber(value));
          }
          onCommit();
        }}
        className="focus-ring w-full rounded-md border border-white/[0.07] bg-black/25 py-1.5 pl-5 pr-1.5 text-[10px] tabular-nums text-white/70 transition focus:border-mint-300/30"
      />
    </label>
  );
}

function VectorEditor({
  label,
  unit,
  values,
  onChange,
  onCommit,
}: {
  label: string;
  unit: string;
  values: [number, number, number];
  onChange: (axis: Axis, value: number) => void;
  onCommit: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[9px] text-white/35">{label}</span>
        <span className="text-[8px] text-white/20">{unit}</span>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {AXES.map((axis) => (
          <NumberField
            key={axis.axis}
            axis={axis}
            value={values[axis.axis]}
            onChange={(value) => onChange(axis.axis, value)}
            onCommit={onCommit}
          />
        ))}
      </div>
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
  onCommit?: () => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[9px] text-white/35">{label}</span>
        <span className="text-[9px] tabular-nums text-white/45">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onBlur={onCommit}
        className="h-1 w-full cursor-pointer accent-[#5eead4]"
      />
    </label>
  );
}

function MaterialEditor({ object }: { object: WorldObject }) {
  const updateObjectMaterial = useStudioStore(
    (state) => state.updateObjectMaterial,
  );
  const logAction = useStudioStore((state) => state.logAction);
  const material = object.material;

  if (!material) {
    return (
      <p className="text-[9px] leading-4 text-white/25">
        该对象未暴露材质覆盖，颜色由程序化构建器决定。
      </p>
    );
  }

  const color = safeColor(material.color);
  const roughness = material.roughness ?? 0.8;
  const metalness = material.metalness ?? 0;
  const isLiquidWater =
    object.kind === 'water' && !Boolean(object.params?.frozen);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2.5 rounded-lg border border-white/[0.07] bg-black/20 p-1.5">
        <span
          className="relative h-7 w-9 overflow-hidden rounded-md border border-white/10"
          style={{ backgroundColor: color }}
        >
          <input
            type="color"
            value={color}
            onChange={(event) =>
              updateObjectMaterial(object.id, { color: event.target.value })
            }
            onBlur={() => logAction('调整材质颜色', object.name)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="材质颜色"
          />
        </span>
        <span className="min-w-0">
          <span className="block text-[8px] uppercase tracking-[0.1em] text-white/25">
            基础颜色
          </span>
          <span className="block font-mono text-[10px] uppercase text-white/60">
            {color}
          </span>
        </span>
        <span className="ml-auto text-[8px] text-white/22">点击色块修改</span>
      </label>

      {isLiquidWater ? (
        <p className="text-[9px] leading-4 text-white/25">
          水面使用实时着色器；颜色会应用到浅水层。粗糙度与金属感由水体着色器控制，故未在此暴露。
        </p>
      ) : (
        <>
          <RangeControl
            label="粗糙度"
            value={Math.min(1, Math.max(0, roughness))}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(roughness * 100)}%`}
            onChange={(value) =>
              updateObjectMaterial(object.id, { roughness: value })
            }
            onCommit={() => logAction('调整材质', `${object.name} · 粗糙度`)}
          />
          <RangeControl
            label="金属感"
            value={Math.min(1, Math.max(0, metalness))}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(metalness * 100)}%`}
            onChange={(value) =>
              updateObjectMaterial(object.id, { metalness: value })
            }
            onCommit={() => logAction('调整材质', `${object.name} · 金属感`)}
          />
        </>
      )}
    </div>
  );
}

function ObjectEditor({ object }: { object: WorldObject }) {
  const updateObjectName = useStudioStore((state) => state.updateObjectName);
  const updateObjectVector = useStudioStore(
    (state) => state.updateObjectVector,
  );
  const logAction = useStudioStore((state) => state.logAction);

  return (
    <section className="space-y-3 rounded-xl border border-white/[0.075] bg-white/[0.022] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[9px] text-white/45">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: OBJECT_KIND_COLORS[object.kind] }}
          />
          {OBJECT_KIND_LABELS[object.kind]}
        </div>
        <span className="font-mono text-[8px] text-white/18">
          {object.id.slice(0, 8)}
        </span>
      </div>

      <input
        value={object.name}
        onChange={(event) =>
          updateObjectName(object.id, event.target.value)
        }
        onBlur={() => logAction('重命名对象', object.name)}
        maxLength={100}
        aria-label="对象名称"
        className="focus-ring w-full rounded-lg border border-white/[0.08] bg-black/20 px-2.5 py-2 text-[12px] font-medium text-white/80 transition focus:border-mint-300/30"
      />

      {object.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {object.tags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-white/[0.06] bg-white/[0.025] px-1.5 py-0.5 text-[8px] text-white/30"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="h-px bg-white/[0.05]" />

      <SectionLabel>变换 / TRANSFORM</SectionLabel>
      <VectorEditor
        label="位置"
        unit="米"
        values={object.transform.position}
        onChange={(axis, value) =>
          updateObjectVector(object.id, 'position', axis, value)
        }
        onCommit={() => logAction('移动对象', object.name)}
      />
      <VectorEditor
        label="旋转"
        unit="角度"
        values={object.transform.rotation.map(
          (radians) => Math.round(((radians * 180) / Math.PI) * 10) / 10,
        ) as [number, number, number]}
        onChange={(axis, degrees) =>
          updateObjectVector(
            object.id,
            'rotation',
            axis,
            (degrees * Math.PI) / 180,
          )
        }
        onCommit={() => logAction('旋转对象', object.name)}
      />
      <VectorEditor
        label="缩放"
        unit="倍率"
        values={object.transform.scale}
        onChange={(axis, value) =>
          updateObjectVector(object.id, 'scale', axis, value)
        }
        onCommit={() => logAction('缩放对象', object.name)}
      />

      <div className="h-px bg-white/[0.05]" />

      <SectionLabel>材质 / MATERIAL</SectionLabel>
      <MaterialEditor object={object} />
    </section>
  );
}

function WorldSummary() {
  const project = useStudioStore((state) => state.project);
  const world = useStudioStore((state) => state.world);
  const selectedConcept =
    project?.concepts.find(
      (concept) => concept.id === project.selectedConceptId,
    ) ?? project?.concepts[0];
  const coverUrl = selectedConcept
    ? resolveMediaUrl(selectedConcept.imageUrl)
    : null;

  if (!world) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.075] bg-white/[0.022]">
      <div className="relative h-[82px] overflow-hidden bg-black/30">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={selectedConcept?.title ?? '概念图'}
            className="h-full w-full object-cover opacity-80"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-5 w-5 text-white/15" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0f15] via-[#0b0f15]/20 to-transparent" />
        {coverUrl ? <span className="absolute left-2.5 top-2 rounded bg-black/45 px-1.5 py-0.5 text-[8px] text-white/55">{selectedConcept?.mock ? 'Mock 概念参考' : 'AI 概念参考'}</span> : null}
        <div className="absolute inset-x-2.5 bottom-2 flex items-end justify-between gap-2">
          <span className="truncate text-[10px] font-medium text-white/75">
            {world.title}
          </span>
          <WorldBadge mock={world.meta.mock} />
        </div>
      </div>
      <div className="space-y-2 px-3 pb-3 pt-2">
        <p className="line-clamp-2 text-[9px] leading-4 text-white/28">
          {world.summary}
        </p>
        <div className="flex items-center justify-between border-t border-white/[0.05] pt-2 text-[8px] text-white/25">
          <span className="inline-flex items-center gap-1">
            <CubeIcon className="h-2.5 w-2.5" />
            {world.objects.length} 个独立对象
          </span>
          <span>{selectedConcept?.styleLabel ?? '程序化场景'}</span>
          <span>Schema v1</span>
        </div>
      </div>
    </section>
  );
}

function EmptySelection() {
  const world = useStudioStore((state) => state.world);
  return (
    <section className="rounded-xl border border-dashed border-white/[0.09] bg-white/[0.015] px-4 py-5 text-center">
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.025]">
        <MouseIcon className="h-4 w-4 text-white/25" />
      </div>
      <div className="mt-2.5 text-[10px] text-white/40">未选中对象</div>
      <p className="mt-1 text-[9px] leading-4 text-white/22">
        在 3D 视图中点击任意物体，或从左侧对象树中选择，即可编辑名称、变换与材质。
      </p>
      {world ? (
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {Object.entries(
            world.objects.reduce<Record<string, number>>((acc, object) => {
              acc[object.kind] = (acc[object.kind] ?? 0) + 1;
              return acc;
            }, {}),
          )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([kind, count]) => (
              <span
                key={kind}
                className="rounded border border-white/[0.06] bg-black/20 px-1.5 py-0.5 text-[8px] text-white/28"
              >
                {OBJECT_KIND_LABELS[kind as WorldObject['kind']]} × {count}
              </span>
            ))}
        </div>
      ) : null}
    </section>
  );
}

function EnvironmentEditor() {
  const world = useStudioStore((state) => state.world);
  const setEnvironmentPreset = useStudioStore(
    (state) => state.setEnvironmentPreset,
  );
  const setEnvironmentNumber = useStudioStore(
    (state) => state.setEnvironmentNumber,
  );
  const logAction = useStudioStore((state) => state.logAction);

  if (!world) return null;
  const environment = world.environment;

  if (!environment) return null;

  const applySeason = (season: SeasonId) => {
    if (season === environment.season) return;
    setEnvironmentPreset({ season });
  };
  const applyWeather = (weather: WeatherId) => {
    if (weather === environment.weather) return;
    setEnvironmentPreset({ weather });
  };
  const applyTime = (timeOfDay: TimeOfDayId) => {
    if (timeOfDay === environment.timeOfDay) return;
    setEnvironmentPreset({ timeOfDay });
  };

  const restoreLighting = () => {
    const lighting = recommendedLighting(
      environment.weather,
      environment.timeOfDay,
    );
    setEnvironmentNumber('sunIntensity', lighting.sunIntensity);
    setEnvironmentNumber('ambientIntensity', lighting.ambientIntensity);
    setEnvironmentNumber('fogDensity', lighting.fogDensity);
    logAction(
      '恢复推荐光照',
      `${WEATHER_LABELS[environment.weather]} · ${TIME_LABELS[environment.timeOfDay]}`,
    );
  };

  return (
    <section className="space-y-3 rounded-xl border border-white/[0.075] bg-white/[0.022] p-3">
      <div className="flex items-center justify-between">
        <SectionLabel>环境 / ENVIRONMENT</SectionLabel>
        <SlidersIcon className="h-3 w-3 text-white/20" />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[9px] text-white/35">季节</span>
          <span className="text-[8px] text-white/20">影响植被与地表</span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {SEASON_OPTIONS.map((season) => {
            const active = environment.season === season.id;
            return (
              <button
                key={season.id}
                type="button"
                onClick={() => applySeason(season.id)}
                className={`focus-ring rounded-lg border px-2 py-1.5 text-left transition ${
                  active
                    ? 'border-mint-300/35 bg-mint-300/[0.09] text-mint-50/85'
                    : 'border-white/[0.06] bg-black/15 text-white/40 hover:border-white/12 hover:bg-white/[0.03]'
                }`}
              >
                <span className="block text-[10px]">{season.label}</span>
                <span
                  className={`mt-0.5 block text-[8px] ${
                    active ? 'text-mint-200/45' : 'text-white/20'
                  }`}
                >
                  {season.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[9px] text-white/35">天气</span>
          <span className="text-[8px] text-white/20">影响光照、粒子与雾</span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {WEATHER_OPTIONS.map((weather) => {
            const active = environment.weather === weather.id;
            return (
              <button
                key={weather.id}
                type="button"
                onClick={() => applyWeather(weather.id)}
                title={weather.hint}
                className={`focus-ring rounded-md border px-1 py-1.5 text-[9px] transition ${
                  active
                    ? 'border-mint-300/35 bg-mint-300/[0.09] text-mint-50/85'
                    : 'border-white/[0.06] bg-black/15 text-white/38 hover:border-white/12 hover:bg-white/[0.03]'
                }`}
              >
                {weather.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[9px] text-white/35">时间</div>
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-white/[0.06] bg-black/15 p-0.5">
          {TIME_OPTIONS.map((time) => {
            const active = environment.timeOfDay === time.id;
            return (
              <button
                key={time.id}
                type="button"
                onClick={() => applyTime(time.id)}
                className={`focus-ring rounded-md py-1.5 text-[9px] transition ${
                  active
                    ? 'bg-mint-300/[0.13] text-mint-100/85'
                    : 'text-white/35 hover:bg-white/[0.04] hover:text-white/60'
                }`}
              >
                {time.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.055] bg-black/15 p-2.5">
        <SectionLabel
          action={
            <button
              type="button"
              onClick={restoreLighting}
              className="text-[8px] text-mint-200/45 underline-offset-2 transition hover:text-mint-200/80 hover:underline"
            >
              按天气推荐
            </button>
          }
        >
          光照与雾
        </SectionLabel>
        <div className="mt-2.5 space-y-2.5">
          <RangeControl
            label="太阳光照"
            value={environment.sunIntensity}
            min={0}
            max={6}
            step={0.1}
            display={environment.sunIntensity.toFixed(1)}
            onChange={(value) =>
              setEnvironmentNumber('sunIntensity', value)
            }
            onCommit={() => logAction('调整光照', '太阳强度')}
          />
          <RangeControl
            label="环境光"
            value={environment.ambientIntensity}
            min={0}
            max={3}
            step={0.05}
            display={environment.ambientIntensity.toFixed(2)}
            onChange={(value) =>
              setEnvironmentNumber('ambientIntensity', value)
            }
            onCommit={() => logAction('调整光照', '环境光强度')}
          />
          <RangeControl
            label="雾密度"
            value={environment.fogDensity}
            min={0}
            max={0.06}
            step={0.001}
            display={`${(environment.fogDensity * 1000).toFixed(1)}`}
            onChange={(value) => setEnvironmentNumber('fogDensity', value)}
            onCommit={() => logAction('调整雾密度')}
          />
        </div>
        <p className="mt-2 text-[8px] leading-4 text-white/18">
          切换天气或时间会套用推荐光照；此处可继续手动微调。
        </p>
      </div>
    </section>
  );
}

export function Inspector() {
  const world = useStudioStore((state) => state.world);
  const selectedObjectId = useStudioStore((state) => state.selectedObjectId);
  const selectedObject =
    world?.objects.find((object) => object.id === selectedObjectId) ?? null;

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0b0f15]/85">
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-3.5 py-2.5">
        <div>
          <div className="text-[10px] font-semibold tracking-wide text-white/65">
            属性面板
          </div>
          <div className="mt-0.5 text-[8px] uppercase tracking-[0.18em] text-white/22">
            Inspector
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.025] px-1.5 py-0.5 text-[8px] text-white/28">
          <CubeIcon className="h-2.5 w-2.5" />
          World Schema
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
        <WorldSummary />
        {selectedObject ? (
          <ObjectEditor object={selectedObject} />
        ) : (
          <EmptySelection />
        )}
        <EnvironmentEditor />
        <p className="px-1 pb-1 text-[8px] leading-4 text-white/18">
          修改首先作用于本地预览；点击顶部「保存世界」后才会写入服务端。所有对象均为独立可编辑实体，概念图未被贴入 3D 场景。
        </p>
      </div>
    </aside>
  );
}
