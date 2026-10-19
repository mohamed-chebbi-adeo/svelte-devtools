<script lang="ts">
	import Indexer from '$lib/components/Indexer.svelte';
	import ElementAttributes from './ElementAttributes.svelte';
	import Ellipsis from './Ellipsis.svelte';

	import type { ComponentProps } from 'svelte';

	interface Props {
		tagName: string;
		empty: boolean;
		expanded: boolean;
		attributes: ComponentProps<typeof ElementAttributes>['attributes'];
		listeners: ComponentProps<typeof ElementAttributes>['listeners'];
		children: import('svelte').Snippet;
	}

	let { tagName, empty, expanded = $bindable(), attributes, listeners, children }: Props = $props();

	const MAX_PREVIEW = 80;

	const cached = $derived(
		attributes.map((o) => {
			const value = stringify(o.value);
			return {
				...o,
				value: value.length > MAX_PREVIEW ? `${value.slice(0, MAX_PREVIEW - 1)}…` : value,
			};
		}),
	);

	// inline tag preview, like a console summary: nested objects/arrays collapse
	// (full values stay browsable in the Props/State panel below)
	function stringify(value: any, depth = 0): string {
		switch (typeof value) {
			case 'string':
				return `"${value}"`;
			case 'undefined':
				return 'undefined';
			case 'number':
				return value != value ? 'NaN' : value.toString();
			case 'object':
				if (value == null) return 'null';
				if (value.__is === 'function') return value.name + '()';
				if (value.__is === 'symbol') return value.name;
				if (Array.isArray(value)) {
					if (depth > 0) return value.length ? '[…]' : '[]';
					return `[${value.map((v) => stringify(v, depth + 1)).join(', ')}]`;
				}
				// cloned objects hold `{ key, value, readonly }` entries (see clone() in
				// client/utils.js) — print the wrapped value, not the wrapper
				const entries = Object.values(value) as { key: string; value: unknown }[];
				if (depth > 0) return entries.length ? '{…}' : '{}';
				return `{${entries
					.map((entry) => `${entry.key}: ${stringify(entry.value, depth + 1)}`)
					.join(', ')}}`;

			case 'bigint':
				return value.toString() + 'n';
			case 'boolean':
				return value.toString();
			default:
				return '';
		}
	}
</script>

{#snippet close()}
	<span>&lt;/</span>
	<span class="tag">
		<Indexer text={tagName} />
	</span>
	<span>&gt;</span>
{/snippet}

<div
	role="group"
	class:expandable={!empty}
	class:expanded
	ondblclick={() => (expanded = !empty && !expanded)}
>
	<span>&lt;</span>
	<span class="tag">
		<Indexer text={tagName} />
	</span>
	<ElementAttributes attributes={cached} {listeners} />

	{#if empty}
		<span>&nbsp;/&gt;</span>
	{:else}
		<span>&gt;</span>
		{#if !expanded}
			<Ellipsis onclick={() => (expanded = true)} />

			{@render close()}
		{/if}
	{/if}
</div>

{#if expanded}
	{@render children()}

	<div>
		{@render close()}
	</div>
{/if}

<style>
	.tag {
		color: rgb(142, 0, 75);
	}

	:global(.dark) .tag {
		color: rgb(117, 191, 255);
	}
</style>
