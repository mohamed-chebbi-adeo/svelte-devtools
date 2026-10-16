/**
 * @param {unknown} value
 * @returns {any}
 */
function clone(value, seen = new Map()) {
	switch (typeof value) {
		case 'function': {
			// Svelte 5 snippets are plain functions whose `toString()` is
			// deliberately poisoned to throw `snippet_without_render_tag` — a
			// dev-mode guard against accidentally stringifying `{snippet}`
			// instead of `{@render snippet()}` in app code. That guard fires
			// just as well on this innocuous introspection call, so catch it
			// rather than let it crash the whole page.
			let source;
			try {
				source = value.toString();
			} catch {
				source = '[unable to stringify function]';
			}
			return { __is: 'function', source, name: value.name };
		}
		case 'symbol':
			return { __is: 'symbol', name: value.toString() };
		case 'object': {
			if (value === window || value === null) return null;
			if (Array.isArray(value)) return value.map((o) => clone(o, seen));
			if (seen.has(value)) return {};

			/** @type {Record<string, any>} */
			const o = {};
			seen.set(value, o);

			const descriptors = Object.getOwnPropertyDescriptors(value);
			for (const [key, v] of Object.entries(value)) {
				const { get, writable } = descriptors[key];
				const readonly = !writable || get !== undefined;
				o[key] = { key, value: clone(v, seen), readonly };
			}
			return o;
		}
		default:
			return value;
	}
}

/** @param {SvelteBlockDetail} node  */
export function serialize(node) {
	const res = /** @type {SvelteBlockDetail} */ ({
		id: node.id,
		type: node.type,
		tagName: node.tagName,
		detail: {},
	});
	switch (node.type) {
		case 'component': {
			if (typeof node.detail.$capture_state === 'function') {
				// Svelte 4 legacy component instance.
				const { $$: internal = {} } = node.detail;
				const captured = node.detail.$capture_state?.() || {};
				const bindings = Object.values(internal.bound || {}).map(
					/** @param {Function} f */ (f) => f.name,
				);
				const props = Object.keys(internal.props || {}).flatMap((key) => {
					const value = clone(captured[key]);
					delete captured[key]; // deduplicate for ctx
					if (value === undefined) return [];

					const bounded = bindings.some((f) => f.includes(key));
					return { key, value, bounded };
				});

				res.detail = {
					attributes: props,
					listeners: Object.entries(internal.callbacks || {}).flatMap(([event, value]) =>
						value.map(/** @param {Function} f */ (f) => ({ event, handler: f.toString() })),
					),
					ctx: Object.entries(captured).map(([key, v]) => ({ key, value: clone(v) })),
				};
			} else {
				// Svelte 5 ComponentContext ({ p, s: props, x: exports, ... }).
				// Only props (.s) and exports (.x) are readable/editable here —
				// arbitrary internal $state() locals are compiler-erased with no
				// name/reference reachable at runtime, so there's no equivalent of
				// $capture_state()'s full local-variable dump. Surfaced explicitly
				// below rather than silently omitted.
				const context = node.detail;
				const props = context.s || {};
				const descriptors = Object.getOwnPropertyDescriptors(props);
				const attributes = Object.keys(props).flatMap((key) => {
					const value = clone(props[key]);
					if (value === undefined) return [];
					const { get, set, writable } = descriptors[key] || {};
					const readonly = get !== undefined ? !set : !writable;
					return { key, value, readonly };
				});
				const exported = context.x || {};
				const ctx = Object.keys(exported).map((key) => ({
					key,
					value: clone(exported[key]),
					readonly: true,
				}));
				ctx.push({
					key: '(internal $state not inspectable in Svelte 5)',
					value: undefined,
					readonly: true,
				});

				res.detail = { attributes, listeners: [], ctx };
			}
			break;
		}

		case 'element': {
			/** @type {Attr[]} from {NamedNodeMap} */
			const attributes = Array.from(node.detail.attributes || []);

			/** @type {NonNullable<SvelteListenerDetail['node']['__listeners']>} */
			const listeners = node.detail.__listeners || [];

			res.detail = {
				attributes: attributes.map(({ name: key, value }) => ({ key, value, readonly: true })),
				listeners: listeners.map((o) => ({ ...o, handler: o.handler.toString() })),
			};
			break;
		}

		case 'text': {
			res.detail = {
				nodeValue: node.detail.nodeValue,
			};
			break;
		}

		case 'iteration':
		case 'block': {
			if ('source' in node.detail) {
				const { ctx, source } = node.detail;
				const cloned = Object.entries(clone(ctx));
				res.detail = {
					ctx: cloned.map(([key, value]) => ({ key, value, readonly: true })),
					source: source.slice(source.indexOf('{'), source.indexOf('}') + 1),
				};
			} else {
				// Svelte 5: no compiled block-context array or source snapshot is
				// derivable for an effect — leave empty (panel renders "None").
				res.detail = {};
			}
			break;
		}
	}

	return res;
}
