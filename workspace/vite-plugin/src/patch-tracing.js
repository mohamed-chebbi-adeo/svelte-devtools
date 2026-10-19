import MagicString from 'magic-string';

// In DEV, the Svelte compiler wraps every named `$state`/`$derived`
// declaration as `$.tag(source, 'name')` (for `$inspect.trace`), which lands in
// tag() in svelte/internal/client/dev/tracing.js. That is the one place where a
// reactive local is reachable together with its variable name, so hook it and
// hand the extension read/write accessors that go through Svelte's own
// get()/set() — reading untracked, writing with the normal reactivity flush.
const ANCHOR = 'source.label = label;';
// A `$state({...})` object that is never reassigned compiles to
// `$.tag_proxy($.proxy(...), 'name')` instead — no source, just the proxy.
const PROXY_ANCHOR = 'value?.[PROXY_PATH_SYMBOL]?.(label);';

const IMPORTS = `import { get as __devtools_get } from '../runtime.js';
import { set as __devtools_set } from '../reactivity/sources.js';
`;

const HOOK = `
	globalThis.__svelte_devtools_hook__?.stateTagged?.(source, label, {
		derived: (source.f & DERIVED) !== 0,
		get: () => untrack(() => __devtools_get(source)),
		// keep deep reactivity for \`$state\` objects (current value is a proxy),
		// leave \`$state.raw\` values unproxied
		set: (value) =>
			__devtools_set(
				source,
				value,
				typeof source.v === 'object' && source.v !== null && STATE_SYMBOL in source.v,
			),
	});`;

const PROXY_HOOK = `
	if (typeof value === 'object' && value !== null && STATE_SYMBOL in value) {
		globalThis.__svelte_devtools_hook__?.proxyTagged?.(value, label);
	}`;

/**
 * @param {string} code
 * @param {(msg: string) => void} warn
 * @returns {{ code: string, map: any } | null}
 */
export function patchTracing(code, warn) {
	const missing = [ANCHOR, PROXY_ANCHOR, 'DERIVED', 'STATE_SYMBOL', 'untrack'].filter(
		(s) => !code.includes(s),
	);
	if (missing.length) {
		warn(
			`[svelte-devtools] ${missing.join(', ')} not found in internal/client/dev/tracing.js — Svelte internals may have changed; $state inspection skipped`,
		);
		return null;
	}

	const s = new MagicString(code);
	s.prepend(IMPORTS);
	s.replace(ANCHOR, `${ANCHOR}${HOOK}`);
	s.replace(PROXY_ANCHOR, `${PROXY_ANCHOR}${PROXY_HOOK}`);

	return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
