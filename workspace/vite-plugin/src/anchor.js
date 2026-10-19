/**
 * Whether `anchor` occurs exactly once in `code`. MagicString's replace()
 * only rewrites the first match, so an anchor that a future Svelte release
 * also uses elsewhere would silently patch the wrong function — treat that
 * like a missing anchor (warn and skip) instead.
 * @param {string} code
 * @param {string} anchor
 */
export function unique(code, anchor) {
	const first = code.indexOf(anchor);
	return first !== -1 && code.indexOf(anchor, first + anchor.length) === -1;
}
