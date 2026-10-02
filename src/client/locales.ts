/** Locale bundles for the rate limit page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type RateLimitLocaleKey =
  | 'title' | 'description'
  | 'enabled' | 'enabledHint'
  | 'purposeScope' | 'purposeConversation' | 'purposeAll' | 'purposeHint'
  | 'routesTitle' | 'routesHint' | 'routesEmpty'
  | 'availableTitle' | 'availableHint' | 'availableEmpty' | 'addThisRoute'
  | 'newRoute' | 'addRoute' | 'newRouteInvalid'
  | 'removeRoute' | 'removeRouteConfirm'
  | 'routeEnabled'
  | 'requestsPerWindow' | 'requestsPerWindowHint' | 'quotaSource'
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
  availableTitle: 'Providers in this deployment',
  availableHint: 'Read from your model provider settings. Pick one to start limiting it.',
  availableEmpty: 'Every provider here is already limited.',
  addThisRoute: 'Limit this provider',
  newRoute: 'Or type a route id',
  addRoute: 'Add',
  newRouteInvalid: 'Name a route that is not already listed.',
  removeRoute: 'Remove',
  removeRouteConfirm: 'Stop limiting this route? Its queue is dropped and its profile removed.',
  routeEnabled: 'Limit this route',
  requestsPerWindow: 'Requests per minute (RPM)',
  requestsPerWindowHint: 'The quota your provider documents for this route. Exceeding it is what earns you an HTTP 429, so this is the number to get right.',
  quotaSource: 'Documented as {rpm} RPM · {source} · as of {asOf}',
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
  availableTitle: '本部署里的 provider',
  availableHint: '从你的模型提供商设置里读到的。点一个就开始对它限流。',
  availableEmpty: '这里的 provider 都已经在限流了。',
  addThisRoute: '限制这个 provider',
  newRoute: '或手动输入 route id',
  addRoute: '添加',
  newRouteInvalid: '请填写一个尚未列出的 route 名。',
  removeRoute: '移除',
  removeRouteConfirm: '不再限制这个 route？它的队列会被丢弃，配置也会删除。',
  routeEnabled: '限制这个 route',
  requestsPerWindow: '每分钟请求数（RPM）',
  requestsPerWindowHint: '这个 provider 文档里写的配额。超过它就会收到 HTTP 429 —— 这个数填错，正是本插件要防的事。',
  quotaSource: '文档值 {rpm} RPM · {source} · {asOf}',
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