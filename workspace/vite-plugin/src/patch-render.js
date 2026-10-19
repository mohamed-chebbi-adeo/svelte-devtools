import MagicString from 'magic-string';
import { unique } from './anchor.js';

// hydrate() in svelte/internal/client/render.js: when the server HTML doesn't
// match (hydration_mismatch), Svelte throws out of the half-done first attempt
// — without popping its components or destroying its effects — clears the
// target and mounts again from scratch. Mark where an attempt starts and where
// it is abandoned so the extension can drop the orphaned nodes instead of
// showing a stale, childless root next to the real tree.
const START_ANCHOR = 'const instance = _mount(component, { ...options, anchor });';
const FAIL_ANCHOR = 'clear_text_content(target);';

/**
 * @param {string} code
 * @param {(msg: string) => void} warn
 * @returns {{ code: string, map: any } | null}
 */
export function patchRender(code, warn) {
	if (!unique(code, START_ANCHOR) || !unique(code, FAIL_ANCHOR)) {
		warn(
			'[svelte-devtools] anchor not found (or not unique) in internal/client/render.js — Svelte internals may have changed; hydration-failure cleanup skipped',
		);
		return null;
	}

	const s = new MagicString(code);
	s.replace(
		START_ANCHOR,
		`globalThis.__svelte_devtools_hook__?.hydrateStart?.();\n\t\t${START_ANCHOR}`,
	);
	s.replace(
		FAIL_ANCHOR,
		`globalThis.__svelte_devtools_hook__?.hydrateFailed?.();\n\t\t${FAIL_ANCHOR}`,
	);

	return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
