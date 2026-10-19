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
runtime files are served.
