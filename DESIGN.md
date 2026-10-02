# DeepSeek Harness 速率限制插件 — 设计文档 v3

> 目标：在请求到达 provider 之前主动限流，避免 429。
> 适用场景：NIM 等免费接口（每分钟 30 次）。
> v2 变更：修正排队时延算术；新增 provider 级配置 + UI 可编辑；核实并解决 6 个新发现的方案缺陷。
> v3 变更：挂载机制更正为 `dsh.bundle`；两处实测修正（internals 传参、卸载语义）。

---

## 0. 版本变更摘要

### v1 → v2

| v1 说法 | 问题 | 更正 |
|---|---|---|
| "50 个请求排队 → 队尾等 100 分钟" | **算错 60 倍**。30/min = 每 2 秒一个令牌，50 个 = 100 秒 | §6.3 时延表 |
| "无界排队会等 100 分钟" | 混淆深度与时延 | 队尾时延 = 深度 × (windowMs/requestsPerWindow)，线性无上界 |

新发现并解决的缺陷：

| # | 缺陷 | 严重度 | 解决 |
|---|---|---|---|
| 1 | **辅助请求吃掉同一个桶的配额** | 高 | `purposeScope`，默认只限主对话（§5） |
| 2 | **`ctx.on` 不加 `global: true` 可能收不到事件** | 高 | `{ global: true }`（§4.2），已实测验证 |
| 3 | 配置无法在 UI 中编辑 | 中 | `Volatile` + `z.dict`（§7） |
| 4 | 限流粒度不足 | 中 | provider 级 profile dict 白名单（§7.2） |
| 5 | 卸载/热更新时桶状态未清理 | 中 | `ctx.effect` + profile 签名（§8.4） |
| 6 | 排队时延不可观测 | 低 | `ctx.llmRateLimit.snapshots()`（§9.2） |

### v2 → v3：实测推翻了三条设计假设

| # | v2 的假设 | 实测结果 | 更正 |
|---|---|---|---|
| 7 | 树外插件用 `name: './plugin/src/index.js'` 挂载 | **错**。正式机制是 `package.json` 的 `dsh.bundle.patch` 字段 | §8.3 |
| 8 | `new RateLimiter(ctx, config, internals)` 的 internals 可经 `ctx.plugin()` 传入 | **错**。Cordis 只传 `(ctx, config)` 两个参数 | §12.1 |
| 9 | 卸载时排队请求以 `RATE_LIMIT` 终局 | **实测为 `aborted`**，且这是**更正确**的语义 | §12.2 |

---

## 1. 结论摘要

| 结论 | 依据 |
|---|---|
| **harness 完全没有内置限流** | 全仓库无 token bucket / sliding window 实现 |
| **官方 README 明确把限流留给插件** | `packages/llm/llm/README.md:157` |
| **拦截点是 `llm/stream` waterfall** | `packages/llm/llm/src/index.ts:75` |
| **已有反应式方案 `dsh-llm-retry`** | 收到 429 后按 `retryPolicy` 退避重试 |
| **本插件补的是预防式那一半** | 主动排队，而非事后重试 |
| **可做成树外插件，无需改 harness** | `packages/boot/app-boot/src/index.ts:346-356` |
| **UI 配置可自动生成，无需写前端** | `packages/settings/settings/src/index.ts:302-340` + `schema.ts:37` |
| **provider 级配置有现成范式** | `llm-pi-ai` 的 `providers: z.dict(profile).volatile()` |

**推荐方案**：令牌桶（Token Bucket）+ 懒生成器在 `llm/stream` 上排队 + 按 `purpose` 分类 + provider 级 `Volatile` 配置 + 与 `dsh-llm-retry` 组合。

---

## 2. 为什么不用现成 npm 库

harness 对依赖有严格供应链策略：

- `pnpm-workspace.yaml` 有 `minimumReleaseAge`、`allowBuilds`、`patchedDependencies`
- 有 `verify-package-dependencies`、`verify-runtime-closure`、`verify-dsh-package-licenses` 等 gate
- `llm-retry` 甚至把 `zod` 列为 dependency，只为了 projection 的类型

令牌桶核心逻辑约 40 行，自己写无新增供应链风险、无类型依赖、可用 `dsh-timeout` 的 `MAX_TIMER_DELAY_MS` 做边界校验。

---

## 3. 拦截点分析：`llm/stream` waterfall

### 3.1 定义与分发

```typescript
// packages/llm/llm/src/index.ts:75
'llm/stream'(
  this: LlmRuntime,
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>
): AsyncIterable<StreamChunk>

// packages/llm/llm/src/index.ts:1143
return this.ctx.waterfall(this, 'llm/stream', options, () => this.adapterStream(options, prepared))
```

### 3.2 关键约束：waterfall 不会被 await

Cordis Primer 的 dispatch 表标明 `waterfall` = **Awaited? No**。
实现见 `vendor/cordis/src/events.ts:234-243`，同步返回。

**推论**：

- ❌ `ctx.on('llm/stream', async (options, next) => { await wait(); return next() })`
  —— 返回 `Promise<AsyncIterable>`，破坏 `AsyncIterable<StreamChunk>` 声明与 `LlmRuntime.stream()` 返回类型。
- ✅ 必须返回一个**同步创建的 async generator**，等待放进生成器体内。

### 3.3 官方参考实现

`packages/session/session-checkpoint-policy/src/index.ts:64-68` 正是这个模式：

```typescript
function afterCheckpoint(ctx, session, next): AsyncIterable<StreamChunk> {
  return (async function* (): AsyncIterable<StreamChunk> {
    await ctx.sessions.flush(session)   // 异步等待在生成器体内
    yield* next()                      // 然后才委派
  })()
}
```

**本插件采用完全相同的形状。**

---

## 4. 【缺陷 2】监听器可见性：`global` 选项

### 4.1 问题

`vendor/cordis/src/events.ts:171-174`：

```typescript
const filter = thisArg?.[Context.filter]
return (this._hooks[name] || [])
  .filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx))
```

`llm/stream` 的 `thisArg` 是 `LlmRuntime`，它是 `Service` 子类，其
`[symbols.filter]`（`vendor/cordis/src/service.ts:61-63`）是：

```typescript
protected [symbols.filter](ctx: Context) {
  return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name]
}
```

即**按 `llm` 服务的 isolate scope 标签比对**。

而 Loader 的每个 entry 都有自己的 context（`vendor/loader/src/config/entry.ts:186-187`）：

```typescript
const self: Context = Object.create(fiber.ctx)
self[Context.filter] = (owner: Context) => owner.fiber === fiber
```

### 4.2 结论：必须用 `global: true`

如果本插件的行落在**与 `llm` 服务不同的 isolate scope**，则
`ctx[isolate]['llm'] !== llmService.ctx[isolate]['llm']`，**监听器被静默过滤掉，
插件看起来"装了但不起作用"**。

证据：harness 里所有关键 `llm/stream` 监听器都显式加了 `global`：

- `packages/llm/llm/src/invariant.ts:88` → `{ global: true, prepend: true }`
- `packages/session/session-title/src/index.ts:371` → `{ global: true, prepend: true }`

`session-checkpoint-policy:64` 没加 `global`，说明它与 `llm` 在同一 scope。
**但这是部署细节，不是插件能依赖的保证** —— 尤其本插件是树外的，用户可以随意用
`isolate` 编排。

**决策**：注册为 Service 插件（提供 `ctx.llmRateLimit`），并对 `llm/stream`
使用 `{ global: true }`。`prepend` 不用 —— 限流应该在其他包装器之后但在
provider 之前，顺序不敏感。

### 4.3 为什么用 Service 而非函数插件

除了上面，还有三个理由：

1. **UI 需要一个 settings 页面载体**。`configure()`（`settings/src/index.ts:266`）
   接受 `owner: Fiber`，函数插件也能用，但 Service 形式能暴露
   `ctx.llmRateLimit` 供其他插件查询当前限流状态（UI 展示排队数）。
2. **可测试**。Service 有明确生命周期，单测里可 `ctx.plugin(RateLimiter, config)`
   直接构造。
3. **harness 惯例**。`token-meter`（`packages/llm/token-meter/src/index.ts:101`）
   就是 Service。

---

## 5. 【缺陷 1，高】辅助请求会吃掉同一个桶的配额

### 5.1 问题

`GenerateOptions` 有 `purpose` 字段（`packages/llm/llm/src/types.ts:552`）：

```typescript
/** Provider-neutral classification for an auxiliary model call. ... Ordinary conversation requests leave it unset. */
purpose?: 'compaction' | 'session-title'
```

实测确认的辅助调用来源：

| 来源 | 证据 |
|---|---|
| compaction 摘要 | `packages/compaction/compaction-basic/src/summarizer.ts:160` → `purpose: 'compaction'` |
| session title 生成 | `packages/session/session-title` → `purpose: 'session-title'` |

**如果不区分，一条 40 轮的对话会额外产生 N 次 compaction 请求，
全部从 30/min 的桶里扣令牌。** 用户会看到"我没做什么但就是被限流"。

更糟的是 session title：**每个新会话的第一条用户消息都会触发一次 title 生成**。
标题生成通常不需要限流，失败了也没关系（session-title 自己是独立的插件）。

### 5.2 决策：默认只限流主对话

```typescript
/** Which model-request classes share the limiter's budget. */
type PurposeScope =
  | 'conversation'   // 仅 purpose 缺省的主对话请求（默认）
  | 'all'            // 含 compaction / session-title
```

默认 `'conversation'`。理由：

- 用户感知到的"卡"来自主对话请求，辅助请求让路是合理的。
- `session-title` 失败不影响会话可用性，让它排队只会拖慢首屏。
- `'all'` 保留给"上游配额极度紧张"的场景。

`purpose` 缺省即主对话（`types.ts:552` 明确 "Ordinary conversation requests
leave it unset"），所以实现是：

```typescript
const isConversation = options.purpose === undefined
if (purposeScope === 'conversation' && !isConversation) return next()
```

---

## 6. 算法与排队

### 6.1 算法选型

| 算法 | 突发 | 内存 | 精度 | 适用 |
|---|---|---|---|---|
| 固定窗口计数器 | 边界处 **2× 突发** | 1 | 低 | 粗略内部限制 |
| 滑动窗口日志 | 无 | O(n)/请求 | 精确 | 低频高精确 |
| 滑动窗口计数器 | 平滑 | 2 | 高 | 通用 API 限流 |
| **令牌桶** | **可控突发** | **O(1)** | **高** | **API 限流默认选择** |
| 漏桶 | 无 | 队列 | 高 | 严格平滑输出 |

**选令牌桶**，关键理由：**固定窗口会在窗口边界放行 60 次**（2× 的 30/min），
直接触发 429 —— 这正是要避免的。NIM 的 "30 req/min" 语义就是令牌桶。

参考 `golang.org/x/time/rate`：

```typescript
export class TokenBucket {
  private tokens: number
  private last: number

  constructor(private readonly capacity: number, private readonly perMs: number, now: number) {
    this.tokens = capacity
    this.last = now
  }

  /** 惰性补充：距上次填充经过的时间 × 速率，上限 capacity */
  private refill(now: number): void {
    const elapsed = now - this.last
    if (elapsed <= 0) return
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.perMs)
    this.last = now
  }

  tryAcquire(now: number): boolean {
    this.refill(now)
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  waitMs(now: number): number {
    this.refill(now)
    if (this.tokens >= 1) return 0
    return Math.ceil((1 - this.tokens) / this.perMs)
  }
}
```

**为什么惰性补充而非定时器**：每个桶一个 timer 会让 30/min 变成 30 个 timer/分钟，
且插件卸载时需清理。用单调时钟惰性计算，状态只有两个数字。

### 6.2 排队器：必须 FIFO 串行授予

朴素实现（每个请求各自 `await waitMs`）有致命缺陷：N 个请求同时到达，
算出的等待时间几乎相同，会在同一刻一起释放 → 仍是突发 → 仍 429。

必须 **FIFO 队列 + 串行令牌授予**：

```typescript
class Gate {
  private readonly queue: Array<{ resolve: (ok: boolean) => void; signal?: AbortSignal }> = []
  private timer: NodeJS.Timeout | undefined

  /** 取令牌，或排队等一个。refused/aborted 时 resolve(false)。 */
  acquire(signal?: AbortSignal): Promise<boolean> { /* ... */ }
}
```

授予逻辑：桶可用**且**队首就绪时弹出一个等待者授予令牌。
这保证放行速率恰好等于 `requestsPerWindow / windowMs`。

### 6.3 【修正】排队时延的正确算法

30/min = 每 2 秒放行一个令牌。队尾等待 = **队列深度 × 2000ms**：

| 队列深度 | 队尾等待 | 体感 |
|---|---|---|
| 10 | ~20 秒 | 可接受 |
| 50 | ~100 秒（约 1.7 分钟） | 明显变慢 |
| 300 | ~10 分钟 | 异常 |
| 3000 | ~100 分钟 | 看起来像卡死 |

> **v1 错误**：把 50 个请求的等待写成了 100 分钟。50 × 2s = **100 秒**，
> 差了一个 60 倍的单位错误。

**关键结论**：问题不是"一定等到 100 分钟"，而是**队尾时延随队列深度线性
增长且无上界**。harness 里并发模型请求来源不止一个：

1. `subagent` 的 `backgroundMode: continuable`（`base/cordis.patch.yml:371-376`）
2. `workflow-ptc` / `goal-round-driver` 批量驱动
3. `experimental/agent-team` 的 mailbox

### 6.4 并发请求数是否有上限（已核实）

上一版把这条标为"未核实"。现已查清 —— **每个并发源都有硬上限，且都是小数字**：

| 并发源 | 上限 | 默认值 | 位置 |
|---|---|---|---|
| 单 step 内并行工具调用 | `maxParallelToolCalls` | **10** | `core/agent-loop/src/constants.ts:6`；schema `index.ts:335`；执行 `tool-calls.ts:132,200` |
| 子 agent 并发 | `maxActiveSubagents` | **8** | `subagent/subagent/src/index.ts:203` |
| 子 agent 递归深度 | `maxDepth` | **1** | `subagent/subagent/src/index.ts:202` |
| workflow 并发 agent | `maxConcurrentAgents` | **0 → `min(16, max(1, cores-2))`** | `workflow/workflow-ptc/src/index.ts:36,107,140-143` |

三个重要细节：

1. **`maxParallelToolCalls` 管的是工具调用，不是模型请求**。它是"同一步内同时
   运行多少个可并行工具调用"，每个工具调用结束后才轮到下一次模型请求
   （`tool-calls.ts:200` 的 `inFlight.size < maxParallelToolCalls` 循环）。
   **所以单个 agent step 内的模型请求是严格串行的。**

2. **`maxActiveSubagents` 是拒绝而非排队**。`subagent/subagent/src/continuation-activation.ts:41-56`：

   ```typescript
   class ActivationPool {
     reserve(capacity: number): () => void {
       if (this.slots.size >= capacity) {
         throw new SubagentError(`subagent limit reached (active child limit: ${capacity})...`,
           'ACTIVATION_LIMIT_REACHED')
       }
   ```

   槽位满时直接抛错，**不会积累到几百**。这直接否掉了我上一版"深度 300 可达"的担忧。

3. **但并行度是乘积关系**。`maxParallelToolCalls(10)` × `maxActiveSubagents(8)` ×
   `maxDepth(1)` 不构成同时在飞的模型请求数 —— 因为模型请求只在 step 边界串行发生。
   真正同时在飞的模型请求数 ≈ **活跃 agent 数**（每个 agent 一次一个请求）+
   workflow 的 `min(16, cores-2)`。

4. **多会话是真正的放大因子**。ACP 每个 session 允许一个 in-flight prompt
   （`acp/acp/src/session.ts:249`），Web 可以有多个活跃会话。10 个并发会话 ×
   8 个子 agent = 80 个潜在并发模型请求。**这是我核实后认为的真实上界来源**，
   而非 subagent 深度。

### 6.5 修正后的默认参数

基于核实结果，**`maxQueueDepth: 64` 明显过宽**。真实并发是几十量级，
队列深度 64 意味着最坏等 2 分钟 —— 但这个深度本身不该出现。

```typescript
maxQueueDepth: z.number().int().min(0).default(16)   // 64 → 16
maxWaitMs: z.number().int().min(0).default(60_000)   // 300s → 60s
```

- 16 深度 × 2s = **32 秒**最坏等待，体感是"稍慢"，不是"卡死"。
- 60 秒上限与 NIM 的 60 秒窗口对齐：等满一个窗口必然拿到令牌，
  等更久说明并发远超预期，应该失败而不是继续挂。

**同时新增建议**：因为 `maxActiveSubagents` 已经是拒绝语义，本插件在
`'wait'` 模式下排队，实际上是把 subagent 的"快速失败"变成了"慢速等待"。
对 `subagentMaxActive` 已触顶的场景，用户会先看到 `ACTIVATION_LIMIT_REACHED`
（本插件没介入），所以**不存在本插件放大排队深度的问题** —— 深度上限由
subagent 池和会话数控制，不由本插件控制。

---

## 7. 【缺陷 3、4】provider 级配置 + UI 可编辑

### 7.1 UI 配置是怎么来的（不需要写前端）

`packages/settings/settings/src/index.ts:302-340` 的 `describe()`：

```typescript
describe(options?: SettingsDescribeOptions): SettingsDescriptor[] {
  const descriptors = this.ownerContext.configEditor.configuration().flatMap(({ entry, inherited, override }) => {
    const schema = this.schema(entry)
    if (schema === undefined || entry.fiber === undefined ...) return []
    const form = volatileForm(schema)      // ← 只保留 volatile 字段
    if (form === undefined) return []
    return [{ ns: entry.options.id as SettingsNamespace, schema: form.toJSON(), value, base, user, ... }]
  })
```

即：**settings 命名空间 = Loader entry id，表单 schema = 该插件 `Config` 的
volatile 子树**，由 UI 自动渲染。`packages/settings/settings/src/schema.ts:37-47`：

```typescript
export function volatileForm(schema: z): z | undefined {
  if (schema.meta.volatile) return plainSchema(schema)
  if (schema.type === 'object') {
    const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = volatileForm(child)
      return field === undefined ? [] : [[key, field]]
    }))
    return Object.keys(dict).length === 0 ? undefined : z.object(dict)
  }
  return undefined
}
```

**没有 volatile 字段的插件不会出现设置页面**（`form === undefined` → 被跳过）。
这是 v1 完全遗漏的一点 —— 我原来的 `Config` 没有 `.volatile()`，
**插件会完全不进 UI**。

### 7.2 现成范式：`llm-pi-ai`

`packages/llm/llm-pi-ai/src/config.ts:352-354`：

```typescript
export const Config = z.object({
  providers: z.dict(profile).default({}).volatile(),
})
```

配合 `base/cordis.patch.yml:120-128` 的注释：

> "The pi-ai multi-provider twin, mounted dormant: zero routes (and no extra
> models in the picker) until a `llm-pi-ai:` settings section supplies provider
> profiles — then those routes register live, keys resolving per request
> through their apiKeyEnv references, and drop again when the section empties."

**这就是"在 UI 里配置哪些 provider"的现成答案**：用 `z.dict()` 以 provider route
为键，用户在 Models/设置页填写，插件读 `ctx.config.providers` 拿到。

### 7.3 本插件的 Config schema

```typescript
/** One provider's rate-limit profile; the `providers` dict key IS the route. */
interface ProviderProfile {
  /** Enable or disable limiting for this route without deleting the profile. */
  enabled: boolean
  /** Sustained request rate per window. */
  requestsPerWindow: number
  /** Rolling window length in milliseconds. */
  windowMs: number
  /** Bucket capacity; defaults to requestsPerWindow. */
  burstSize?: number
  /** Queue on exhaustion, or fail fast with RATE_LIMIT. */
  onExhausted: 'wait' | 'reject'
  /** Cap queued requests for this route; beyond this, reject immediately. */
  maxQueueDepth: number
  /** Cap one request's wait; beyond this, fail instead of hanging. */
  maxWaitMs: number
}

const providerProfile = z.object({
  enabled: z.boolean().default(true),
  requestsPerWindow: z.number().int().min(1).max(100_000).default(30),
  windowMs: z.number().int().min(100).max(MAX_TIMER_DELAY_MS).default(60_000),
  burstSize: z.number().int().min(1).optional(),
  onExhausted: z.union(['wait', 'reject']).default('wait'),
  // 16 × 2s ≈ 32s worst case at NIM's 30/min. See §6.4 — real concurrency is
  // bounded by maxActiveSubagents(8) × active sessions, not by this queue.
  maxQueueDepth: z.number().int().min(0).default(16),
  // 60s matches NIM's window: waiting longer means concurrency far exceeds
  // expectation, so failing beats hanging.
  maxWaitMs: z.number().int().min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
})

/** Which model-request classes share the budget. */
const purposeScope = z.union(['conversation', 'all']).default('conversation')

export const Config = z.object({
  /** Per-route profiles keyed by provider route id; empty means limit nothing. */
  providers: z.dict(providerProfile).default({}).volatile(),
  /** Whether auxiliary compaction / session-title calls share the budget. */
  purposeScope: purposeScope.volatile(),
  /** Master switch, so a row can be parked without deleting its config. */
  enabled: z.boolean().default(true).volatile(),
})
```

### 7.4 三种配置粒度

```yaml
# A. 只限 NIM（UI 里在 providers 下加一个 nim 条目即可）
- id: llm-rate-limit
  name: './llm-rate-limit/src/index.js'
  config:
    providers:
      nim: { requestsPerWindow: 30, windowMs: 60000 }
      deepseek-official: { requestsPerWindow: 600, windowMs: 60000 }

# B. 全局默认 + 单个 route 覆盖
- id: llm-rate-limit
  name: './llm-rate-limit/src/index.js'
  config:
    enabled: true
    purposeScope: conversation
    providers:
      nim:
        requestsPerWindow: 30
        windowMs: 60000
        onExhausted: wait
        maxQueueDepth: 16
        maxWaitMs: 60000

# C. 从环境变量注入（部署场景）
- id: llm-rate-limit
  name: './llm-rate-limit/src/index.js'
  config:
    providers:
      nim:
        requestsPerWindow: !!js "Number(process.env.NIM_RPM ?? 30)"
```

**语义决策：`providers` 字典是"白名单"**—— 只有列出的 route 才被限流。
理由：列出的 route 才需要限流；未列出的 route（如 `deepseek-official`
的付费额度）不应被拖慢。这也是 `llm-pi-ai` 用同样方式解决"dormant mount"。

### 7.5 挂载后如何被发现

由于 settings 命名空间 = Loader entry `id`，UI 里的页面标题来自
`llm-rate-limit`。`configure({ auto: true })` 是默认行为
（`settings/src/index.ts:312`: `?? true`），所以**不需要调用 `configure()`**。
只有想禁用自动页面生成时才需要：

```typescript
export function apply(ctx: Context, config: Config): void {
  ctx.settings.configure({ auto: false })  // 仅当要提供自定义前端页时
}
```

### 7.6 热更新：配置变了怎么办

`Volatile` 的定义就是"可编辑**无需重挂载**"（`schema.ts:33`）。
所以插件必须监听配置变化并重建桶。`Service` 的标准做法：

```typescript
export class RateLimiter extends Service {
  static override inject = ['llm']
  static Config = Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'llmRateLimit')
    // ctx.config 在 fiber.update 时刷新；此处读取一次并订阅后续变化
  }
}
```

**注意**：harness 里没有找到现成的"配置变更"事件（我搜过
`fiber.update` 只在 client 和 loader 内部出现）。最稳的做法是**每次请求时
懒读取 `this.ctx.config`**，用配置内容的哈希/generation 判断是否需要重建桶。
这样避免依赖不确定的更新机制：

```typescript
private generation = ''
private gates = new Map<string, Gate>()

private gate(key: string, options: GenerateOptions): Gate | undefined {
  const profile = this.profileFor(options)
  if (profile === undefined) return undefined
  const signature = JSON.stringify(profile)
  const existing = this.gates.get(key)
  if (existing !== undefined && existing.signature === signature) return existing.gate
  const gate = new Gate(profile)          // 重建：桶从头开始
  this.gates.set(key, { signature, gate })
  return gate
}
```

代价：用户改了配置后，已排队的请求在旧桶上完成，新请求用新桶。
这是可接受的语义（配置变更是显式用户动作）。

---

## 8. 插件结构

```
llm-rate-limit/
├── package.json          # 零运行时依赖
├── README.md
├── cordis.patch.yml
├── src/
│   ├── index.ts          # RateLimiter Service + apply()
│   ├── config.ts         # Config schema、profile 解析
│   ├── bucket.ts         # TokenBucket（纯逻辑）
│   ├── gate.ts           # FIFO 排队器
│   └── types.ts
└── tests/
    ├── bucket.spec.ts
    ├── config.spec.ts
    ├── gate.spec.ts
    └── rate-limit.spec.ts   # 端到端，复用 llm-mock-server
```

### 8.1 package.json

```json
{
  "name": "dsh-llm-rate-limit",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.js",
  "peerDependencies": {
    "@deepseek-ai/cordis": "^0.2.0",
    "@deepseek-ai/dsh-llm": "^0.2.0",
    "@deepseek-ai/schemastery": "^0.2.0",
    "@deepseek-ai/dsh-timeout": "^0.2.0"
  },
  "peerDependenciesMeta": {
    "@deepseek-ai/dsh-timeout": { "optional": true }
  }
}
```

全部 peer、无 dependencies。本仓库不是 monorepo 成员，故用真实版本号而非
`workspace:*`。

### 8.2 终局 chunk 契约

限流是插件产生的失败，必须遵守 `StreamChunk` 协议
（`packages/llm/llm/README.md:74`：每个流以**恰好一个**终局 chunk 结束）：

```typescript
function limitedStream(options: GenerateOptions, waitMs: number): AsyncIterable<StreamChunk> {
  return (async function* (): AsyncIterable<StreamChunk> {
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          code: 'RATE_LIMIT',
          message: `local rate limit for provider "${options.provider}": waited ${Math.ceil(waitMs / 1000)}s for a token`,
          // 关键接缝：让 dsh-llm-retry 接管重试
          providerRetryAfterMs: waitMs,
        },
      },
    }
  })()
}
```

取消时 `kind: 'aborted'` 而非 `'error'`（与 `index.ts:1156-1160` 一致）。

`providerRetryAfterMs` 是与 `dsh-llm-retry` 的接缝
（`llm-retry/src/index.ts:227-238` 读该字段替代本地退避），
所以本插件不需要自己实现重试循环。

### 8.3 挂载（树外插件）—— 【v3 更正】

**v2 说错了。** v2 以为在 profile 的 `cordis.patch.yml` 里写相对路径即可。
实测本机已有同类插件 `dsh-mx-mem`（同为 `deepseek-harness-mx-*` 命名的树外插件，
已挂在桌面 profile 上），它的做法才是**正式机制**：

`package.json` 声明 bundle：

```json
{
  "name": "dsh-llm-rate-limit",
  "main": "./src/index.ts",
  "exports": { ".": { "default": "./src/index.ts" } },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

随包提供 `cordis.patch.yml`（**行内写包名，不写相对路径** —— 发布出去的是构建
产物，不是源码树）：

```yaml
# Bundle layer, applied when a profile lists `dsh-llm-rate-limit` in
# `dsh.profile.bundles`. Rows name the package so Node resolution finds the
# built entry rather than a source tree that is not shipped.
- insert:
    - id: llm-rate-limit
      name: dsh-llm-rate-limit
      config:
        providers:
          nim:
            requestsPerWindow: 30
            windowMs: 60000
```

用户在 profile 里挂载：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "dsh-llm-rate-limit"]
    }
  }
}
```

相对路径（`name: './xxx.ts'`）**只在开发/测试时用**：
`anchorInsertedPluginNames`（`packages/boot/app-boot/src/index.ts:346-356`）
以 patch 文件所在目录为基准转 file URL —— 集成测试正是靠它从源码加载插件，
且无需构建步骤。

### 8.4 卸载与清理

`ctx.effect()` 保证逆序释放（`docs/cordis-primer.md:44`）：

```typescript
constructor(ctx: Context, config: Config) {
  super(ctx, 'llmRateLimit')
  const lifetime = new AbortController()

  ctx.effect(() => async () => {
    lifetime.abort(new Error('llm-rate-limit disposed'))
    this.gates.clear()
  }, 'llm-rate-limit: abort and drain active waits')

  ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
    ...
  }, { global: true })
}
```

每个排队中的请求把自己的 `signal` 与 `lifetime.signal` 用
`AbortSignal.any` 融合（`llm-retry/src/index.ts:162` 的做法），
卸载时全部快速失败而不是挂到进程退出。

---

## 9. 【缺陷 6】与 `dsh-llm-retry` 的关系及可观测性

### 9.1 互补的两半

```
        本插件（预防）                    dsh-llm-retry（反应）
   ┌──────────────────────┐        ┌──────────────────────┐
   │ 请求前：令牌桶排队    │──429──▶│ 失败后：退避重试      │
   │ 避免触发限流          │        │ 处理残余抖动          │
   └──────────────────────┘        └──────────────────────┘
```

| 场景 | 谁处理 |
|---|---|
| 本地突发超配额（本插件已知） | 本插件排队，`RATE_LIMIT` 从不产生 |
| 共享 key 被其他客户端占用 | provider 返 429 → `llm-retry` 重试 |
| provider 抖动 / 5xx | `llm-retry` |

`RATE_LIMIT` 本来就在默认可重试集内
（`packages/llm/llm/src/retry-policy.ts:18-24`），**不需要改任何 provider 配置**。

### 9.2 可观测性

`ctx.llmRateLimit` 暴露只读快照，供 UI / 测试查询：

```typescript
interface RateLimitSnapshot {
  /** Route id → current queue depth and next-token ETA. */
  readonly routes: ReadonlyMap<string, { depth: number; nextTokenMs: number }>
}
```

### 9.3 等待事件

排队会让 `step/start`（循环内）与 provider 实际请求之间的时间差拉大。
若要在 UI 表达"排队中"，需要一个信号。但：

- 事件必须进 session log 才持久，而**限流等待不应进模型上下文**
  （harness 强约束：Model Experience 一节）
- `llm-retry` 用的是 non-surface 事件 `llm/retry`（`llm-retry/src/index.ts:188`）

**决策**：v2 不写 session log 事件，只在内存暴露 `RateLimitSnapshot`，
由 UI 通过 service 查询。这样避免引入新的日志词汇表义务
（harness 有 `gen-scoped-events` / `verify-v3-event-vocabulary` 等 gate）。
如果后续确实需要持久化，再按 `llm/retry` 的 non-surface 模式加。

---

## 10. 行为对模型的影响（Model Experience）

- **模型可见性**：限流状态**不进入模型上下文**。排队发生在 provider 请求之前，
  模型看不到任何限流元数据。
- **Token**：排队不消耗 token。被拒绝的请求**不产生** provider 请求，零计费。
- **KV Cache**：不改变请求前缀。排队只延迟 `next()` 时机，请求内容逐字节相同。
- **turn 时延**：唯一真实代价。UI 应能表达"排队中"，否则用户以为卡死。

---

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 时钟回拨 | 用 `performance.now()`（单调），不用 `Date.now()` |
| **`llm/stream` 监听器被 isolate 过滤** | **`{ global: true }`**（§4.2） |
| **辅助请求吃配额** | **`purposeScope` 默认 `'conversation'`**（§5） |
| 等待不可取消导致泄漏 | `AbortSignal.any([request, lifetime])` |
| 卸载后仍有等待在飞 | `ctx.effect()` abort + drain |
| 队列无界增长 | `maxQueueDepth`(16) + `maxWaitMs`(60s) 双上限 |
| **排队集体同时释放 → 仍 429** | **FIFO 串行授予**（§6.2） |
| 配置热更新时桶状态 | 按 profile 签名重建桶（§7.6） |
| 多进程各自限流，总量仍超 | 进程内限流无法跨进程；文档明说 per-process |
| 并发源无上限导致深度累积 | **已核实：每源都有硬上限**（§6.4）。真上界是并发会话数 × `maxActiveSubagents(8)` |
| `maxActiveSubagents` 已触顶时本插件放大排队 | 不会 —— 该场景先抛 `ACTIVATION_LIMIT_REACHED`（`continuation-activation.ts:47`），本插件不介入 |

---

## 12. 实现状态与两处实测修正

### 12.1 【实测修正】`internals` 不会经 `ctx.plugin()` 传入

`vendor/cordis/src/fiber.ts` 的 `_runner.execute`：

```typescript
if (isConstructor(runtime.callback)) {
  const instance = new runtime.callback(this.ctx, this.config)   // ← 只有两个参数
} else {
  return runtime.callback(this.ctx, this.config)
}
```

**类插件和函数插件都只收到 `(ctx, config)`。** 所以 v2 设计的
`constructor(ctx, config, internals)` 第三个参数，**经 `ctx.plugin()` 挂载时永远是
`{}`** —— 这正是集成测试初期那两个用例耗时 6 秒的原因：调度器回落到真实定时器，
而测试却在推进手动时钟。

修正：`internals` 明确降级为**测试专用接缝**，仅在直接 `new RateLimiter(ctx, config,
{ scheduler })` 时有效，并在文档与类型注释中写明。生产路径（`dsh.bundle` 挂载）
永远走 `defaultScheduler()`，因此必须另有一个用例覆盖真实定时器路径 ——
`the production scheduler path` 那个用例就是为此存在。

> 顺带结论：`llm-retry` 的 `internals` 参数有同样的性质 —— 它在生产中恒为 `{}`，
> 只在单测直接调用时有用。不是 bug，但把它当生产可配通道会踩坑。

### 12.2 【实测修正】卸载时排队请求以 `aborted` 终局，且这更正确

实测：插件卸载 → `lifetime.abort()` 触发 → gate 的 abort 监听先于
`gate.dispose()` 结算 → 结果是 `kind: 'aborted'` 而非 `kind: 'error'`。

**保持 `aborted`，不改成 `RATE_LIMIT`**，理由：

- 卸载**不是**用户的速率限制。报 `RATE_LIMIT` 会让 `dsh-llm-retry` 误以为该重试，
  进入一个本不该发生的退避循环 —— 而这个回合本来就要被拆掉了。
- harness 约定（`llm/src/index.ts:1156-1160`）用 `aborted` 表达"被取消"，
  语义正好吻合。

用例 `disposal settles queued requests as aborted, not as a rate-limit error`
把这个语义钉住，包括 `assert.notEqual(code, 'RATE_LIMIT')`。

### 12.3 当前实现状态

| 模块 | 行数 | 状态 |
|---|---|---|
| `src/bucket.ts` | 122 | 完成，21 单测 |
| `src/config.ts` | 185 | 完成，19 单测 + 2 UI 投影实测 |
| `src/gate.ts` | 251 | 完成，22 单测 |
| `src/index.ts` | ~300 | 完成，11 集成测试（真实 LlmRuntime）|
| `cordis.patch.yml` + `dsh.bundle` | — | 待补（§8.3）|
| `README.md` | — | 待补 |

**验证结果**：`npm test` 64/64，`npm run test:e2e` 11/11，`npm run typecheck` 干净。

---

## 13. 下一步

1. **补 `cordis.patch.yml` + `dsh.bundle` 字段**，按 §8.3 的正式机制。
2. **挂到本机桌面 profile** 验证 UI 页面真实出现、可编辑、写入 profile patch
   （`~/.dsh/profiles/desktop/`）。
3. **`README.md`**：安装、配置、与 `dsh-llm-retry` 的协同说明。
4. **组合验证**：与 `dsh-llm-retry` 同跑，确认 `RATE_LIMIT` + `providerRetryAfterMs`
   能被重试接管。

---

## 13. 已验证的关键事实索引

| 事实 | 位置 |
|---|---|
| `llm/stream` waterfall 声明 | `packages/llm/llm/src/index.ts:75` |
| waterfall 分发点 | `packages/llm/llm/src/index.ts:1143-1149` |
| waterfall 不同步 await | `vendor/cordis/src/events.ts:234-243`；Primer dispatch 表 |
| **监听器 filter 机制** | `vendor/cordis/src/events.ts:171-174` |
| **Service 的 filter 语义** | `vendor/cordis/src/service.ts:61-63` |
| **Loader entry 的 filter** | `vendor/loader/src/config/entry.ts:186-187` |
| **关键监听器用 `global: true`** | `llm/src/invariant.ts:88`；`session-title/src/index.ts:371` |
| **settings 表单自动生成** | `packages/settings/settings/src/index.ts:302-340` |
| **volatileForm 只保留 volatile 字段** | `packages/settings/settings/src/schema.ts:37-47` |
| **无 volatile 字段则无设置页** | 同上，`form === undefined` 被跳过 |
| settings ns = Loader entry id | `packages/settings/settings/src/index.ts:315,326` |
| **provider 级配置范式** | `llm-pi-ai/src/config.ts:352-354` |
| `purpose` 字段语义 | `packages/llm/llm/src/types.ts:552` |
| **compaction 是辅助请求** | `compaction-basic/src/summarizer.ts:160` |
| 限流是官方承认的空白 | `packages/llm/llm/README.md:157` |
| 终局 chunk 契约 | `packages/llm/llm/README.md:74` |
| `RATE_LIMIT` 在默认可重试集 | `packages/llm/llm/src/retry-policy.ts:18-24` |
| `providerRetryAfterMs` 被消费 | `packages/llm/llm-retry/src/index.ts:227-238` |
| 可取消延迟参考实现 | `packages/llm/llm-retry/src/index.ts:83-96` |
| `AbortSignal.any` 融合用法 | `packages/llm/llm-retry/src/index.ts:162` |
| Service 插件形状 | `packages/llm/token-meter/src/index.ts:101-123` |
| 函数插件形状 / `inject` | `packages/llm/llm-retry/src/index.ts:21-28,123` |
| 配置未知键必须拒绝 | `packages/llm/llm-retry/src/index.ts:30-37` |
| Config 走 Standard Schema | `vendor/cordis/src/fiber.ts:50-62` |
| 树外插件相对路径挂载 | `packages/boot/app-boot/src/index.ts:346-356` |
| Loader patch 方言与 `!!js` | `packages/preset/agent-preset/skills/cordis-composition-reference/SKILL.md` |
| effect 逆序释放 | `docs/cordis-primer.md:44` |
| 并发子 agent 配置 | `packages/bundle/base/cordis.patch.yml:371-376` |
| **step 内并行工具调用上限 10** | `core/agent-loop/src/constants.ts:6`；`index.ts:335`；`tool-calls.ts:132,200` |
| **子 agent 并发上限 8** | `subagent/subagent/src/index.ts:203`；调用 `continuation-activation.ts:489` |
| **子 agent 深度上限 1** | `subagent/subagent/src/index.ts:202`；`depth.ts:42-49` |
| **subagent 池满则拒绝不排队** | `subagent/subagent/src/continuation-activation.ts:41-56` |
| **workflow 并发 agent 上限** | `workflow/workflow-ptc/src/index.ts:36,107,140-143` |
| **ACP 每 session 一个 in-flight prompt** | `acp/acp/src/session.ts:249` |