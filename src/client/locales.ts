/** Locale bundles for the rate limit page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type RateLimitLocaleKey =
  | 'title' | 'description'
  | 'enabled' | 'enabledHint'
  | 'purposeScope' | 'purposeConversation' | 'purposeAll' | 'purposeHint'
  | 'routesTitle' | 'routesHint' | 'routesEmpty'
  | 'newRoute' | 'addRoute' | 'newRouteInvalid'
  | 'removeRoute' | 'removeRouteConfirm'
  | 'routeEnabled'
  | 'requestsPerWindow' | 'requestsPerWindowHint'
  | 'windowMs' | 'windowMsHint'
  | 'burstSize' | 'burstSizeHint'
  | 'onExhausted' | 'onExhaustedHint' | 'onExhaustedWait' | 'onExhaustedReject'
  | 'maxQueueDepth' | 'maxQueueDepthHint'
  | 'maxWaitMs' | 'maxWaitMsHint'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed' | 'invalidNumber'

/** English copy. */
export const en: Record<RateLimitLocaleKey, string> = {
  title: 'Request rate limit',
  description: 'Hold model requests to a per-route quota before they reach the provider.',
  enabled: 'Rate limiting',
  enabledHint: 'Turn every route below on or off at once, keeping your saved values.',
  purposeScope: 'Counted requests',
  purposeConversation: 'Conversation only',
  purposeAll: 'Conversation and helpers',
  purposeHint: 'Context compaction and session titles share the provider quota. Leaving them out keeps them from spending the budget your conversation needs.',
  routesTitle: 'Limited routes',
  routesHint: 'Only the routes listed here are limited. Every other route runs untouched.',
  routesEmpty: 'No route is limited yet, so every model call passes straight through.',
  newRoute: 'Add a route',
  addRoute: 'Add',
  newRouteInvalid: 'Name a route that is not already listed.',
  removeRoute: 'Remove',
  removeRouteConfirm: 'Stop limiting this route? Its queue is dropped and its profile removed.',
  routeEnabled: 'Limit this route',
  requestsPerWindow: 'Requests per window',
  requestsPerWindowHint: 'Sustained rate. NIM’s free tier is 30 per minute.',
  windowMs: 'Window (ms)',
  windowMsHint: 'Length of the rolling window this rate applies over.',
  burstSize: 'Burst size',
  burstSizeHint: 'How many requests may arrive at once. Defaults to the request rate.',
  onExhausted: 'When exhausted',
  onExhaustedHint: 'Wait for a token, or fail the request immediately.',
  onExhaustedWait: 'Wait in line',
  onExhaustedReject: 'Fail fast',
  maxQueueDepth: 'Queue depth',
  maxQueueDepthHint: 'Requests allowed to wait at once. Beyond this, new arrivals fail instead of queueing without bound.',
  maxWaitMs: 'Longest wait (ms)',
  maxWaitMsHint: 'Cap on one request’s wait. Beyond this it fails rather than hanging.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a whole number in range, or leave blank to use the default.',
}

/** Simplified Chinese copy. */
export const zh: Record<RateLimitLocaleKey, string> = {
  title: '请求限速',
  description: '在请求到达 provider 之前，按 route 的配额排队。',
  enabled: '启用限速',
  enabledHint: '一次性开关下面所有 route，已保存的数值不受影响。',
  purposeScope: '计入的请求',
  purposeConversation: '仅主对话',
  purposeAll: '主对话和辅助请求',
  purposeHint: '上下文压缩和会话标题共用 provider 配额。不计入它们，可避免这些辅助请求花掉主对话需要的额度。',
  routesTitle: '受限的 route',
  routesHint: '只有列在这里的 route 会被限流，其余 route 完全不受影响。',
  routesEmpty: '还没有任何 route 被限流，所有模型请求都会直接通过。',
  newRoute: '添加 route',
  addRoute: '添加',
  newRouteInvalid: '请填写一个尚未列出的 route 名。',
  removeRoute: '移除',
  removeRouteConfirm: '不再限制这个 route？它的队列会被丢弃，配置也会删除。',
  routeEnabled: '限制这个 route',
  requestsPerWindow: '窗口内请求数',
  requestsPerWindowHint: '稳态速率。NIM 免费额度是每分钟 30 次。',
  windowMs: '窗口长度（毫秒）',
  windowMsHint: '这个速率所依据的滚动窗口长度。',
  burstSize: '突发容量',
  burstSizeHint: '允许多少请求同时到达。默认等于请求数。',
  onExhausted: '额度用完时',
  onExhaustedHint: '排队等一个令牌，还是立刻失败。',
  onExhaustedWait: '排队等待',
  onExhaustedReject: '立即失败',
  maxQueueDepth: '队列深度',
  maxQueueDepthHint: '允许同时等待的请求数。超过后新请求直接失败，不无限排队。',
  maxWaitMs: '最长等待（毫秒）',
  maxWaitMsHint: '单个请求的等待上限。超过后失败而不是一直挂着。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填范围内的整数；留空表示使用默认值。',
}

/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: RateLimitLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}