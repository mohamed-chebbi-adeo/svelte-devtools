# svelte5-devtools-vite-plugin

Vite plugin required by the **Svelte 5 Devtools** browser extension.

Svelte 5 doesn't expose its component tree to browser extensions. This plugin
instruments Svelte's dev-mode client runtime so the extension can show
components, their DOM, props and `$state`. It only runs on the Vite dev server
(`apply: 'serve'`) — production builds are untouched.

## Install

```sh
npm i -D svelte5-devtools-vite-plugin
```

## Usage

List it **before** `svelte()`:

```js
// vite.config.js
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteDevtools } from 'svelte5-devtools-vite-plugin';

export default defineConfig({
	plugins: [svelteDevtools(), svelte()],
});
```

The plugin excludes `svelte` from Vite's dependency pre-bundling so the patched
runtime files are served. Restart the dev server after adding or updating the
plugin.

## Enable on demand

To load the plugin only when needed, gate it behind an environment variable:

```js
// vite.config.mjs
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const devtools = process.env.SVELTE_DEVTOOLS
	? [(await import('svelte5-devtools-vite-plugin')).svelteDevtools()]
	: [];

export default defineConfig({
	plugins: [...devtools, svelte()],
});
```

```sh
SVELTE_DEVTOOLS=1 npm run dev
```

The dynamic import only runs when the variable is set, so the package can stay
out of the install for people who don't use it. If they set the variable
without installing the package, the import fails. Catch that error if you want a
warning instead of a crash.

### Using a local checkout

To test unpublished changes, import the plugin from its file path instead of
the package name:

```js
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const local = process.env.SVELTE_DEVTOOLS_VITE_PLUGIN; // e.g. /path/to/svelte-devtools/workspace/vite-plugin/src/index.js
const { svelteDevtools } = await import(
	local ? pathToFileURL(path.resolve(local)).href : 'svelte5-devtools-vite-plugin'
);
```

## What it patches

Only Svelte's client runtime under `node_modules/svelte/src/internal/client`, at
serve time:

| File                    | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `context.js`            | component push/pop and `add_svelte_meta` frames (`{#if}`, `{#each}`, …) |
| `reactivity/effects.js` | effect creation/destruction (component and block lifetimes)             |
| `dom/template.js`       | DOM ranges of components, blocks and each items (also during hydration) |
| `render.js`             | drops nodes from a hydration attempt abandoned after a mismatch         |
| `reactivity/sources.js` | `$state` updates                                                        |
| `dev/tracing.js`        | named `$state`/`$derived` locals                                        |

If a Svelte release changes one of these internals, the plugin logs a warning
and that feature is skipped. The rest keeps working.

## Compatibility

- Svelte `^5.0.0`
- Vite 5, 6, 7 or 8
