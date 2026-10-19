import MagicString from 'magic-string';
import { unique } from './anchor.js';

// set() in svelte/internal/client/reactivity/sources.js is what every
// `count = ...` assignment to a `$state` local compiles to. Its existing DEV
// block re-tags the new value — hook right after it so the extension can
// refresh the owning component's state in the panel.
const ANCHOR = 'tag_proxy(new_value, /** @type {string} */ (source.label));';

/**
 * @param {string} code
 * @param {(msg: string) => void} warn
 * @returns {{ code: string, map: any } | null}
 */
export function patchSources(code, warn) {
	if (!unique(code, ANCHOR)) {
		warn(
			'[svelte-devtools] anchor not found (or not unique) in internal/client/reactivity/sources.js — Svelte internals may have changed; live $state refresh skipped',
		);
		return null;
	}

	const s = new MagicString(code);
	s.replace(ANCHOR, `${ANCHOR}\n\t\tglobalThis.__svelte_devtools_hook__?.stateSet?.(source);`);

	return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
