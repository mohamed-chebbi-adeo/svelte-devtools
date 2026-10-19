import { patchContext } from './patch-context.js';
import { patchEffects } from './patch-effects.js';
import { patchRender } from './patch-render.js';
import { patchSources } from './patch-sources.js';
import { patchTemplate } from './patch-template.js';
import { patchTracing } from './patch-tracing.js';

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
		// vite-plugin-svelte's own config hook is `order: 'pre'` and adds svelte
		// to optimizeDeps.include unless it already sees it excluded — so this
		// hook must also be `pre`, and the plugin must be listed BEFORE svelte()
		// in the user's config. Otherwise the browser loads the pre-bundled
		// runtime and never requests the files patched below.
		enforce: 'pre',
		config: {
			order: 'pre',
			handler() {
				return {
					optimizeDeps: {
						exclude: ['svelte'],
					},
				};
			},
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
			if (id.includes('/internal/client/dev/tracing.js')) {
				return patchTracing(code, warn);
			}
			if (id.includes('/internal/client/reactivity/sources.js')) {
				return patchSources(code, warn);
			}
			if (id.includes('/internal/client/render.js')) {
				return patchRender(code, warn);
			}
		},
	};
}
