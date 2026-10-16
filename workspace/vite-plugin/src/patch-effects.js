import MagicString from 'magic-string';

// Every effect (component root, each-iteration, if-branch, template render
// effect, ...) is built by create_effect() in
// svelte/internal/client/reactivity/effects.js. In DEV mode Svelte already
// stamps `effect.component_function` for its own stack traces — piggyback on
// that same anchor rather than adding new bookkeeping.
const CREATE_ANCHOR = 'effect.component_function = dev_current_component_function;';
// destroy_effect() nulls `effect.component_function` before nulling the rest
// of the effect's fields (parent/nodes/ctx) a few lines later — hook here so
// the hook can still read those fields.
const DESTROY_ANCHOR = 'effect.component_function = null;';

/**
 * @param {string} code
 * @param {(msg: string) => void} warn
 * @returns {{ code: string, map: any } | null}
 */
export function patchEffects(code, warn) {
	if (!code.includes(CREATE_ANCHOR) || !code.includes(DESTROY_ANCHOR)) {
		warn(
			'[svelte-devtools] anchor not found in internal/client/reactivity/effects.js — Svelte internals may have changed; effect tree instrumentation skipped',
		);
		return null;
	}

	const s = new MagicString(code);

	s.replace(
		CREATE_ANCHOR,
		`${CREATE_ANCHOR}\n\t\tglobalThis.__svelte_devtools_hook__?.effectCreate?.(effect);`,
	);

	s.replace(
		DESTROY_ANCHOR,
		`globalThis.__svelte_devtools_hook__?.effectDestroy?.(effect);\n\t\t${DESTROY_ANCHOR}`,
	);

	return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
