window.__ModuleLoader__.load({
	id: "dsh-mx-rate-limit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		//#region src/client/locales.ts
		/** English copy. */
		const en = {
			title: "Request rate limit",
			description: "Hold model requests to a per-route quota before they reach the provider.",
			enabled: "Rate limiting",
			enabledHint: "Turn every route below on or off at once, keeping your saved values.",
			purposeScope: "Counted requests",
			purposeConversation: "Conversation only",
			purposeAll: "Conversation and helpers",
			purposeHint: "Context compaction and session titles share the provider quota. Leaving them out keeps them from spending the budget your conversation needs.",
			routesTitle: "Limited routes",
			routesHint: "Only the routes listed here are limited. Every other route runs untouched.",
			routesEmpty: "No route is limited yet, so every model call passes straight through.",
			availableTitle: "Providers in this deployment",
			availableHint: "Read from your model provider settings. Pick one to start limiting it.",
			availableEmpty: "Every provider here is already limited.",
			addThisRoute: "Limit this provider",
			newRoute: "Or type a route id",
			addRoute: "Add",
			newRouteInvalid: "Name a route that is not already listed.",
			removeRoute: "Remove",
			removeRouteConfirm: "Stop limiting this route? Its queue is dropped and its profile removed.",
			routeEnabled: "Limit this route",
			requestsPerWindow: "Requests per minute (RPM)",
			requestsPerWindowHint: "The quota your provider documents for this route. Exceeding it is what earns you an HTTP 429, so this is the number to get right.",
			quotaSource: "Documented as {rpm} RPM · {source} · as of {asOf}",
			overridden: "Overridden",
			reset: "Reset to default",
			readOnly: "This deployment stores settings read-only.",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			save: "Save",
			saving: "Saving…",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			invalidNumber: "Enter a whole number in range, or leave blank to use the default."
		};
		/** Simplified Chinese copy. */
		const zh = {
			title: "请求限速",
			description: "在请求到达 provider 之前，按 route 的配额排队。",
			enabled: "启用限速",
			enabledHint: "一次性开关下面所有 route，已保存的数值不受影响。",
			purposeScope: "计入的请求",
			purposeConversation: "仅主对话",
			purposeAll: "主对话和辅助请求",
			purposeHint: "上下文压缩和会话标题共用 provider 配额。不计入它们，可避免这些辅助请求花掉主对话需要的额度。",
			routesTitle: "受限的 route",
			routesHint: "只有列在这里的 route 会被限流，其余 route 完全不受影响。",
			routesEmpty: "还没有任何 route 被限流，所有模型请求都会直接通过。",
			availableTitle: "本部署里的 provider",
			availableHint: "从你的模型提供商设置里读到的。点一个就开始对它限流。",
			availableEmpty: "这里的 provider 都已经在限流了。",
			addThisRoute: "限制这个 provider",
			newRoute: "或手动输入 route id",
			addRoute: "添加",
			newRouteInvalid: "请填写一个尚未列出的 route 名。",
			removeRoute: "移除",
			removeRouteConfirm: "不再限制这个 route？它的队列会被丢弃，配置也会删除。",
			routeEnabled: "限制这个 route",
			requestsPerWindow: "每分钟请求数（RPM）",
			requestsPerWindowHint: "这个 provider 文档里写的配额。超过它就会收到 HTTP 429 —— 这个数填错，正是本插件要防的事。",
			quotaSource: "文档值 {rpm} RPM · {source} · {asOf}",
			overridden: "已覆盖",
			reset: "恢复默认",
			readOnly: "本部署的设置为只读。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			save: "保存",
			saving: "保存中…",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			invalidNumber: "请填范围内的整数；留空表示使用默认值。"
		};
		/**
		* The form frame's copy, read from this page's dictionary.
		* @param t - the page's locale reader.
		* @returns the labels the shared settings form renders.
		*/
		function formLabels(t) {
			return {
				unavailable: t("unavailable"),
				readOnly: t("readOnly"),
				saveFailed: t("saveFailed"),
				save: t("save"),
				saving: t("saving")
			};
		}
		//#endregion
		//#region src/client/model.ts
		/**
		* Free-tier quotas the page pre-fills from, mirroring `PROVIDER_QUOTAS` in the
		* Host config. Duplicated for the same reason `ROUTE_DEFAULTS` is, and checked
		* the same way: `tests/preset.test.ts` fails if the two disagree.
		*
		* These are provider facts, not preferences, which is why they carry a source
		* and a date. The page shows both, so a number that has since moved reads as
		* "this is what was documented on that date" rather than as a current truth.
		*/
		const PROVIDER_QUOTAS = {
			nvidia: {
				rpm: 40,
				source: "NVIDIA 开发者论坛实测（官方 API 文档未列出）",
				asOf: "2026-10"
			},
			"agnes-ai": {
				rpm: 10,
				source: "Agnes 官方文档：免费用户文本模型实际限额",
				asOf: "2026-09-23"
			}
		};
		/** Namespace of this plugin's Host entry. Spelled here: a client package must not import a Host package. */
		const RATE_LIMIT_NS = "llm-rate-limit";
		/**
		* The provider namespace whose dict keys ARE the routes.
		*
		* Read-only on purpose: this page offers names to limit, and every number stays
		* in its own namespace. A deployment serving no such namespace simply offers
		* nothing, which is honest — better an empty list than a guessed one.
		*/
		const CATALOG_NS = "llm-pi-ai";
		/**
		* The product's intended limits, shown for a route that stores none yet.
		*
		* A freshly added route has no resolved value, so every field would render blank
		* and the user would have to type all five numbers to get the documented
		* behaviour. Prefilling them makes "add this route and accept the defaults" a
		* single click, and makes the recommended limit visible rather than folklore.
		*
		* `burstSize` is deliberately absent. The Host gives it no default and resolves
		* an omitted one as `requestsPerWindow`, so leaving it blank is not an unset
		* value — it is exactly "the same as the rate", and it keeps following the rate
		* if the user edits that. Prefilling a number here would quietly stop tracking.
		*
		* These duplicate the Host schema's defaults, which a client package cannot
		* import. `tests/preset.test.ts` reads the Host schema and fails if the two ever
		* drift, so the duplication is checked rather than merely noted.
		*/
		const ROUTE_DEFAULTS = {
			requestsPerWindow: 10,
			windowMs: 6e4
		};
		function keyOf(path) {
			return JSON.stringify(path);
		}
		/** Effective value at a nested path, or undefined when any segment is absent. */
		function readPath(value, path) {
			let current = value;
			for (const segment of path) {
				if (current === null || typeof current !== "object") return void 0;
				current = current[segment];
			}
			return current;
		}
		/** Whether the raw user layer carries this path at all, which is what marks it overridden. */
		function storedPath(value, path) {
			return readPath(value, path) !== void 0;
		}
		const REQUESTS_PER_WINDOW_BOUND = {
			min: 1,
			max: 1e5
		};
		const WINDOW_MS_BOUND = {
			min: 100,
			max: 2147483647
		};
		const BURST_SIZE_BOUND = {
			min: 1,
			max: 1e5
		};
		const QUEUE_DEPTH_BOUND = {
			min: 0,
			max: Number.MAX_SAFE_INTEGER
		};
		const MAX_WAIT_MS_BOUND = {
			min: 0,
			max: 2147483647
		};
		/**
		* Format a stored value as the draft text a control renders.
		* @param value - the stored value, possibly undefined.
		* @returns draft text; the empty string when the section carries no value.
		*/
		function formatScalar(value) {
			if (typeof value === "string") return value;
			if (typeof value === "number" && Number.isFinite(value)) return String(value);
			if (typeof value === "boolean") return value ? "true" : "false";
			return "";
		}
		/**
		* Convert draft text into the write it stages.
		* @param text - what the user typed.
		* @param kind - which value type the field accepts.
		* @param bound - inclusive numeric limits, for a `number` field.
		* @returns the staged write, or undefined when the draft is not acceptable.
		*/
		function parseScalar(text, kind, bound) {
			const trimmed = text.trim();
			if (trimmed === "") return { kind: "clear" };
			if (kind === "number") {
				if (!/^-?\d+$/.test(trimmed)) return void 0;
				const parsed = Number(trimmed);
				if (!Number.isSafeInteger(parsed)) return void 0;
				if (bound !== void 0 && (parsed < bound.min || parsed > bound.max)) return void 0;
				return {
					kind: "set",
					value: parsed
				};
			}
			if (kind === "boolean") {
				if (trimmed === "true") return {
					kind: "set",
					value: true
				};
				if (trimmed === "false") return {
					kind: "set",
					value: false
				};
				return;
			}
			return {
				kind: "set",
				value: trimmed
			};
		}
		/** Staged state of the page, and the actions the renderer binds. */
		var RateLimitController = class {
			/** The shared configuration form this page stages over. */
			scope;
			/** Where unconfigured route ids are offered from, when the Host serves one. */
			catalog;
			staged = /* @__PURE__ */ new Map();
			removals = /* @__PURE__ */ new Set();
			added = /* @__PURE__ */ new Set();
			newRouteDraft = "";
			baseline;
			saving = false;
			failed = false;
			listeners = /* @__PURE__ */ new Set();
			unsubscribe;
			unsubscribers = [];
			/**
			* Mount the staged model over one namespace.
			*
			* @param scope - the shared configuration form for the `llm-rate-limit` namespace.
			* @param catalog - the provider namespace to offer unconfigured routes from; omit
			*   when the deployment does not serve one, which leaves manual entry as the only path.
			*/
			constructor(scope, catalog) {
				this.scope = scope;
				this.catalog = catalog;
				this.unsubscribe = scope.subscribe(() => {
					this.publish();
				});
				if (catalog !== void 0) this.unsubscribers.push(catalog.subscribe(() => {
					this.publish();
				}));
			}
			/** Release the accepted-value subscription. */
			dispose() {
				this.unsubscribe();
				for (const off of this.unsubscribers) off();
				this.unsubscribers.length = 0;
				this.listeners.clear();
			}
			/**
			* Observe state changes, so a renderer can rebuild its projection.
			*
			* The controller publishes rather than owning a store: the React layer wraps
			* this in the client snapshot store it already depends on, which keeps this
			* module free of client-package imports and therefore testable in Node.
			* @param listener - invoked after every change to the scope or the drafts.
			* @returns the disposer removing this listener.
			*/
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			/** The page state a renderer projects: everything one draw needs, read once. */
			state() {
				const draft = this.newRoute();
				return {
					...this.shell(),
					routes: this.routes(),
					offered: this.offered(),
					newRoute: draft.text,
					newRouteValid: draft.valid,
					field: (path) => this.field(path),
					removing: (route) => this.removing(route)
				};
			}
			publish() {
				for (const listener of this.listeners) listener();
			}
			/**
			* Route ids the deployment has that this page does not limit yet.
			*
			* Staged additions are excluded too, so a route added but not yet saved is not
			* offered a second time.
			* @returns unconfigured route ids, in the catalog's own order.
			*/
			offered() {
				const snapshot = this.catalog?.getSnapshot();
				if (snapshot === void 0 || snapshot.status !== "ready") return [];
				const root = snapshot.value;
				if (root === null || typeof root !== "object") return [];
				const providers = root.providers;
				if (providers === null || typeof providers !== "object") return [];
				const configured = new Set(this.routes());
				return Object.keys(providers).filter((route) => !configured.has(route));
			}
			/** @returns the stored section, or an empty one before the first acceptance. */
			section() {
				return this.scope.getSnapshot().value ?? {};
			}
			/** @returns the route ids the stored section carries, plus any staged additions. */
			routes() {
				const merged = [...Object.keys(this.section().providers ?? {})];
				for (const route of this.added) if (!merged.includes(route)) merged.push(route);
				return merged.filter((route) => !this.removals.has(route));
			}
			/**
			* Read one control's state.
			* @param path - nested path inside the namespace section.
			* @returns the draft text, whether a save would leave an override, and whether it is invalid.
			*/
			field(path) {
				const key = keyOf(path);
				const staged = this.staged.get(key);
				const snapshot = this.scope.getSnapshot();
				const stored = readPath(snapshot.value, path);
				if (staged === void 0) return {
					text: formatScalar(stored ?? this.recommended(path)),
					overridden: storedPath(snapshot.user, path),
					invalid: false
				};
				if (staged.clear) return {
					text: formatScalar(readPath(snapshot.base, path) ?? this.recommended(path)),
					overridden: false,
					invalid: false
				};
				return {
					text: staged.text,
					overridden: true,
					invalid: false
				};
			}
			/** @returns the recommended value for one leaf of one route, or undefined. */
			recommended(path) {
				const leaf = path[path.length - 1] ?? "";
				if (leaf === "requestsPerWindow") return PROVIDER_QUOTAS[path[1] ?? ""]?.rpm ?? ROUTE_DEFAULTS[leaf];
				return ROUTE_DEFAULTS[leaf];
			}
			/**
			* The documented quota for one route, when this page has evidence for it.
			* @param route - provider route id.
			* @returns the quota and where it came from, or undefined when unknown.
			*/
			quota(route) {
				return PROVIDER_QUOTAS[route];
			}
			/**
			* Whether a row is staged for removal.
			* @param route - provider route id.
			* @returns whether the removal is pending.
			*/
			removing(route) {
				return this.removals.has(route);
			}
			/** @returns the draft for the new-route control, and whether it names a free route. */
			newRoute() {
				const trimmed = this.newRouteDraft.trim();
				const taken = Object.keys(this.section().providers ?? {}).includes(trimmed);
				return {
					text: this.newRouteDraft,
					valid: trimmed.length > 0 && !taken
				};
			}
			/** @returns the card-level state the shared form frame renders. */
			shell() {
				const snapshot = this.scope.getSnapshot();
				const plan = this.plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: this.dirty(),
					invalid: plan.some((item) => item.op === void 0),
					saving: this.saving,
					failed: this.failed
				};
			}
			dirty() {
				if (this.removals.size > 0 || this.added.size > 0) return true;
				return this.plan().length > 0;
			}
			/**
			* Build the edit, reset, save, and discard actions the page binds.
			* @returns the page's actions.
			*/
			actions() {
				return {
					edit: (path, text) => {
						this.baseline ??= this.scope.getSnapshot();
						this.staged.set(keyOf(path), {
							text,
							clear: false
						});
						this.failed = false;
						this.publish();
					},
					resetField: (path) => {
						this.baseline ??= this.scope.getSnapshot();
						this.staged.set(keyOf(path), {
							text: "",
							clear: true
						});
						this.failed = false;
						this.publish();
					},
					setNewRoute: (text) => {
						this.setNewRoute(text);
					},
					addRoute: (route) => {
						const trimmed = route.trim();
						if (trimmed.length === 0) return;
						this.baseline ??= this.scope.getSnapshot();
						this.removals.delete(trimmed);
						this.added.add(trimmed);
						this.newRouteDraft = "";
						this.failed = false;
						this.publish();
					},
					removeRoute: (route) => {
						this.baseline ??= this.scope.getSnapshot();
						this.added.delete(route);
						if (this.removals.has(route)) this.removals.delete(route);
						else this.removals.add(route);
						this.failed = false;
						this.publish();
					},
					save: () => {
						this.save();
					},
					discard: () => {
						if (this.staged.size === 0 && this.removals.size === 0 && this.added.size === 0 && !this.failed) return;
						this.staged.clear();
						this.removals.clear();
						this.added.clear();
						this.newRouteDraft = "";
						this.baseline = void 0;
						this.failed = false;
						this.publish();
					}
				};
			}
			/** Stage the new-route control's draft. */
			setNewRoute(text) {
				this.newRouteDraft = text;
				this.publish();
			}
			/** Every staged edit a save would write, in staging order. */
			plan() {
				const plan = [];
				const snapshot = this.scope.getSnapshot();
				for (const route of this.added) {
					if (this.removals.has(route)) continue;
					plan.push({
						path: ["providers", route],
						op: {
							op: "set",
							path: ["providers", route],
							value: {}
						}
					});
				}
				for (const route of this.removals) plan.push({
					path: ["providers", route],
					op: {
						op: "unset",
						path: ["providers", route]
					}
				});
				for (const [key, staged] of this.staged) {
					const path = JSON.parse(key);
					if (staged.clear) {
						if (storedPath(snapshot.user, path)) plan.push({
							path,
							op: {
								op: "unset",
								path
							}
						});
						continue;
					}
					const write = parseScalar(staged.text, kindFor(path), boundFor(path));
					if (write === void 0) {
						plan.push({
							path,
							op: void 0
						});
						continue;
					}
					const stored = readPath(snapshot.value, path);
					if (write.kind === "clear") {
						if (storedPath(snapshot.user, path)) plan.push({
							path,
							op: {
								op: "unset",
								path
							}
						});
						continue;
					}
					if (stored === write.value) continue;
					plan.push({
						path,
						op: {
							op: "set",
							path,
							value: write.value
						}
					});
				}
				return plan;
			}
			/**
			* Write every staged edit as one revision-fenced mutation, then re-seed from
			* what the Host accepted.
			*
			* The Host is the authority on acceptance, so the outcome is read back rather
			* than predicted. A save that did not land keeps its drafts.
			*/
			async save() {
				const snapshot = this.scope.getSnapshot();
				const ops = this.plan().flatMap((item) => item.op === void 0 ? [] : [item.op]);
				if (ops.length === 0 || this.saving || !snapshot.writable) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				try {
					const landed = await this.scope.mutate(ops, this.baseline?.revision);
					this.failed = !landed;
					if (landed) {
						this.staged.clear();
						this.removals.clear();
						this.added.clear();
						this.baseline = void 0;
					}
				} catch {
					this.failed = true;
				} finally {
					this.saving = false;
					this.publish();
				}
			}
		};
		/** The value type one namespace path accepts. */
		function kindFor(path) {
			const leaf = path[path.length - 1];
			if (leaf === "enabled") return "boolean";
			if (leaf === "onExhausted" || leaf === "purposeScope") return "enum";
			return "number";
		}
		/** Inclusive numeric limits for one namespace path, where the leaf is numeric. */
		function boundFor(path) {
			switch (path[path.length - 1]) {
				case "requestsPerWindow": return REQUESTS_PER_WINDOW_BOUND;
				case "windowMs": return WINDOW_MS_BOUND;
				case "burstSize": return BURST_SIZE_BOUND;
				case "maxQueueDepth": return QUEUE_DEPTH_BOUND;
				case "maxWaitMs": return MAX_WAIT_MS_BOUND;
				default: return;
			}
		}
		//#endregion
		//#region src/client/RateLimitCard.tsx
		/** One numeric or enum control, staged at its nested path. */
		function Field(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
				id: props.id,
				label: props.label,
				hint: props.hint,
				overriddenLabel: props.t("overridden"),
				resetLabel: props.t("reset"),
				invalidLabel: props.t("invalidNumber"),
				numeric: props.numeric ?? false,
				disabled: props.disabled,
				...props.state,
				onEdit: props.onEdit,
				onReset: props.onReset
			});
		}
		/** The two-state selector for an enum field. */
		function Choice(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
				id: props.id,
				label: props.label,
				value: props.value,
				options: props.options.map((option) => ({ ...option })),
				disabled: props.disabled,
				onChange: (next) => {
					props.onChange(next);
				}
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: props.hint })] });
		}
		/** One configured route: its switch, its numeric fields, and its enum. */
		function RouteRow(props) {
			const { route, state, disabled, actions, t } = props;
			const at = (leaf) => [
				"providers",
				route,
				leaf
			];
			const editing = state.removing(route);
			const quota = PROVIDER_QUOTAS[route];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("fieldset", {
				disabled,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("legend", { children: route }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
						checked: state.field(at("enabled")).text !== "false",
						label: t("routeEnabled"),
						disabled,
						onChange: (next) => {
							actions.edit(at("enabled"), String(next));
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
						id: `mx-rl-${route}-rpm`,
						label: t("requestsPerWindow"),
						hint: t("requestsPerWindowHint"),
						state: state.field(at("requestsPerWindow")),
						disabled,
						numeric: true,
						onEdit: (text) => {
							actions.edit(at("requestsPerWindow"), text);
						},
						onReset: () => {
							actions.resetField(at("requestsPerWindow"));
						},
						t
					}),
					quota === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "note",
						children: t("quotaSource", {
							rpm: String(quota.rpm),
							source: quota.source,
							asOf: quota.asOf
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						disabled,
						onClick: () => {
							actions.removeRoute(route);
						},
						children: editing ? t("overridden") : t("removeRoute")
					})
				]
			});
		}
		/**
		* Render the rate limit page's one-liner or its settings form.
		* @param props - the view asked for, locale copy, the page snapshot, and its actions.
		* @returns the one-liner, or the form.
		*/
		function RateLimitCard(props) {
			const { t } = props;
			const state = props.useRateLimitCard((snapshot) => snapshot);
			if (props.view === "summary") return t("description");
			const disabled = !state.writable;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
				labels: formLabels(t),
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
						checked: state.field(["enabled"]).text !== "false",
						label: t("enabled"),
						disabled,
						onChange: (next) => {
							props.edit(["enabled"], String(next));
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("enabledHint") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Choice, {
						id: "mx-rl-purpose",
						label: t("purposeScope"),
						hint: t("purposeHint"),
						value: state.field(["purposeScope"]).text || "conversation",
						disabled,
						options: [{
							value: "conversation",
							label: t("purposeConversation")
						}, {
							value: "all",
							label: t("purposeAll")
						}],
						onChange: (next) => {
							props.edit(["purposeScope"], next);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("routesTitle") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("routesHint") }),
					state.routes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: t("routesEmpty")
					}) : null,
					state.routes.map((route) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RouteRow, {
						route,
						state,
						disabled,
						actions: props,
						t
					}, route)),
					state.offered.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("availableTitle") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("availableHint") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: state.offered.map((route) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled,
							title: t("addThisRoute"),
							onClick: () => {
								props.addRoute(route);
							},
							children: route
						}) }, `avail-${route}`)) })
					] }) : null,
					state.routes.length > 0 && state.offered.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: t("availableEmpty")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
						value: state.newRoute,
						placeholder: t("newRoute"),
						disabled,
						onChange: (event) => {
							props.setNewRoute(event.target.value);
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						disabled: disabled || !state.newRouteValid,
						onClick: () => {
							props.addRoute(state.newRoute);
						},
						children: t("addRoute")
					})
				]
			});
		}
		//#endregion
		//#region src/client/face.ts
		/**
		* Binding the staged model to the renderer's snapshot store.
		*
		* The store is the client's own, so it is created here rather than in `model.ts`:
		* that module stays importable from a plain Node test, with no harness client
		* package resolvable, which is what makes the staged model verifiable.
		*/
		/**
		* Build the face the slot registration injects.
		*
		* Every republish rebuilds the whole projection, because one edit can change
		* several controls at once — adding a route changes the row list, and a save
		* re-seeds every field from what the Host accepted.
		* @param controller - the staged model this page owns.
		* @returns the page snapshot and its actions.
		*/
		function cardFace(controller) {
			const store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)(controller.state());
			controller.subscribe(() => {
				store.set(controller.state());
			});
			return {
				hooks: { rateLimitCard: store },
				...controller.actions()
			};
		}
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.rateLimit";
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"configForms"
		];
		/**
		* Mount the rate limit settings page while the Host serves its namespace.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "mx-rate-limit: dictionaries");
			const catalog = ctx.configForms.get(CATALOG_NS);
			const card = new RateLimitController(ctx.configForms.get(RATE_LIMIT_NS), catalog);
			ctx.effect(() => () => {
				card.dispose();
			}, "mx-rate-limit: form subscription");
			ctx.effect(() => ctx.configForms.whileServed([RATE_LIMIT_NS], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
				name: "plugins.item",
				id: "mx-rate-limit",
				order: 45,
				label: () => t("title"),
				locale: NS,
				inject: () => cardFace(card)
			}, RateLimitCard))), "mx-rate-limit: page");
		}
		//#endregion
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map