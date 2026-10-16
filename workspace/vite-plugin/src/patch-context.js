import MagicString from 'magic-string';

// Two component-boundary hooks in svelte/internal/client/context.js:
// - push(): fires once per component instantiation, right after the DEV block
//   sets `component_context.function`/`dev_current_component_function`.
// - pop(): fires once a component finishes initializing, right after
//   `context.x` (exports) is assigned and before `component_context` is
//   restored to the parent — so the hook still sees the full, final context.
const PUSH_ANCHOR = 'component_context.function = fn;';
const POP_ANCHOR = 'context.i = true;';

/**
 * @param {string} code
 * @param {(msg: string) => void} warn
 * @returns {{ code: string, map: any } | null}
 */
export function patchContext(code, warn) {
	if (!code.includes(PUSH_ANCHOR) || !code.includes(POP_ANCHOR)) {
		warn(
			'[svelte-devtools] anchor not found in internal/client/context.js — Svelte internals may have changed; component tree instrumentation skipped',
		);
		return null;
	}

	const s = new MagicString(code);

	s.replace(
		PUSH_ANCHOR,
		`${PUSH_ANCHOR}\n\t\tglobalThis.__svelte_devtools_hook__?.componentPush?.(component_context, fn);`,
	);

	s.replace(
		POP_ANCHOR,
		`${POP_ANCHOR}\n\n\tglobalThis.__svelte_devtools_hook__?.componentPop?.(context);`,
	);

	return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
