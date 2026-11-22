import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHAT_BASE_URLS, IMAGE_BASE_URLS, type ChatApiProtocol, type ChatSettings, type ImageApiProtocol, type ImageResponseFormat, type ImageSettings, type TokenParameter } from '@ai-three-studio/shared';
import { api, errorMessage } from '../lib/api';
import { BrandMark, ErrorBanner, Spinner } from '../components/ui/primitives';
import { ArrowLeftIcon } from '../components/ui/icons';

const inputClass = 'focus-ring mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white/80 disabled:opacity-50 [&>option]:bg-[#14201f]';
const buttonClass = 'focus-ring rounded-lg border border-white/10 px-4 py-2 text-xs text-white/65 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-35';

const chatProtocolHelp: Record<ChatApiProtocol, string> = {
  openai: '适用于 OpenAI Chat Completions，以及采用该协议的豆包、DeepSeek、千问、MiniMax、GLM 和自定义代理。填写 API 根地址，自动追加 /chat/completions。',
  'openai-responses': '适用于 OpenAI Responses 协议，自动追加 /responses；模型 ID 按服务商文档填写。',
  anthropic: '适用于 Claude / Anthropic Messages 协议，自动追加 /messages，使用 x-api-key 认证。',
  gemini: '适用于 Gemini 原生 generateContent 协议，通常填写以 /v1beta 结尾的根地址，使用 x-goog-api-key 认证。',
};
const imageProtocolHelp: Record<ImageApiProtocol, string> = {
  openai: 'OpenAI Images 兼容协议，自动追加 /images/generations；适用于提供该接口的图片模型与代理，支持 Base64 或图片 URL 返回。',
  seedream: '豆包 Seedream / 火山方舟图片协议，根地址示例 https://ark.cn-beijing.volces.com/api/v3；填写平台模型 ID 或推理接入点 ID。不是即梦网页接口或 AK/SK 签名接口。',
  gemini: 'Gemini 原生 generateContent 生图协议，选择具备图片输出能力的模型；通常使用 /v1beta 根地址。',
  dashscope: '千问 DashScope 原生同步图片协议，根地址示例 https://dashscope.aliyuncs.com/api/v1；使用 multimodal-generation 接口，不是异步文生图任务接口。',
};

function ImageApiSettings({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [saved, setSaved] = useState<ImageSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [baseURL, setBaseURL] = useState<string>(IMAGE_BASE_URLS[0]);
  const [model, setModel] = useState('gpt-image-1');
  const [protocol, setProtocol] = useState<ImageApiProtocol>('openai');
  const [size, setSize] = useState('');
  const [responseFormat, setResponseFormat] = useState<ImageResponseFormat>('auto');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const apply = (value: ImageSettings) => {
    setSaved(value); setEnabled(value.enabled); setBaseURL(value.baseURL); setModel(value.model); setApiKey('');
    setProtocol(value.protocol ?? 'openai'); setSize(value.size ?? ''); setResponseFormat(value.responseFormat ?? 'auto');
  };
  useEffect(() => {
    let active = true;
    setBusy(true);
    api.getImageSettings().then((value) => { if (active) { apply(value); setError(null); } })
      .catch((reason) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [reload]);
  const changedEndpoint = saved !== null && (baseURL !== saved.baseURL || protocol !== (saved.protocol ?? 'openai'));
  const dirty = saved !== null && (enabled !== saved.enabled || changedEndpoint || model !== saved.model || size !== (saved.size ?? '') || responseFormat !== (saved.responseFormat ?? 'auto') || apiKey !== '');
  const needsKey = enabled && !apiKey && (!saved?.hasApiKey || changedEndpoint);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!saved || busy || needsKey) return;
    setBusy(true); setError(null); setNotice(null);
    try { apply(await api.saveImageSettings({ enabled, baseURL, model, protocol, size, responseFormat, apiKey })); setNotice('图片 API 设置已保存，没有发送图片生成请求。'); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setApiKey(''); setBusy(false); }
  };
  const clear = async () => {
    if (busy || !window.confirm('仅清除概念图 API 密钥并关闭图片生成？建模 API 不受影响，已发出的请求无法撤回。')) return;
    setBusy(true); setError(null); setNotice(null);
    try { apply(await api.clearImageKey()); setNotice('概念图密钥已清除；建模 API 设置未改变。'); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setApiKey(''); setBusy(false); }
  };
  return (
    <section aria-label="概念图 API 配置" aria-busy={busy} className="panel mt-7 rounded-2xl p-5 sm:p-7">
      <h2 className="text-lg font-semibold text-white/85">概念预览图 API</h2>
      <p className="mt-2 text-xs leading-6 text-white/45">独立填写图片服务地址、图片模型和密钥。图片生成与 Three.js 建模配置互不影响；建模模型不必能生成图片，但必须支持图片输入与结构化文本输出。</p>
      {error ? <ErrorBanner message={error} className="mt-4" /> : null}
      {!saved && !busy ? <button onClick={() => setReload((value) => value + 1)} className={`${buttonClass} mt-4`}>重新读取图片设置</button> : null}
      {saved ? (
        <form onSubmit={(event) => void save(event)} autoComplete="off" className="mt-5">
          <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
            <label className="flex items-center gap-3 text-sm text-mint-100"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="accent-[#6ee7c4]" />启用 AI 生成概念预览图</label>
            <label className="block text-xs text-white/60">图片 API 协议<select value={protocol} onChange={(event) => setProtocol(event.target.value as ImageApiProtocol)} className={inputClass}><option value="openai">OpenAI Images 兼容</option><option value="seedream">豆包 Seedream / 火山方舟</option><option value="gemini">Gemini 原生生图</option><option value="dashscope">千问 DashScope 原生生图</option></select></label>
            <p className="break-words text-[11px] leading-5 text-white/40">{imageProtocolHelp[protocol]}</p>
            <label className="block text-xs text-white/60">图片 API Base URL<input type="url" value={baseURL} onChange={(event) => setBaseURL(event.target.value)} list="image-endpoints" required maxLength={2048} spellCheck={false} className={inputClass} /><datalist id="image-endpoints">{IMAGE_BASE_URLS.map((url) => <option key={url} value={url} />)}</datalist></label>
            <p className="text-[11px] leading-5 text-white/35">可填写任意公网 HTTPS 服务或兼容代理地址，候选地址不是白名单。禁止内网地址、URL 内嵌密钥与重定向；图片下载不会转发 API Key。</p>
            <label className="block text-xs text-white/60">图片模型名称<input value={model} onChange={(event) => setModel(event.target.value)} required maxLength={160} placeholder="填写服务商提供的模型 ID 或接入点 ID" className={inputClass} /></label>
            <label className="block text-xs text-white/60">图片尺寸（可选）<input value={size} onChange={(event) => setSize(event.target.value)} maxLength={80} placeholder={protocol === 'seedream' ? '留空使用 2K；也可按模型文档填写' : protocol === 'gemini' ? '例如 1K / 2K，留空使用服务默认值' : '例如 1024x1024，留空使用服务默认值'} className={inputClass} /></label>
            {(protocol === 'openai' || protocol === 'seedream') ? <label className="block text-xs text-white/60">图片返回格式<select value={responseFormat} onChange={(event) => setResponseFormat(event.target.value as ImageResponseFormat)} className={inputClass}><option value="auto">自动（按协议默认值）</option><option value="b64_json">Base64 · b64_json</option><option value="url">图片 URL</option></select><span className="mt-2 block text-[11px] leading-5 text-white/35">部分 GPT Image 模型不接受 response_format，请选自动；尺寸和返回格式均须符合所选模型文档。</span></label> : null}
            <label className="block text-xs text-white/60">图片 API Key · {saved.hasApiKey ? '已配置' : '未配置'}<input type="password" name="image-api-key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} maxLength={1024} autoComplete="new-password" spellCheck={false} placeholder={saved.hasApiKey && !changedEndpoint ? '留空保留图片密钥' : '输入图片服务 API Key'} className={inputClass} /></label>
            <p className="text-[11px] leading-5 text-white/35">地址和协议不变时留空保留图片密钥，更换地址或协议不沿用旧密钥；绝不自动使用建模密钥。保存后输入框清空。</p>
            {needsKey ? <p className="text-xs text-amber-200/80">请填写独立图片密钥后保存。</p> : null}
            <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || !dirty || needsKey} className="focus-ring rounded-lg bg-mint-300 px-4 py-2 text-xs font-semibold text-[#06201d] disabled:opacity-35">保存图片设置</button><button type="button" disabled={busy || !saved.hasApiKey} onClick={() => void clear()} className={buttonClass}>清除图片密钥</button></div>
            <p className="text-[11px] leading-5 text-white/35">开启后，新建项目、换一批或生成相似方案会调用图片 API，多张图按服务商规则分别计费；失败明确报错，不会用 Mock 替代。原始上传参考图仅保存，不参与生成或看图理解；建模时发送的是选中的真实 PNG / JPEG 生成预览。</p>
          </fieldset>
        </form>
      ) : busy ? <p className="mt-4 text-xs text-white/40">正在读取图片设置…</p> : null}
      {notice ? <p role="status" className="mt-4 text-xs leading-6 text-mint-200">{notice}</p> : null}
    </section>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const [saved, setSaved] = useState<ChatSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [modelingEnabled, setModelingEnabled] = useState(false);
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4o-mini');
  const [protocol, setProtocol] = useState<ChatApiProtocol>('openai');
  const [jsonMode, setJsonMode] = useState(false);
  const [tokenParameter, setTokenParameter] = useState<TokenParameter>('max_tokens');
  const [maxOutputTokens, setMaxOutputTokens] = useState('10000');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<'save' | 'clear' | 'test' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [imageDirty, setImageDirty] = useState(false);

  const apply = (settings: ChatSettings) => {
    setSaved(settings);
    setEnabled(settings.enabled);
    setModelingEnabled(settings.modelingEnabled);
    setBaseURL(settings.baseURL);
    setModel(settings.model);
    setProtocol(settings.protocol ?? 'openai');
    setJsonMode(settings.jsonMode ?? false);
    setTokenParameter(settings.tokenParameter ?? 'max_tokens');
    setMaxOutputTokens(String(settings.maxOutputTokens ?? 10000));
    setApiKey('');
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setApiKey('');
    api.getChatSettings()
      .then((settings) => { if (active) apply(settings); })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const busy = loading || operation !== null;
  const endpointChanged = saved !== null && (baseURL !== saved.baseURL || protocol !== (saved.protocol ?? 'openai'));
  const dirty = saved !== null && (enabled !== saved.enabled || modelingEnabled !== saved.modelingEnabled || endpointChanged || model !== saved.model || jsonMode !== (saved.jsonMode ?? false) || tokenParameter !== (saved.tokenParameter ?? 'max_tokens') || maxOutputTokens !== String(saved.maxOutputTokens ?? 10000) || apiKey !== '');
  const needsKey = (modelingEnabled || enabled) && !apiKey && (!saved?.hasApiKey || endpointChanged);

  useEffect(() => {
    if (!dirty && !imageDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, imageDirty]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !saved || needsKey) return;
    setOperation('save');
    setError(null);
    setNotice(null);
    try {
      apply(await api.saveChatSettings({ enabled, modelingEnabled, baseURL, model, protocol, jsonMode, tokenParameter, maxOutputTokens: Number(maxOutputTokens), apiKey }));
      setNotice('设置已保存到本地服务。保存不会发送模型请求。');
    } catch (reason) {
      setError(`${errorMessage(reason)} 本次输入的密钥已从表单清空，如需更换请重新输入。`);
    } finally {
      setApiKey('');
      setOperation(null);
    }
  };

  const clear = async () => {
    if (busy || !window.confirm('清除服务端保存的 API Key 并关闭 AI 建模与真实对话？未保存的表单修改也会丢弃；已发出的请求无法撤回。')) return;
    setOperation('clear');
    setError(null);
    setNotice(null);
    try {
      apply(await api.clearChatKey());
      setNotice('服务端密钥已清除，新建模和对话已恢复 Mock；已有 AI 世界不受影响。');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setApiKey('');
      setOperation(null);
    }
  };

  const test = async () => {
    if (busy || dirty || !saved?.hasApiKey) return;
    if (!window.confirm('将使用已保存的密钥和模型发送一条纯文本测试请求，可能产生 token 费用。测试不验证图片输入或建模能力。继续吗？')) return;
    setOperation('test');
    setError(null);
    setNotice(null);
    try {
      const result = await api.testChatSettings();
      setNotice(`${result.message} 此项仅为纯文本连接测试，不验证图片输入、视觉理解或完整建模能力。`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setOperation(null);
    }
  };

  const goBack = () => {
    if ((dirty || imageDirty) && !window.confirm('设置尚未保存，确定离开并丢弃表单修改吗？')) return;
    setApiKey('');
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/');
  };

  return (
    <div className="app-background min-h-screen px-5 pb-16 text-white">
      <div className="mx-auto max-w-3xl">
        <header className="flex h-[76px] items-center justify-between border-b border-white/[0.06]">
          <BrandMark />
          <button type="button" onClick={goBack} disabled={busy} className={`${buttonClass} inline-flex items-center gap-2`}>
            <ArrowLeftIcon className="h-3.5 w-3.5" /> 返回
          </button>
        </header>
        <main className="pt-10">
          <p className="text-[10px] uppercase tracking-[0.2em] text-mint-200/65">Local workspace settings</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">模型与概念图 API 设置</h1>
          <p className="mt-3 text-sm leading-7 text-white/50">
            分别配置建模 API 和图片 API：短描述先交给图片模型生成预览，选中的真实 PNG / JPEG 再交给建模模型看图扩写提示词，并由同一建模模型生成可编辑场景结构。建模模型必须同时支持图片输入（IMAGE INPUT）和结构化文本输出，不需要具备图片生成能力。两套 API 与密钥独立配置。
          </p>

          <section aria-label="Three.js 建模 API 配置" className="panel mt-7 rounded-2xl p-5 sm:p-7" aria-busy={busy}>
            <h2 className="mb-5 text-lg font-semibold text-white/85">Three.js 建模 API</h2>
            {loading ? <div className="flex items-center gap-3 text-sm text-white/50"><Spinner className="h-4 w-4" /> 正在读取设置…</div> : null}
            {error ? <ErrorBanner message={error} className="mb-5" /> : null}
            {!loading && !saved ? <button type="button" onClick={() => setReload((value) => value + 1)} className={buttonClass}>重新读取</button> : null}
            {saved ? (
              <form onSubmit={(event) => void save(event)} autoComplete="off">
                <fieldset disabled={busy} className="space-y-6 disabled:opacity-65">
                  <div className="space-y-4 border-b border-white/[0.07] pb-5">
                    <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-mint-100">
                      <input type="checkbox" checked={modelingEnabled} onChange={(event) => { setModelingEnabled(event.target.checked); setNotice(null); }} className="h-4 w-4 accent-[#6ee7c4]" />
                      启用 AI 生成 Three.js 模型
                    </label>
                    <p className="text-[11px] leading-5 text-white/45">保存后，在概念页选择真实 PNG / JPEG 预览并点击生成或重新生成。同一模型先看图扩写提示词，确认后再结合预览图与提示词建模，共两次 API 调用，两次均会发送所选图片并可能计费。支持基础几何、轮廓拉伸、旋转体和曲线，以及相机光照配置。失败明确报错，不自动降级或重试；Mock 图片不能用于付费建模。结果不是摄影测量重建或图生 GLB；不会直接运行 AI 返回的 JavaScript。</p>
                    <label className="flex cursor-pointer items-center gap-3 text-xs text-white/60">
                      <input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setNotice(null); }} className="h-4 w-4 accent-[#6ee7c4]" />
                      同时启用真实文字对话（可选）
                    </label>
                    <p className="text-[10px] text-mint-200/80">已保存：{saved.modelingEnabled ? 'AI 建模' : 'Mock 建模'} · {saved.enabled ? 'Live 对话' : 'Mock 对话'}</p>
                  </div>
                  <label className="block text-xs text-white/60">建模 API 协议<select value={protocol} onChange={(event) => setProtocol(event.target.value as ChatApiProtocol)} className={inputClass}><option value="openai">OpenAI Chat Completions 兼容</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic">Claude / Anthropic Messages</option><option value="gemini">Gemini 原生</option></select></label>
                  <p className="text-[11px] leading-5 text-white/40">{chatProtocolHelp[protocol]}</p>
                  <label className="block text-xs text-white/60">
                    建模 API Base URL
                    <input type="url" list="chat-endpoints" value={baseURL} onChange={(event) => { setBaseURL(event.target.value); setNotice(null); }} required maxLength={2048} spellCheck={false} className={inputClass} />
                    <datalist id="chat-endpoints">{CHAT_BASE_URLS.map((url) => <option key={url} value={url} />)}</datalist>
                    <span className="mt-2 block text-[11px] leading-5 text-white/35">支持自定义公网 HTTPS 地址和兼容代理，不按厂商限制。候选地址仅供参考；拒绝内网地址、URL 内嵌密钥和重定向。</span>
                  </label>
                  <label className="block text-xs text-white/60">
                    模型名称
                    <input value={model} onChange={(event) => { setModel(event.target.value); setNotice(null); }} required maxLength={160} spellCheck={false} placeholder="填写支持图片输入与结构化文本输出的模型 ID" className={inputClass} />
                    <span className="mt-2 block text-[11px] text-white/35">按服务商填写任意模型 ID，更换地址不会自动改写模型名称。启用建模前请确认此模型和接口支持 PNG / JPEG 图片输入与结构化文本输出；仅支持文字的模型不能完成看图扩写。</span>
                  </label>
                  <div className="space-y-4 rounded-xl border border-white/[0.07] p-4">
                    <h3 className="text-xs text-white/65">协议参数</h3>
                    <label className="block text-xs text-white/60">建模最大输出 Token<input type="number" min={1} max={65536} step={1} required value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(event.target.value)} className={inputClass} /></label>
                    {protocol === 'openai' ? <label className="block text-xs text-white/60">Token 参数<select value={tokenParameter} onChange={(event) => setTokenParameter(event.target.value as TokenParameter)} className={inputClass}><option value="max_tokens">max_tokens（常见兼容接口）</option><option value="max_completion_tokens">max_completion_tokens（部分新版 GPT）</option><option value="omit">不发送（使用服务商默认值）</option></select></label> : null}
                    {protocol !== 'anthropic' ? <label className="flex items-center gap-3 text-xs text-white/60"><input type="checkbox" checked={jsonMode} onChange={(event) => setJsonMode(event.target.checked)} className="accent-[#6ee7c4]" />请求原生 JSON 模式（模型支持时开启）</label> : null}
                    <p className="text-[11px] leading-5 text-white/35">不限制模型名称，但接口协议和参数须与服务商文档一致。关闭原生 JSON 模式仍会要求模型输出结构化 JSON 并严格校验；不会执行模型返回的代码，也不会失败后自动切换协议。</p>
                  </div>
                  <label className="block text-xs text-white/60">
                    API Key <span className="ml-2 text-mint-200/75">{saved.hasApiKey ? '已配置（不显示密钥）' : '未配置'}</span>
                    <input type="password" name="studio-api-key" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setNotice(null); }} maxLength={1024} autoComplete="new-password" spellCheck={false} autoCapitalize="none" placeholder={saved.hasApiKey && !endpointChanged ? '留空保留现有密钥' : '输入此服务的 API Key'} className={inputClass} />
                    <span className="mt-2 block text-[11px] leading-5 text-white/35">读取和保存后输入框均为空。地址和协议未变时留空保留密钥；更换地址或协议不会沿用旧密钥，此时关闭两个功能后保存将清除旧密钥，启用任一功能则必须输入新密钥。</span>
                  </label>
                  {needsKey ? <p className="text-xs text-amber-200/80">请为当前地址输入 API Key，或关闭 AI 建模与真实对话后保存。</p> : null}
                  <div className="flex flex-wrap gap-3 border-t border-white/[0.07] pt-5">
                    <button type="submit" disabled={busy || needsKey || !dirty} className="focus-ring rounded-lg bg-gradient-to-r from-mint-300 to-teal-200 px-5 py-2 text-xs font-semibold text-[#06201d] disabled:cursor-not-allowed disabled:opacity-40">{operation === 'save' ? '正在保存…' : '保存设置'}</button>
                    <button type="button" onClick={() => void clear()} disabled={busy || !saved.hasApiKey} className={buttonClass}>{operation === 'clear' ? '正在清除…' : '清除密钥并关闭'}</button>
                    <button type="button" onClick={() => void test()} disabled={busy || dirty || !saved.hasApiKey} className={buttonClass}>{operation === 'test' ? '测试中（最多 30 秒）…' : '测试文本连接（可能收费）'}</button>
                  </div>
                  <p className="text-[11px] leading-5 text-white/35">连接测试只发送短文本、最多等 30 秒；测试成功不代表支持图片输入、视觉理解或完整建模。后台建模不设总时限，可等待 30 分钟、两小时或更久，页面用阶段进度条展示并在完成时提示。请保持本机后端运行；服务商自身断连或超时仍可能导致失败，不会自动重试收费请求。</p>
                </fieldset>
              </form>
            ) : null}
            {notice ? <p role="status" className="mt-5 rounded-xl border border-mint-300/20 bg-mint-300/5 p-3 text-xs leading-6 text-mint-100/85">{notice}</p> : null}
          </section>

          <ImageApiSettings onDirtyChange={setImageDirty} />

          <aside className="mt-6 rounded-xl border border-amber-200/10 bg-amber-200/[0.025] p-5 text-[11px] leading-6 text-white/45">
            <h2 className="mb-1 text-xs font-medium text-white/70">本机单用户使用 · 密钥保存在服务端</h2>
            <p>密钥仅提交到本机后端，不写入浏览器存储或项目 JSON，也不会通过读取接口返回。服务端将建模与图片密钥分别明文保存在 DATA_DIR 下的 chat-settings.json 和 images-settings.json（默认 .data），不是 .env，也不是加密保险箱。请限制数据目录权限，不要分享、提交或公开备份该文件。</p>
            <p className="mt-2">API 仅绑定回环地址，并限制浏览器来源；本应用没有多用户登录认证，同机程序或有文件权限的用户仍可能访问密钥，请勿通过隧道或公网代理暴露服务。AI 建模会把原始描述与所选真实 PNG / JPEG 生成预览发送给配置的建模服务商看图扩写，再把扩写后的提示词交给同一模型生成场景，两次调用均可能计费。原始上传参考图仅保存，不会用于此流程。真实对话会发送消息和世界摘要，按服务商规则计费。</p>
          </aside>
        </main>
      </div>
    </div>
  );
}
