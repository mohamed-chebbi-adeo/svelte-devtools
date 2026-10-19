import MagicString from 'magic-string';

// assign_nodes(start, end) in svelte/internal/client/dom/template.js is the
// single canonical site (used by both the hydration and creation paths) where
// an effect's owned DOM range (`effect.nodes = { start, end }`) gets set —
// this is what correlates an effect to the real DOM nodes it renders.
const ANCHOR = 'effect.nodes = { start, end, a: null, t: null };';

/**
 * @param {string} code
 * @param {(msg: string) => void} warn
 * @returns {{ code: string, map: any } | null}
 */
export function patchTemplate(code, warn) {
	if (!code.includes(ANCHOR)) {
		warn(
			'[svelte-devtools] anchor not found in internal/client/dom/template.js — Svelte internals may have changed; DOM-range instrumentation skipped',
		);
		return null;
	}

	const s = new MagicString(code);

	s.replace(ANCHOR, `${ANCHOR}\n\t\tglobalThis.__svelte_devtools_hook__?.nodesAttached?.(effect);`);

	return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
