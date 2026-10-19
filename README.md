# Svelte DevTools

<a href="https://chrome.google.com/webstore/detail/svelte-devtools/kfidecgcdjjfpeckbblhmfkhmlgecoff">
	<picture>
		<source media="(prefers-color-scheme: dark)" srcset="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/UV4C4ybeBTsZt43U4xis.png">
		<img alt="Chrome Web Store" src="https://storage.googleapis.com/web-dev-uploads/image/WlD8wC6g8khYWPJUsQceQkhXSlv1/tbyBjqi7Zu733AAKA5n4.png">
	</picture>
</a>

Svelte DevTools is a browser extension for the [Svelte](https://svelte.dev/) framework. It allows you to inspect the Svelte state and component hierarchies in the Developer Tools.

After installing you will see a new tab in Developer Tools. This tab displays a tree of Svelte components, HTMLx blocks, and DOM elements that were rendered on the page. By selecting one of the nodes in the tree, you can inspect and edit its current state in the panel to the right.

> For Firefox users, you can install the [`.xpi` file of the latest version from the GitHub releases page](https://github.com/sveltejs/svelte-devtools/releases/latest). Note that if you grab the `.zip` file, you will need to load it as a temporary extension and enable "Always Allow on localhost" in the extension settings.

![2.0.0 Screenshot](./.github/assets/screenshot-2.0.0.png '2.0.0 Screenshot')

## Requirements

- Chrome or Firefox version 121 or higher
- Application running Svelte `^4.0.0` or `^5.0.0`
- Application compiled with `dev: true` ([SvelteKit](https://kit.svelte.dev/) does this automatically for you)
- **Svelte 5 only:** the [`svelte5-devtools-vite-plugin`](./workspace/vite-plugin/README.md) on the Vite dev server

## Svelte 5 support

Svelte 5 no longer exposes its component tree to browser extensions, so a
companion Vite plugin instruments Svelte's dev-mode client runtime. With it,
the panel shows:

- nested components with their props and `$state`
- `{#if}`, `{#each}`, `{#await}` and `{#key}` blocks, labelled with their source
  location (e.g. `{#if} Configurator.svelte:489`)
- each `{#each}` iteration as a separate `↪ item` node with its own content
- DOM elements, nested inside the component, block or item that rendered them

Setup:

1. Install the plugin in your app and add it **before** `svelte()` (see the
   [plugin README](./workspace/vite-plugin/README.md), including how to enable
   it only on demand).
2. Restart the Vite dev server whenever the plugin is added or updated, since
   it patches Svelte's runtime files.
3. Open DevTools, select the **Svelte** tab and click **reload** to load the
   tree. After the page navigates or refreshes, click **reload** again.

Known limitations:

- An `{#if}` block whose condition is false renders no DOM, so it is listed at
  the end of its parent instead of at its exact position.
- Only the Vite dev server is instrumented; production builds are untouched.

## Development

Clone this repository and setup the environment with `pnpm`

```sh
git clone https://github.com/sveltejs/svelte-devtools.git
cd svelte-devtools
pnpm install

cd workspace/extension
pnpm dev
```

To work on the extension, run the `dev` script from `workspace/extension` directory

```sh
cd workspace/extension
pnpm dev
```

This will build the extension and create a directory called `build`. Steps may vary depending on the browser you are using, but generally:

1. Navigate to the extensions settings page
2. Turn on the 'Developer mode' switch
3. Click 'Load Unpacked' and select the `build` directory

After rebuilding, click the reload icon of the extension on the extensions page,
then close and reopen DevTools on the inspected page.

### Checks

```sh
cd workspace/extension
pnpm check    # prettier + svelte-check
pnpm format   # prettier --write
```

### Packaging

Build the extension, then zip the `build` directory (the archive to upload to
the Chrome Web Store):

```sh
cd workspace/extension
pnpm build
pnpm bundle:zip   # build/svelte-devtools.zip
pnpm bundle:tar   # build/svelte-devtools.tar.gz
```

Run these from `workspace/extension`; the scripts don't exist at the repository root.

### Publishing the Vite plugin

The extension's Svelte 5 support depends on the plugin. Publish a new version
whenever `workspace/vite-plugin/src` changes:

```sh
cd workspace/vite-plugin
npm version patch
npm publish
```

## Acknowledgements

- This extension was initially created and developed by [RedHatter](https://github.com/RedHatter)
