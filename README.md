# AI Three.js Studio

一句话生成可探索、可编辑的 3D 世界。输入简短描述或上传参考图，系统会扩展创作意图、生成多种概念方向，再把选中的方案规划为可独立编辑的 **World Schema**，最后由 React Three Fiber 实时组装 3D 场景。

> **当前状态：独立文生图 API + 长时后台 AI 几何建模 + Three.js 文件导出 + 第三人称角色漫游**
>
> 概念图和 Three.js 建模分别配置服务地址、模型与 API Key。图片模型生成实际 PNG / JPEG 预览；同一建模模型先读取所选预览图扩写提示词，用户确认后再结合预览图与提示词生成几何、布局、材质和相机光照。除 8 种基础几何外，支持轮廓拉伸、旋转体、曲线管道、带状曲面与索引网格；生成、保存、重新加载和导出均保留这些数据。建模在后台等待，不设本地总时限。这不是执行 AI 生成的任意 JavaScript，也不是照片重建或图生 GLB；未启用的功能明确标记 Mock。用户上传的原始参考图仍只保存，所选 AI 预览图会参与两次建模 API 调用。

### 本轮建模质量改进

- 预览图提示要求主体完整、连接清楚、遮挡较少，降低后续单图建模的歧义。
- 看图扩写聚焦统一尺度、轮廓、部件比例、连接方式、材料和可核查的场景特征，移除无法由当前生成器实现的角色接口等要求。
- 扩写与建模共享同一几何/渲染契约；建模时再次附上所选预览图，避免只靠中间文字传递形状。输出部件预算随 Token 配置调整。
- 校验使用实际局部几何和旋转后的包围盒；曲线采样方式与前端一致。修复地下部件时按相连结构整体抬升，避免拆散连接关系；独立景物分别处理。
- 保留相机、灯光、曝光等生成结果，避免全部作品使用同一默认视角；保存时校验并保留程序化几何，限制总估算三角面数。
- 对模型常见的等价写法先做本地归一化：相机省略 `fov` / `zoom` 时使用 48 / 1，程序化几何可纠正类型标签、显式闭合轮廓、重复路径点和缺省分段；无效几何仍会拒绝。失败任务保留安全的字段路径（例如 `objects[3].geometry.points`），几何复杂度超限单独报错，不再一律归类为对象或材质错误。修复不额外调用 API。
- JSON 解析兼容单个 Markdown 包装、完整的前置 `<think>` 块、字符串外的注释和尾逗号；不执行代码、不补齐截断内容、不拼接多个结果。解析或场景校验仍失败时，将模型响应留在 `.data/modeling-diagnostics/` 供本地排查；不记录请求、图片或设置，检测到密钥回显则不保存响应文本。诊断文件不通过 API 返回，仍需像项目数据一样妥善保管。

这些改动消除了生成器的能力限制和数据丢失问题，不代表已通过真实模型的视觉质量对比。离线回归覆盖结构、传输、保存和导出；实际相似度仍需使用同一描述、同一预览图做生成前后对比。复杂有机造型、照片级材质和精确重建仍超出当前程序化建模范围。

## 快速开始

前置条件：Node.js >= 20.19，npm >= 10。

```bash
npm install
npm run dev
```

`.env` 是可选的，默认值即可运行。如需复制示例配置：

Windows CMD：

```bat
copy apps\server\.env.example apps\server\.env
```

PowerShell：

```powershell
Copy-Item apps\server\.env.example apps\server\.env
```

Git Bash / macOS / Linux：

```bash
cp apps/server/.env.example apps/server/.env
```

- Web：http://localhost:5173
- API：http://localhost:4000/api
- 健康检查：http://localhost:4000/api/health

`npm run dev` 会先编译 `packages/shared`，再并行启动 shared 的 `tsc --watch`、NestJS API 与 Vite。Vite 将 `/api` 代理到 `http://localhost:4000`，因此无需在前端配置密钥或跨域地址。

也可以分开启动：

```bash
npm run build:shared
npm run dev:server   # 或：npm run dev -w @ai-three-studio/server
npm run dev:web      # 或：npm run dev -w @ai-three-studio/web
```

### 构建与验证

```bash
npm run typecheck   # shared + server + web 全部类型检查
npm test            # NestJS 单元测试（Vitest）
npm run build       # shared -> server -> web 生产构建
```

生产构建后：

- `apps/server/dist` 为 API 产物，`npm start` 启动 API 服务。
- `apps/web/dist` 为静态前端产物，可在本机托管；API 地址通过 `VITE_API_BASE_URL` 指定。当前 API 仅服务本机受信来源，前端预览可使用 4173 端口；公网部署需要另行实现登录认证和安全的凭据存储。

## 环境变量

服务端示例见 [`apps/server/.env.example`](apps/server/.env.example)：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `4000` | NestJS API 端口 |
| `AI_MODE` | `mock` | Phase 1 只接受 `mock`；设为其它值会启动失败并提示 Phase 2 范围 |
| `DATA_DIR` | `.data` | 项目 JSON 持久化目录，相对 `apps/server` 的运行目录 |

Phase 2 占位变量（当前不生效，且**只允许存在于服务端环境**）：

```dotenv
OPENAI_API_KEY=
IMAGE_API_KEY=
VISION_API_KEY=
MODEL_3D_API_KEY=
```

### 在设置页填写 API Key

首页或 Studio 顶部点击“API 设置”，两套表单独立保存：

- **Three.js 建模 API**：填写自定义公网 HTTPS 地址、文本模型 ID、协议与密钥；不按厂商或模型名设白名单。支持 OpenAI Chat Completions、OpenAI Responses、Claude / Anthropic Messages、Gemini generateContent。豆包、DeepSeek、千问、MiniMax、GLM 等提供 OpenAI 兼容接口时选择相应兼容协议；原生接口按服务商文档选择。文字对话是同一配置下的独立可选开关。
- **概念图 API**：独立配置图片模型与密钥，支持 OpenAI Images 兼容、豆包 Seedream / 火山方舟、Gemini 原生生图、千问 DashScope 原生同步生图。模型 ID 完全自定义，但模型必须具备图片输出能力；API 协议必须匹配。新建项目、换一批或生成相似方案会逐张调用图片服务，可能产生费用。保存设置不产生模型请求。
- 两套密钥绝不互相继承；清除图片密钥不影响建模，清除建模密钥不影响图片。地址和协议不变时留空保留原密钥；更换地址或协议不沿用旧密钥。读取接口只返回是否已配置，不回传密钥。
- 自定义公网代理可用；配置地址不允许 HTTP、内网/保留地址、URL 内嵌凭据、查询参数和片段。连接时检查实际 DNS 解析结果以阻止内网访问和 DNS 重绑定，不跟随重定向。图片响应支持 PNG / JPEG 的 Base64 或安全公网 HTTPS 图片 URL（可含签名查询参数），下载不携带 API Key，并限制字节数、尺寸和文件格式。真实请求失败明确报错，不静默回退为 Mock，不自动重试收费调用。
- 密钥仅在输入和提交时经过浏览器，不写入 localStorage / sessionStorage、不写入项目或任务 JSON。服务端**明文**存放在 `DATA_DIR/chat-settings.json` 和 `DATA_DIR/images-settings.json`，不是加密保险箱；请保护该目录，不要提交、分享或公开备份。
- API 仅绑定 `127.0.0.1`，允许本机 5173 / 4173 / API 端口来源；写请求须带 `X-Studio-Client: local-ui`。这是本机单用户应用，不具备多用户认证，请勿通过隧道或公网代理暴露服务。

建模参数可选原生 JSON 模式、最大输出 Token，以及 OpenAI 兼容接口的 `max_tokens` / `max_completion_tokens` / 不发送 Token 参数。默认不强制原生 JSON 模式，但仍严格校验模型输出的 JSON；不因参数失败自动换协议或重发。图片尺寸可自定义，Seedream 留空默认 2K；其他协议留空由服务商决定。OpenAI/Seedream 可选图片返回格式，不支持 `response_format` 的 GPT Image 模型应选“自动”。

豆包 Seedream 示例：协议选“豆包 Seedream / 火山方舟”，根地址填 `https://ark.cn-beijing.volces.com/api/v3`，模型填控制台模型 ID 或接入点 ID，密钥填方舟 API Key。即梦网页接口、AK/SK 签名接口、异步轮询任务接口和其他未实现的私有协议不能只靠改地址接入，需要对应适配器；可以使用提供上述协议的服务商兼容接口。

文生图发送原始描述与风格文字；建模模型读取所选 PNG / JPEG 概念图并扩写提示词，用户可编辑确认，再将图片和提示词共同交给同一模型生成场景。原始上传参考图仍只保存。建模模型只能返回受约束的场景 JSON，不能提供外部资源 URL 或可执行代码。真实对话发送消息及世界文字摘要。`AI_MODE` 保持 `mock`，各真实功能由设置页独立开关控制。

### 长时后台建模

选择概念后提交建模，页面立即恢复可操作状态，不再显示阻塞等待弹窗。全局进度条展示排队、等待模型、校验、保存等阶段和等待时长；上游没有百分比时不伪造完成率。页面切换或刷新不取消任务，完成后提示，点击“打开生成结果”再进入 Studio，不自动覆盖未保存预览。

建模已移除 120 秒业务期限及底层 HTTP 响应头/响应体默认超时，可等待 30 分钟、两小时或更久；连接建立、网络中断和服务商自身时限仍可能导致失败。请保持本地后端运行，开发时重启后端也会中断请求。任务状态持久化；服务重启后恢复历史任务，将未完成任务标记为中断并提示手动重试，不能续接原服务商 HTTP 请求，也不会自动重复收费。文字对话/连接测试保留 30 秒期限；前端查询任务的短超时不影响后台建模。

前端可选变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | 前端请求的 API 基地址；开发模式通常使用 Vite 代理 |

## 端到端流程

1. **描述世界**：输入 1 句话（600 字以内），可附加 PNG / JPEG / WebP 参考图（≤ 3 MB）。Phase 1 会保存参考图并展示“尚未读取像素”的明确提示。
2. **提示词扩展**：本地关键词规则识别场景类型（林间小屋 / 赛博朋克都市 / 海边小镇 / 雪山营地 / 山谷草甸）以及季节、天气、时间线索。
3. **概念方案**：独立图片 API 开启后生成 5 张真实 PNG / JPEG 风格概念图；关闭时生成带 `MOCK PREVIEW` 标记的 SVG 演示图。卡片按各自来源标注 AI / Mock，不以当前设置追溯改写旧图片来源。
4. **选择与迭代**：可选中方案、`换一批`，或基于当前方案生成同风格变体。
5. **看图扩写**：开启 AI 建模后读取所选真实 PNG / JPEG 的像素，生成中文建模提示词，弹窗供用户查看、编辑和确认。关闭 AI 时使用 Mock 元数据分析。
6. **建模任务**：模型结合原始描述、所选预览图与确认的提示词返回 2–120 个地面/基础/程序化几何部件和可选相机光照；校验形状、变换、几何复杂度、材质、渲染和出生点，由后端写入可信来源。关闭 AI 时使用 Mock 规划器。前端查询持久化任务状态并显示非阻塞进度条，成功通知、失败保留旧世界；没有本地建模总时限。重启后端会将未完成请求标记中断，需手动重试。
7. **实时组装**：R3F 用受信任的渲染代码组装模型，支持独立部件选取、名称/移动/旋转/缩放/材质及环境编辑；保存后写回服务端 JSON，AI 来源不会变回 Mock。
8. **Three.js 导出**：Studio 顶部“导出 Three.js”下载当前预览的 `.three.js` 模块，包含实际几何、材质、变换和 `worldSchema`；无须先保存，文件不包含 API Key。

### 概念页与 Studio 能力

- 概念页：选择、换一批（批次增量写入项目）、生成相似变体、返回修改描述。
- Studio 左栏：Mock 或 Live 文字对话助手（按回复明确标注）、可搜索的对象树、历史记录。
- Studio 中栏：实时 3D 预览、程序化小人、编辑/第三人称跟随切换、选择环与标签、网格、相机重置、全屏、季节/天气/时间标记。
- Studio 右栏：对象名称/类型/序列化数据、位置/旋转（度）/缩放、材质参数；环境面板含季节、天气、时间与光照/雾滑杆。
- 保存语义：所有修改先作用于本地 Zustand 预览，点击“保存世界”后才持久化；离开有未保存修改的 Studio 会二次确认。

Mock 对话助手会返回环境建议与解释，但**不会直接改写 World Schema**；需要点击“应用到本地预览”，再显式保存。

### 使用导出的 Three.js 模块

在已安装 `three` 的 Vite 等 ES Module 项目中使用下载的文件（下例将其重命名为 `world.three.js`）：

```ts
import { createWorld, worldSchema } from './world.three.js';

const scene = createWorld();
console.log(worldSchema.title);
// 将 scene 交给你自己的 renderer 和 camera 渲染。
```

导出为静态模型快照：不含角色控制、编辑器 UI 或天气动画。内置水面 Shader 保留导出时状态；外部纹理 URL 会被拒绝，避免隐藏网络依赖。文本通过 JSON 序列化作为数据写入，不会变成可执行代码。

导出专项测试（Node.js 22.15+，使用本地依赖，无需下载执行器）：

```bash
npm run test:export
```

### 角色漫游

场景默认包含一个程序化小人。点击视口上方“第三人称漫游”，再点击场景开始控制；镜头跟随小人，不提供第一人称模式：

- `WASD` / 方向键移动，`Shift` 奔跑，`Space` 跳跃。
- 鼠标转向，`Esc` 释放鼠标；浏览器不允许锁定鼠标时，按住左键拖动转向。
- `R` 或“回到出生点”重生，掉出地面后自动重生。
- 点击侧栏输入框或窗口失焦会停止移动；“编辑视角”恢复物体选择与自由相机。
- Rapier 胶囊控制器提供地面、建筑、山丘、石块及树干碰撞，并自动跨越小台阶；第三人称镜头遇到障碍会拉近。

角色是运行时探索者，不写入可编辑对象列表；位置不随“保存世界”持久化。暂不支持游泳、船只碰撞、室内开门、GLB 骨骼动画或触屏摇杆。

## 架构

```
ai-threejs-studio/
├─ apps/
│  ├─ server/                 NestJS 11 API
│  │  └─ src/
│  │     ├─ ai/               Provider 接口、真实文字建模及结构校验
│  │     │  ├─ providers/     DI token（Provider 替换点）
│  │     │  └─ mock/          规则扩展、SVG 概念图、Mock 分析/规划/对话
│  │     ├─ projects/         项目存储、建模任务、DTO、保存校验
│  │     ├─ settings/         本机 API 设置、后端密钥及受限 HTTP 传输
│  │     └─ meta/             /api/meta、/api/health
│  └─ web/                    React 19 + Vite 8 + Tailwind 4
│     └─ src/
│        ├─ pages/            Landing / Concepts / Studio / 404
│        ├─ components/
│        │  ├─ scene/         R3F 场景、程序化对象、天气与季节表现
│        │  ├─ studio/        Topbar / LeftPanel / Inspector
│        │  └─ ui/            品牌、图标、通用控件
│        ├─ store/            Zustand studio store
│        └─ lib/              API 客户端、标签、环境主题
└─ packages/shared/           前后端共享类型与 World Schema
```

### 数据与持久化

Phase 1 不依赖 PostgreSQL / Redis / BullMQ。项目写入 `apps/server/.data/projects/{projectId}.json`，启动时加载到内存；该目录已加入 `.gitignore`。这一层被封装在 `ProjectStore` / `ProjectsService` 中，后续可替换为数据库与对象存储，而不改动 API 契约。

概念图由服务端按实际 MIME 返回 PNG / JPEG / SVG，并带严格的 CSP、`nosniff` 和长缓存头。项目元数据仅引用图片 URL，存储文件的 `artifacts` 保存图片内容；旧 SVG 字符串和旧 `image.svg` 地址仍可读取。

### API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/meta` | Provider 描述、阶段与 Mock 声明 |
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/projects` | 创建项目（提示词 + 可选参考图） |
| `GET` | `/api/projects` | 项目摘要列表 |
| `GET` | `/api/projects/:id` | 项目详情 |
| `POST` | `/api/projects/:id/concepts` | `more` / `similar` 概念批次 |
| `POST` | `/api/projects/:id/world` | 创建/继续建模任务，传 conceptId，可选 regenerate；返回任务状态 |
| `GET` | `/api/projects/world-jobs` | 全局持久化任务摘要，不含世界和分析大数据 |
| `GET` | `/api/projects/:id/world-jobs/:jobId` | 查询任务状态、成功结果或失败信息 |
| `PUT` | `/api/projects/:id/world` | 保存经过服务端规范化与校验的 World Schema |
| `POST` | `/api/projects/:id/chat` | 按设置使用 Mock 建议或真实文字对话 |
| `GET` / `PUT` | `/api/settings/chat` | 读取/保存建模与对话配置，不返回密钥 |
| `DELETE` | `/api/settings/chat/key` | 清除密钥并关闭 AI 建模与真实对话 |
| `POST` | `/api/settings/chat/test` | 显式测试已保存配置，可能收费 |
| `GET` / `PUT` | `/api/settings/images` | 独立读取/保存图片配置，不返回密钥 |
| `DELETE` | `/api/settings/images/key` | 仅清除图片密钥并关闭图片生成 |
| `GET` | `/api/projects/:id/concepts/:conceptId/image` | 按实际 MIME 返回概念图产物 |
| `GET` | `/api/projects/:id/concepts/:conceptId/image.svg` | 旧概念图地址 |

前端统一处理网络失败与非 2xx；查询失败会继续查询，不重发生成请求。建模同项目活跃任务去重，生成期间拒绝修改概念或保存世界，成功后原子替换，失败保留原世界。每项目保留最新任务，全局最多 100 个；任务被替换/淘汰后旧 ID 返回 404，重启后仍保留未淘汰的终态任务。缓存匹配概念及当前建模模式、模型和端点，`regenerate` 强制重新生成。真实 API 失败不回退为 Mock，不自动重试收费请求。

## World Schema（v1）

共享定义位于 [`packages/shared/src/world-schema.ts`](packages/shared/src/world-schema.ts)。

```ts
interface WorldSchema {
  schemaVersion: 1;
  id: string;
  title: string;
  summary: string;
  source: {
    prompt: string;
    conceptId: string;
    conceptTitle: string;
    conceptStyleId: ConceptStyleId;
    provider: { name; mode: 'mock' | 'live'; vision; planner };
    generatedAt: string;
    disclaimer: string;
  };
  environment: {
    season: 'spring' | 'summer' | 'autumn' | 'winter';
    weather: 'clear' | 'cloudy' | 'light-rain' | 'heavy-rain' | 'windy' | 'snow';
    timeOfDay: 'morning' | 'day' | 'dusk' | 'night';
    sunIntensity: number;
    ambientIntensity: number;
    fogDensity: number;
  };
  objects: WorldObject[];
  spawnPoint: { position: Vec3; yawDeg: number };
  gameplay: { mode: 'explore'; notes?: string } | null;
  meta: { createdAt; updatedAt; editable; mock; objectCount };
}
```

每个 `WorldObject` 包含：

- `id` / `name` / `kind`：AI 建模生成 `ground`、`primitive`、`procedural`。`primitive` 的 `params.shape` 为 box / sphere / cylinder / cone / torus / plane / capsule / icosahedron；`procedural` 的 `geometry.type` 为 extrude / lathe / tube / ribbon / mesh，使用原生局部坐标，不自动归一化或居中。Mock 仍可生成 tree / cabin 等语义对象。
- `asset`：Phase 1 为 `procedural` primitive-group；Phase 2 可切换为 `generated-model` / `library-model` 的 GLB 引用
- `transform`：position / rotation（弧度）/ scale
- `material`：color、roughness、metalness、emissive、opacity、flatShading
- `params`：类型专属参数（如 `variant`、`seed`、`lit`、`height`、`sail`）
- `tags`

`PUT /world` 使用 `normalizeWorldForSave` 进行清洗与边界校验：拒绝未知对象类型、非法数组/字符串、NaN/Infinity，重新计算 `objectCount`，保留服务端来源信息而非信任客户端伪造的 provider/provenance。保存后的 Schema 与重新加载结果保持一致。

## Mock / Live Provider 边界

`packages/shared/src/ai-contracts.ts` 定义六类 Provider：`llm`、`image`、`vision`、`world-planner`、`model-3d`、`chat`。NestJS 通过 [`apps/server/src/ai/providers/provider.tokens.ts`](apps/server/src/ai/providers/provider.tokens.ts) 注入实现：

- `PROMPT_EXPANDER`
- `CONCEPT_IMAGE_PROVIDER`
- `IMAGE_ANALYZER`
- `WORLD_PLANNER`
- `CHAT_PROVIDER`
- `ModelAssetProvider` 接口已预留，Phase 1 为 `null`（无真实图生 3D 能力）

`AiService` 按设置分别选择 `live-world-planner` 和 `LiveConceptImageProvider`。建模使用受限 JSON 契约与 `world-plan-validation` 校验；图片经格式、大小、尺寸校验后落盘。`AI_MODE` 保持 `mock`；建模配置的 `modelingEnabled` / `enabled` 控制建模与对话，图片配置有独立 `enabled`。真实建模中的视觉分析使用同一建模 API，Mock 模式仍使用元数据分析。

后续接入图生 GLB Provider 时，继续保留来源标识、后端密钥、异步任务及显式错误边界，不得以演示资产替代失败的真实请求。

任何演示数据都必须保留 `mock: true`、卡面标记和文案声明。**禁止把 Mock 结果伪装成真实 AI 能力。**

## 阶段范围

| 阶段 | 内容 | 当前 |
| --- | --- | --- |
| Phase 1 | 提示词扩展、5 风格概念图、选择/换一批/相似方案、Mock 视觉分析、World Schema、程序化 3D 组装、对象与环境编辑、保存/重载 | 已完成 |
| Phase 2 | 真实 LLM / 文生图 / 多模态 / 图生 3D Provider，异步任务与失败重试 | 独立文生图、看图扩写、图文联合程序化建模、相机光照、持久化长时任务、Three.js 导出和可选文字对话已实现；图生 GLB 待接入 |
| Phase 3 | Rapier 物理角色、WASD/跳跃/奔跑、第三人称跟随与编辑相机、完整季节天气联动 | 基础角色漫游与静态碰撞已实现 |
| Phase 4 | 自然语言增量编辑、Sandbox 中编译测试生成代码、游戏逻辑模板 | 未开始 |

尚未实现：图生 GLB、多人协作、数据库/分布式队列和沙箱游戏生成；现有任务持久化为本机文件，不支持跨进程续接上游请求。当前 AI 建模是图文驱动的程序化几何组合，不会执行模型返回的任意 JavaScript，也不会用 Mock 冒充真实生成。

## 常见问题

### 启动报 `EADDRINUSE: address already in use :::4000`

说明已有进程占用了 API 端口（通常是上次未完全退出的开发服务）。Windows CMD：

```bat
netstat -ano | findstr :4000
taskkill /PID <上一步看到的PID> /F
```

PowerShell 可用 `Get-NetTCPConnection -LocalPort 4000`，Git Bash 可用 `netstat -ano | grep :4000`。先确认 PID 对应的是不再需要的开发进程，再结束它；不要关闭其他正在使用的服务。确认端口释放后重新运行 `npm run dev`。

Vite 的 `5173` 端口同理。不要把 API 端口随意改掉：开发环境的 Vite 代理固定指向 `http://localhost:4000`。

## 已知限制

- Mock 概念图与 Mock 场景是程序化近似，场景类型由关键词规则判定。AI 建模根据原始文字、所选概念图与建模提示词组合基础/程序化几何，受部件数量、复杂度和空间校验约束，不保证复杂有机曲面、照片级纹理或工业级建模精度。
- 参考图仅存储与标记，不参与 Phase 1 的像素级分析。
- 生产构建会把 Three.js / R3F 打成一个较大的单包（> 500 kB），适合 Phase 1 本地验证；后续可按路由懒加载与 vendor 拆包优化。
- Phase 1 的“全屏预览”在部分嵌入式浏览器/受限 iframe 中可能被宿主拒绝；失败会静默回退，不影响其余功能。
- 项目文件持久化适合单机开发；删除 `apps/server/.data` 会清空历史项目。
