import { patchContext } from './patch-context.js';
import { patchEffects } from './patch-effects.js';
import { patchTemplate } from './patch-template.js';

/**
 * Instruments Svelte 5's internal client runtime (dev-mode only) so the
 * Svelte DevTools browser extension's content script can build a live
 * component/effect tree. Svelte 5 has no equivalent of Svelte 4's
 * `SvelteRegisterComponent`/DOM CustomEvent instrumentation, so this patches
 * a handful of already-DEV-only anchor points in `svelte/internal/client/*`
 * at dev-server transform time and calls `globalThis.__svelte_devtools_hook__`
 * — defined by the extension's content script, which runs at `document_start`
 * before any app code, per its manifest.
 *
 * Requires `svelte` to be excluded from Vite's dependency pre-bundling
 * (`optimizeDeps.exclude: ['svelte']`), otherwise esbuild serves a bundled
 * `.vite/deps/svelte.js` chunk instead of the real files this plugin targets
 * — this plugin sets that automatically via its `config()` hook.
 *
 * @returns {import('vite').Plugin}
 */
export function svelteDevtools() {
	return {
		name: 'svelte-devtools',
		apply: 'serve',
		config() {
			return {
				optimizeDeps: {
					exclude: ['svelte'],
				},
			};
		},
		transform(code, id) {
			const warn = (msg) => this.warn(msg);

			if (id.includes('/internal/client/context.js')) {
				return patchContext(code, warn);
			}
			if (id.includes('/internal/client/reactivity/effects.js')) {
				return patchEffects(code, warn);
			}
			if (id.includes('/internal/client/dom/template.js')) {
				return patchTemplate(code, warn);
			}
		},
	};
}
