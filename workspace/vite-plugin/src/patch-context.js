import MagicString from 'magic-string';

// Two component-boundary hooks in svelte/internal/client/context.js:
// - push(): fires once per component instantiation, right after the DEV block
//   sets `component_context.function`/`dev_current_component_function`.
// - pop(): fires once a component finishes initializing, right after
//   `context.x` (exports) is assigned and before `component_context` is
//   restored to the parent — so the hook still sees the full, final context.
const PUSH_ANCHOR = 'component_context.function = fn;';
const POP_ANCHOR = 'context.i = true;';
const META_ANCHOR = 'return callback();';
const META_END_ANCHOR = 'dev_stack = parent;';

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

	// add_svelte_meta(): DEV-only wrapper the compiler emits around each
	// {#if}/{#each}/{#await}/{#key}/component with its type and source location
	if (code.includes(META_ANCHOR) && code.includes(META_END_ANCHOR)) {
		s.replace(
			META_ANCHOR,
			`globalThis.__svelte_devtools_hook__?.metaPush?.(dev_stack);\n\t\t${META_ANCHOR}`,
		);
		s.replace(
			META_END_ANCHOR,
			`globalThis.__svelte_devtools_hook__?.metaPop?.(dev_stack);\n\t\t${META_END_ANCHOR}`,
		);
	} else {
		warn(
			'[svelte-devtools] add_svelte_meta() anchor not found in internal/client/context.js — {#if}/{#each}/... blocks will not be shown',
		);
	}

	return { code: s.toString(), map: s.generateMap({ hires: true }) };
}
