import { useEffect, useMemo, useRef, useState } from 'react';
import {
  OBJECT_KIND_COLORS,
  OBJECT_KIND_LABELS,
  SEASON_LABELS,
  TIME_LABELS,
  WEATHER_LABELS,
  formatTime,
} from '../../lib/labels';
import { useStudioStore } from '../../stores/studio-store';
import {
  ChatIcon,
  CheckIcon,
  ClockIcon,
  LayersIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
} from '../ui/icons';
import { MockBadge, Spinner } from '../ui/primitives';

type TabId = 'chat' | 'objects' | 'history';

function ChatPanel() {
  const messages = useStudioStore((state) => state.chatMessages);
  const chatLoading = useStudioStore((state) => state.chatLoading);
  const sendChat = useStudioStore((state) => state.sendChat);
  const applySuggestion = useStudioStore((state) => state.applyChatSuggestion);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = listRef.current;
    if (element) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length, chatLoading]);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || chatLoading) return;
    setDraft('');
    void sendChat(trimmed);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {messages.map((message) =>
          message.role === 'assistant' ? (
            <div key={message.id} className="animate-fade">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-md border border-mint-300/15 bg-mint-300/[0.06]">
                  <SparklesIcon className="h-2.5 w-2.5 text-mint-300/70" />
                </span>
                <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-white/28">
                  Studio Assistant
                </span>
                {message.mock ? <MockBadge compact /> : message.mock === false ? (
                  <span className="rounded-full border border-mint-300/20 bg-mint-300/5 px-1.5 py-0.5 text-[8px] font-semibold text-mint-200/80">LIVE · 真实对话</span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap rounded-xl rounded-tl-sm border border-white/[0.07] bg-white/[0.028] px-3 py-2.5 text-[11px] leading-[1.75] text-white/55">
                {message.content}
              </div>
              {message.suggestion ? (
                <div className="mt-2 rounded-xl border border-mint-300/12 bg-mint-300/[0.035] p-2.5">
                  <div className="text-[9px] uppercase tracking-[0.12em] text-mint-200/45">
                    环境建议
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {message.suggestion.season ? (
                      <span className="rounded-md border border-white/[0.07] bg-black/20 px-1.5 py-0.5 text-[9px] text-white/55">
                        {SEASON_LABELS[message.suggestion.season]}
                      </span>
                    ) : null}
                    {message.suggestion.weather ? (
                      <span className="rounded-md border border-white/[0.07] bg-black/20 px-1.5 py-0.5 text-[9px] text-white/55">
                        {WEATHER_LABELS[message.suggestion.weather]}
                      </span>
                    ) : null}
                    {message.suggestion.timeOfDay ? (
                      <span className="rounded-md border border-white/[0.07] bg-black/20 px-1.5 py-0.5 text-[9px] text-white/55">
                        {TIME_LABELS[message.suggestion.timeOfDay]}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => applySuggestion(message.suggestion)}
                    className="focus-ring mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-mint-300/20 bg-mint-300/[0.07] px-2 py-1.5 text-[10px] font-medium text-mint-100/80 transition hover:bg-mint-300/[0.12]"
                  >
                    应用到本地预览
                    <span className="text-[9px] text-mint-200/45">
                      （需保存）
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[90%] rounded-xl rounded-tr-sm border border-mint-300/15 bg-mint-300/[0.075] px-3 py-2 text-[11px] leading-[1.7] text-mint-50/80">
                {message.content}
              </div>
            </div>
          ),
        )}

        {chatLoading ? (
          <div className="flex items-center gap-2 px-1 text-white/35">
            <span className="flex h-5 w-5 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03]">
              <Spinner className="h-2.5 w-2.5" />
            </span>
            <div className="flex gap-1">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="h-1 w-1 animate-bounce rounded-full bg-white/30"
                  style={{ animationDelay: `${index * 120}ms` }}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-white/[0.06] p-2.5">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-2 transition focus-within:border-mint-300/25">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 500))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="询问场景，或试试“把场景改成冬天”…"
            className="focus-ring w-full resize-none bg-transparent px-1 text-[11px] leading-5 text-white/75 placeholder:text-white/22"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="px-1 text-[8px] text-white/20">
              Mock / Live 由设置控制 · 仅文字建议
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim() || chatLoading}
              className="focus-ring flex h-6 w-6 items-center justify-center rounded-md bg-mint-300/90 text-[#06201d] transition hover:bg-mint-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/25"
              aria-label="发送消息"
            >
              <SendIcon className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ObjectPanel() {
  const world = useStudioStore((state) => state.world);
  const selectedObjectId = useStudioStore((state) => state.selectedObjectId);
  const selectObject = useStudioStore((state) => state.selectObject);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!world) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return world.objects;
    return world.objects.filter((object) => {
      const kind = OBJECT_KIND_LABELS[object.kind];
      return (
        object.name.toLowerCase().includes(normalized) ||
        kind.includes(normalized) ||
        object.kind.includes(normalized) ||
        object.tags.some((tag) => tag.toLowerCase().includes(normalized))
      );
    });
  }, [world, query]);

  if (!world) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-white/[0.05] p-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5">
          <SearchIcon className="h-3 w-3 text-white/25" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对象、类型或标签"
            className="focus-ring min-w-0 flex-1 bg-transparent text-[10px] text-white/65 placeholder:text-white/22"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-[9px] text-white/25 hover:text-white/60"
            >
              清除
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-[10px] text-white/25">
            没有匹配的对象
          </div>
        ) : (
          filtered.map((object, index) => {
            const active = object.id === selectedObjectId;
            return (
              <button
                key={object.id}
                type="button"
                onClick={() => selectObject(object.id)}
                className={`focus-ring group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                  active
                    ? 'bg-mint-300/[0.075] text-white/85'
                    : 'text-white/55 hover:bg-white/[0.035]'
                }`}
              >
                <span className="w-4 text-right text-[8px] tabular-nums text-white/18">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: OBJECT_KIND_COLORS[object.kind] }}
                />
                <span className="min-w-0 flex-1 truncate text-[10px]">
                  {object.name}
                </span>
                <span
                  className={`shrink-0 text-[8px] ${
                    active ? 'text-mint-200/55' : 'text-white/22'
                  }`}
                >
                  {OBJECT_KIND_LABELS[object.kind]}
                </span>
                {active ? (
                  <CheckIcon className="h-2.5 w-2.5 shrink-0 text-mint-300/70" />
                ) : null}
              </button>
            );
          })
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-white/[0.06] px-3 py-2 text-[9px] text-white/25">
        <span>
          显示 {filtered.length} / {world.objects.length} 个独立对象
        </span>
        <span>点击选中</span>
      </div>
    </div>
  );
}

function HistoryPanel() {
  const actionLog = useStudioStore((state) => state.actionLog);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {actionLog.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <ClockIcon className="h-4 w-4 text-white/22" />
            </div>
            <div className="mt-3 text-[10px] text-white/35">暂无操作记录</div>
            <p className="mt-1 text-[9px] leading-4 text-white/20">
              生成世界、应用环境预设或保存后会出现在这里。
            </p>
          </div>
        ) : (
          <ol className="relative space-y-0.5 border-l border-white/[0.07] pl-3">
            {actionLog.map((entry, index) => (
              <li key={entry.id} className="relative py-2">
                <span
                  className={`absolute -left-[16.5px] top-[13px] h-1.5 w-1.5 rounded-full border ${
                    index === 0
                      ? 'border-mint-300/50 bg-mint-300/80'
                      : 'border-white/20 bg-[#0d1117]'
                  }`}
                />
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`text-[10px] leading-4 ${
                      index === 0 ? 'text-white/65' : 'text-white/42'
                    }`}
                  >
                    {entry.label}
                  </span>
                  <span className="shrink-0 text-[8px] tabular-nums text-white/20">
                    {formatTime(entry.at)}
                  </span>
                </div>
                {entry.detail ? (
                  <p className="mt-0.5 text-[9px] leading-4 text-white/25">
                    {entry.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="shrink-0 border-t border-white/[0.06] px-3 py-2 text-[9px] leading-4 text-white/22">
        操作记录保存在当前会话中；世界修改只在点击「保存世界」后写入服务端。
      </div>
    </div>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<TabId>('chat');
  const objectCount = useStudioStore((state) => state.world?.objects.length ?? 0);
  const logCount = useStudioStore((state) => state.actionLog.length);

  const tabs: Array<{ id: TabId; label: string; count?: number; icon: typeof ChatIcon }> = [
    { id: 'chat', label: 'AI 对话', icon: ChatIcon },
    { id: 'objects', label: '对象', count: objectCount, icon: LayersIcon },
    { id: 'history', label: '历史', count: logCount, icon: ClockIcon },
  ];

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-[#0b0f15]/85">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-2 pt-2">
        {tabs.map(({ id, label, count, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`focus-ring relative flex flex-1 items-center justify-center gap-1.5 rounded-t-lg px-2 py-2 text-[10px] transition ${
                active
                  ? 'bg-white/[0.035] text-white/80'
                  : 'text-white/32 hover:bg-white/[0.02] hover:text-white/55'
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
              {typeof count === 'number' && count > 0 ? (
                <span
                  className={`rounded-full px-1 text-[8px] tabular-nums ${
                    active
                      ? 'bg-mint-300/12 text-mint-200/70'
                      : 'bg-white/[0.05] text-white/25'
                  }`}
                >
                  {count}
                </span>
              ) : null}
              {active ? (
                <span className="absolute inset-x-2 -bottom-px h-px bg-gradient-to-r from-transparent via-mint-300/70 to-transparent" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'chat' ? <ChatPanel /> : null}
        {tab === 'objects' ? <ObjectPanel /> : null}
        {tab === 'history' ? <HistoryPanel /> : null}
      </div>
    </aside>
  );
}
