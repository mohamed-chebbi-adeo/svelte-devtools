import MagicString from 'magic-string';
import { unique } from './anchor.js';

// assign_nodes(start, end) in svelte/internal/client/dom/template.js is the
// single canonical site (used by both the hydration and creation paths) where
// an effect's owned DOM range (`effect.nodes = { start, end }`) gets set —
// this is what correlates an effect to the real DOM nodes it renders.
const ANCHOR = 'effect.nodes = { start, end, a: null, t: null };';
// when hydrating, assign_nodes() only knows the start (end is null) — append()
// sets the end once the template's nodes have been walked
const END_ANCHOR = 'effect.nodes.end = hydrate_node;';

/**
 * @param {string} code
 * @param {(msg: string) => void} warn
 * @returns {{ code: string, map: any } | null}
 */
export function patchTemplate(code, warn) {
	if (!unique(code, ANCHOR)) {
		warn(
			'[svelte-devtools] anchor not found (or not unique) in internal/client/dom/template.js — Svelte internals may have changed; DOM-range instrumentation skipped',
		);
		return null;
	}

	const s = new MagicString(code);

	s.replace(ANCHOR, `${ANCHOR}\n\t\tglobalThis.__svelte_devtools_hook__?.nodesAttached?.(effect);`);
	if (unique(code, END_ANCHOR)) {
		s.replace(
			END_ANCHOR,
			`${END_ANCHOR}\n\t\t\tglobalThis.__svelte_devtools_hook__?.nodesAttached?.(effect);`,
		);
	} else {
		warn(
			'[svelte-devtools] hydration end anchor not found (or not unique) in internal/client/dom/template.js — multi-root templates may be nested incorrectly',
		);
	}

	return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
