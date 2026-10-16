import { highlight } from './highlight.js';
import { send } from './runtime.js';
import { index } from './tree.js';
import { resolveDomNode } from './svelte-5.js';
import { serialize } from './utils.js';
// svelte-4.js's DOM CustomEvent listeners are pure side effects — nothing
// else imports named exports from it, so it needs an explicit side-effect
// import to run at all.
import './svelte-4.js';

// window.__svelte is just { v: Set<versionString> } (Svelte's own mixed-
// version warning marker) — used here only to pick which instrumentation's
// strategy applies (inject()'s mutation path, click-to-select's DOM lookup).
// Both svelte-4.js and svelte-5.js drive the SAME shared `index` tree from
// tree.js, so no version branching is needed for tree/highlight/select.
// Svelte's PUBLIC_VERSION is just the major version ('5', not '5.56.4') —
// compare the whole string, not a prefix.
const isV5 = [...(/** @type {any} */ (window).__svelte?.v ?? [])].some(
	(v) => String(v) === '5',
);

// @ts-ignore - https://developer.chrome.com/docs/extensions/how-to/devtools/extend-devtools#selected-element
window['#SvelteDevTools'] = {
	/**
	 * @param {string} id
	 * @param {string[]} keys
	 * @param {any} value
	 */
	inject(id, keys, value) {
		const node = index.map.get(id);
		if (!node) return;

		if (isV5) {
			// Svelte 5: only props (component_context.s) are editable — see the
			// v5 branch of serialize() in utils.js for why arbitrary internal
			// $state() locals aren't reachable here.
			const context = node.detail;
			const props = context?.s;
			if (!props) return;

			const [prop, ...rest] = keys;
			if (rest.length === 0) {
				props[prop] = value;
				return;
			}
			let ref = props[prop];
			for (let i = 0; i < rest.length - 1; i += 1) {
				ref = ref[rest[i]];
			}
			ref[rest[rest.length - 1]] = value;
			return;
		}

		const { detail: component } = node;
		if (component) {
			const [prop, ...rest] = keys;
			const original = component.$capture_state()[prop];
			if (typeof original === 'object') {
				let ref = original;
				for (let i = 0; i < rest.length - 1; i += 1) {
					ref = ref[rest[i]];
				}
				ref[rest[rest.length - 1]] = value;
				component.$inject_state({ [prop]: original });
			} else {
				component.$inject_state({ [prop]: value });
			}
		}
	},
};

const previous = {
	/** @type {HTMLElement | null} */
	target: null,
	style: {
		cursor: '',
		background: '',
		outline: '',
	},

	clear() {
		if (this.target) {
			for (const key in this.style) {
				// @ts-expect-error - trust me TS
				this.target.style[key] = this.style[key];
			}
		}
		this.target = null;
	},
};

const inspect = {
	/** @param {MouseEvent} event  */
	handle({ target }) {
		const same = previous.target && previous.target === target;
		const html = target instanceof HTMLElement;
		if (same || !html) return;

		if (previous.target) previous.clear();
		previous.target = target;
		previous.style = {
			cursor: target.style.cursor,
			background: target.style.background,
			outline: target.style.outline,
		};
		target.style.cursor = 'pointer';
		target.style.background = 'rgba(0, 136, 204, 0.2)';
		target.style.outline = '1px dashed rgb(0, 136, 204)';
	},
	/** @param {MouseEvent} event  */
	click(event) {
		event.preventDefault();
		document.removeEventListener('mousemove', inspect.handle, true);
		const node = isV5
			? resolveDomNode(/** @type {Node} */ (event.target))
			: index.map.get(/** @type {Node} */ (event.target));
		if (node) send('bridge::ext/inspect', { node: serialize(node) });
		previous.clear();
	},
};

window.addEventListener('message', ({ data, source }) => {
	// only accept messages from our application or script
	if (source !== window || data?.source !== 'svelte-devtools') return;

	if (data.type === 'bridge::ext/select') {
		const node = index.map.get(data.payload);
		// @ts-expect-error - saved for `devtools.inspect()`
		if (node) window.$n = node.detail;
	} else if (data.type === 'bridge::ext/highlight') {
		const node = index.map.get(data.payload);
		return highlight(node);
	} else if (data.type === 'bridge::ext/inspect') {
		switch (data.payload) {
			case 'start': {
				document.addEventListener('mousemove', inspect.handle, true);
				document.addEventListener('click', inspect.click, {
					capture: true,
					once: true,
				});
				break;
			}
			default: {
				document.removeEventListener('mousemove', inspect.handle, true);
				document.removeEventListener('click', inspect.click, true);
				previous.clear();
			}
		}
	}
});
