# dsh-mx-rate-limit

给 DeepSeek Harness 的**请求级限流插件**。

在模型请求真正发往 provider **之前**排队，而不是等 429 回来再重试。适合 NIM 这类
"每分钟 N 次"免费额度的接口。

> English summary: a token-bucket rate limiter for DeepSeek Harness model calls.
> It queues a request before its provider call, so the provider never sees the
> burst. Mounted as an out-of-tree Cordis plugin; configured per provider route
> from the Harness settings UI. Composes with `@deepseek-ai/dsh-llm-retry`.

---

## 它做什么 / 不做什么

| | |
|---|---|
| **做** | 请求前按 route 排队，把突发摊平成"每 N 毫秒放行一个" |
| **做** | 在设置页里按 provider 配置，保存后立即生效，不用重启 |
| **不做** | 不改请求内容 —— 排队的请求和平时逐字节相同，KV Cache 复用不受影响 |
| **不做** | 不记录 session 日志事件（避免引入 harness 的日志词汇义务） |
| **不做** | 不跨进程限流。每个进程一份配额，多开就是多份 |

算法是**令牌桶**：稳态速率和突发容量是两个独立旋钮。选它而不是固定窗口，是因为
固定窗口会在窗口边界放行 2 倍请求（30/min 变成瞬间 60 次），那正是要避免的。

---

## 安装

插件安装功能接受三种来源：**包名**、**GitHub 仓库地址**、**本地目录路径**。

安装**不需要放行构建脚本、不需要任何额外配置** —— 编译后的 `lib/` 已随仓库提交，
安装时不做任何构建。

### 方式 A：从 GitHub 仓库装（分享给别人的方式）

桌面端插件安装界面填仓库地址，或用命令行：

```
github:mbxinye/deepseek-harness-mx-rate-limit
```

```bash
dsh plugin --profile desktop add github:mbxinye/deepseek-harness-mx-rate-limit
```

**更新就用同一条命令。** 安装器执行的是 `pnpm add <spec>`（`packages/boot/plugin-manager/src/index.ts`），
不带 ref 的 `github:` 依赖每次都会重新解析到仓库当前 HEAD —— 实测把 lockfile 从
`dbb56f1` 钉到 `9a981f3`（= 远端 HEAD），并且不需要 `prepare`、不需要 `allowBuilds`。
所以装了旧版本不是安装器的毛病，重装一次就是最新的。

### 方式 B：从本地目录装（开发用）

```bash
cd D:/workspace/code/GIT/deepseek-harness-mx-rate-limit
npm install
npm run build          # 改了 src/ 就要重新 build
```

然后填 `D:/workspace/code/GIT/deepseek-harness-mx-rate-limit`。

> 本地目录是软链接，profile 直接用你的工作目录 —— 改 `src/` 后重新
> `npm run build` 即生效，不用提交。

### 挂载进 profile

**用界面或 `dsh plugin ... add` 安装时不需要手动做任何事。** 本包的 `package.json`
声明了 `dsh.bundle.patch`，harness 会在安装后自动把它加进
`dsh.profile.bundles`（见 `app-boot/src/profile-plugins.ts`）并写入 `config`。

安装完成后 profile 里应该长这样：

```jsonc
{
  "dependencies": {
    "dsh-mx-mem": "link:D:/workspace/code/GIT/deepseek-harness-mx-mem",
    "dsh-mx-rate-limit": "github:mbxinye/deepseek-harness-mx-rate-limit"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-mx-mem",
        "dsh-mx-rate-limit"
      ]
    }
  }
}
```

注意 `dsh-mx-rate-limit` 那行是 `github:` 而不是 `link:` —— **`link:` 只在本地开发时用**
（见方式 B），指向本机目录意味着每次改代码都要自己重新 build。

最后**重启桌面端** —— profile patch 在启动时读取。

### 命令行等价写法

```bash
# 安装（会自动写好 dependencies 和 bundles）
dsh plugin --profile desktop add github:mbxinye/deepseek-harness-mx-rate-limit

# 只补装依赖，不改清单
dsh plugin --profile desktop install
```

---

## 配置

### 方式 A：设置页（推荐）

左侧边栏点 **插件**（不是「设置」）。页面顶部是 **官方** 分组，组里有一张卡片：

> **请求限速** —— 在请求到达 provider 之前，按 route 的配额排队。

点开就是配置页。能改：总开关、计入范围（仅主对话 / 含辅助请求）、以及每个 route
一行的 7 个字段。保存后写回你的 profile patch，**立即生效，不用重启**。

> 这一页在**插件页**的「官方」分组里，和 `Agent 循环`、`子智能体`、`网页搜索`
> 并列。它不在「设置」页面下面 —— 那里找不到是正常的，不是装坏了。

在 `llm-pi-ai` 的设置里可以看到你现有的 route id，把它们填进「受限的 route」：

| 你 profile 里的 route | 用途 |
|---|---|
| `agnes-ai` | `https://api.agnes-ai.cn/v1`，OpenAI 兼容网关 |
| `nvidia` | NVIDIA NIM（`integrate.api.nvidia.com`）|
| `zai` | 智谱 GLM |
| `deepseek-official` | 官方 DeepSeek |

### 方式 B：直接改 profile patch

`C:/Users/mbxin/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: llm-rate-limit
      name: dsh-mx-rate-limit
      config:
        purposeScope: conversation
        providers:
          nvidia:
            requestsPerWindow: 30
            windowMs: 60000
            burstSize: 30
            onExhausted: wait
            maxQueueDepth: 16
            maxWaitMs: 60000
```

### 关键语义：`providers` 是白名单

**只有列出来的 route 才被限流。** 没列的（比如额度充足的 `deepseek-official`）
完全不受影响 —— 这是刻意的，避免为了限一个免费额度把旁边的付费 route 一起拖慢。

所以只给 `nvidia` 配一个 key 就行。

---

## 配置项

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关。关掉会停掉所有 route，但保留配置 |
| `purposeScope` | `conversation` | `conversation` = 只限主对话；`all` = 也算上 compaction / session-title |
| `providers` | `{}` | 按 route id 的白名单。空 = 不限任何 route |

每个 route 的 profile：

| 字段 | 默认 | 含义 |
|---|---|---|
| `enabled` | `true` | 单个 route 的开关 |
| `requestsPerWindow` | `30` | 窗口内允许的请求数 |
| `windowMs` | `60000` | 窗口长度（毫秒）|
| `burstSize` | = `requestsPerWindow` | 突发容量，即桶的大小 |
| `onExhausted` | `wait` | `wait` 排队；`reject` 立刻返回 `RATE_LIMIT` |
| `maxQueueDepth` | `16` | 排队上限，超过直接拒绝 |
| `maxWaitMs` | `60000` | 单次等待上限，超过直接拒绝 |

**为什么要 `maxQueueDepth` / `maxWaitMs`**：无界排队会让队尾等很久。
30/min 的桶排 16 个 = 最坏 32 秒；不设上限的话，并发一旦冲高就会挂到看起来像卡死。
两个上限都触发时是**快速失败**，不是无限等。

### 为什么 `purposeScope` 默认是 `conversation`

harness 里除了主对话，还有两类辅助模型请求：`compaction`（上下文压缩）和
`session-title`（会话标题生成）。**每个新会话的第一条消息都会触发一次标题生成**。

如果它们和主对话共用配额，用户会看到"我什么都没干但就是被限流"。让辅助请求让路
是合理的 —— 而且标题生成排队只会拖慢首屏，失败了也不影响会话可用。

设成 `all` 可以让它们也受限流约束（上游配额极紧张时用）。

---

## 和 `dsh-llm-retry` 的关系

两者是**互补的两半**，base profile 已经默认挂了 `llm-retry`，不用做任何配置：

```
        本插件（预防）                    dsh-llm-retry（反应）
   ┌──────────────────────┐        ┌──────────────────────┐
   │ 请求前：令牌桶排队    │──429──▶│ 失败后：退避重试      │
   │ 避免触发限流          │        │ 处理残余抖动          │
   └──────────────────────┘        └──────────────────────┘
```

| 场景 | 谁处理 |
|---|---|
| 本地突发超配额（本插件知道）| 本插件排队，`RATE_LIMIT` 根本不产生 |
| 共享 API key 被别的客户端占用 | provider 回 429 → `llm-retry` 重试 |
| provider 抖动 / 5xx | `llm-retry` |

本插件拒绝请求时发出的终局 chunk 带 `providerRetryAfterMs`，正是 `llm-retry`
用来替代本地退避的字段。`RATE_LIMIT` 本来就在 `llm-retry` 的默认可重试集里，所以
**不需要改任何 provider 配置**。

---

## 怎么确认它在工作

### 设置页

设置 → `llm-rate-limit`。如果**看不到这个分区**，说明 `volatile` 字段没被识别，
或者插件没挂上（见下面的排查）。

### 看队列

```ts
// 在任意有 ctx 的地方
ctx.llmRateLimit.snapshots()
// → Map { 'nvidia' => { route: 'nvidia', depth: 0, nextTokenMs: 0,
//                       disposed: false, requestsPerWindow: 30, windowMs: 60000 } }
```

`depth` 是当前排队数，`nextTokenMs` 是队首还要等多久。

### 日志

排队发生在 debug 级别：

```
llm-rate-limit: queued a nvidia request on "deepseek-ai/deepseek-v4-flash-0731" for 2000ms
```

---

## 排查

| 现象 | 原因 |
|---|---|
| **加载报找不到入口 / `lib/index.js`** | 本地目录安装时忘了 `npm run build`。Git 安装不该出现 —— `lib/` 已随仓库提交 |
| **报 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`** | 装到的是**还带 `prepare` 脚本的老版本**（`prepare` 已被删除，tarball 的 hash 会告诉你装的是哪个 commit，见 `~/.dsh/profiles/<profile>/.plugin-manager/logs/`）。重装即可 |
| 插件页里看不到「请求限速」 | ① 先确认你在**插件**页而不是「设置」页；它在**官方**分组里，和 `Agent 循环` 并列。② 确认 profile `package.json` 的 `dsh.profile.bundles` 里有它，且重启过。③ 若报客户端模块加载错误，看宿主日志里 `mx-rate-limit` 的行 —— 客户端 bundle 是 `lib/client.js`，它注册进浏览器模块表，任一 import 不在表里都会在启动时抛错 |
| 插件在但完全不生效 | 检查 `providers` 的 key 是不是 route id。key 写错 = 不在白名单 = 不限流（这是设计，不是 bug）|
| 还是收到 429 | `providers` 里没配这个 route；或者配额被别人占用（那是 `llm-retry` 的活）|
| 感觉变慢但没有 429 | 正常 —— 这就是排队在工作。调 `requestsPerWindow` 或 `burstSize` |
| `llm-rate-limit: refused, ...` | 队列满或等待超时。两个上限生效了，调大 `maxQueueDepth` / `maxWaitMs` |

---

## 已知限制

- **进程内限流**。多开几个桌面端 = 几份配额。跨进程需要共享存储，不在当前范围内。
- **`maxWaitMs` 与 `windowMs` 默认同为 60s**，因为等满一个窗口必然拿到令牌。
  等更久说明并发远超预期，此时失败比继续挂更合理。
- **不覆盖 `agents` / `workflow` 之外的来源**。实际上所有模型调用都过 `llm/stream`，
  所以是全覆盖的；这一条是说 subagent 的并发是**拒绝**语义
  （`maxActiveSubagents`，默认 8），槽位满时先抛 `ACTIVATION_LIMIT_REACHED`，
  根本不会进入本插件的队列。
- **配置热更新会重建桶**。改了某个 route 的 profile 之后，该 route 的队列从头开始
  （已在排队的请求以 `disposed` 结算）。这是显式用户动作，可接受。

---

## 开发

```bash
npm install           # 只装开发依赖（typescript 等），不构建
npm run build         # 编译 src/ → lib/；改了 src/ 就要跑
npm run verify:build  # 确认已提交的 lib/ 与 src/ 一致
npm run typecheck     # 只检查本包；harness 各包用各自放宽的 tsconfig
npm test              # 64 个单元测试（token 桶 / 配置 / 队列）
npm run test:e2e      # 13 个集成测试，跑在真实 LlmRuntime 上
```

提交前跑一遍：

```bash
npm run build && npm run verify:build && npm run typecheck && npm test && npm run test:e2e
```

`lib/` 是**提交进仓库**的（见 `.gitignore` 里的说明），这样安装时零构建、零配置。
代价是 `src/` 和 `lib/` 可能不同步 —— `verify:build` 就是防这个的，它比对新鲜构建
与 git 记录的内容，不一致就失败。

### 测试分层

| 层 | 数量 | 跑在什么上 |
|---|---|---|
| 单元 | 95 | 纯逻辑 + 客户端暂存模型，手动时钟驱动，无任何依赖 |
| 集成 | 11 | **真实的 `LlmRuntime` + 真实的 Cordis 上下文过滤器**，只有模型适配器是替身 |
| 产物 | 2 | **构建后的 `lib/index.js`**，验证安装路径而不只是源码 |

> **客户端 UI 没有端到端测试。** 宿主半边能在 Node 里挂载真实服务来验证；浏览器
> 半边需要真实的 client runtime 和一个浏览器，而这里两者都不具备。客户端逻辑
> 的可测部分（暂存、校验、原子写入）都在 `model.ts` 里并已覆盖；「页面是否出现、
> 保存是否生效」只能在桌面端确认。

集成测试必须以 harness 根目录为 cwd 运行（`scripts/e2e.mjs` 负责这件事），
因为 `@deepseek-ai/*` 是通过 harness 的 tsconfig path 表解析的。harness 不在兄弟
目录时用 `DSH_ROOT` 指定。

### 客户端半边

设置页是**独立的客户端插件**（同包，`src/client/`）。这不是可选项：Harness 不会
根据插件的 `Config` 自动生成设置页 —— 服务端虽然算出了 `autoGenerate` 标志，但客户端
没有任何代码读它，每个设置页都是 `plugins.item` 槽位的贡献者。

`src/client/model.ts` 是暂存表单模型，**不含 React 也不 import 任何 harness 包**，
所以能在纯 Node 里测；React 层负责把它包进客户端的 snapshot store。这个拆分也是
为什么它没有基于共享的 `SettingsFormModel`：那个模型只发单段写入路径，而本插件的
配置是嵌套的（`providers.<route>.<field>`）。

浏览器 bundle 由 `tsdown.client.config.mjs` 产出，形如 harness 客户端预设要求的
CJS 闭包工厂。harness 自带的预设**用不了** —— 它靠 glob 自己的仓库目录结构定位包，
树外的包会直接抛错。

---

## 设计文档

`DESIGN.md` 记录了完整的设计推导，包括：

- 为什么是令牌桶而不是固定窗口 / 滑动窗口
- `llm/stream` waterfall **不会被 await** 这个关键约束，以及为什么等待必须放在
  懒生成器里
- 为什么监听器必须 `{ global: true }`（否则可能被 isolate 过滤器**静默丢弃**）
- 三条被集成测试推翻的设计假设