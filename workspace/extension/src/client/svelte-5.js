import { index } from './tree.js';
import { componentStates } from './utils.js';

/**
 * @typedef {object} ComponentContext
 * @property {ComponentContext | null} p parent context
 * @property {Effect | null} [r] effect the component was instantiated in
 * @property {Record<string, any>} [s] props
 * @property {Record<string, any>} [x] exports
 * @property {Function} [function] the component function
 */

/**
 * @typedef {object} Effect
 * @property {Effect | null} parent
 * @property {number} f flags (BLOCK_EFFECT, BRANCH_EFFECT, ...)
 * @property {{ start: Node; end: Node | null } | null} [nodes]
 */

// Svelte 5 has no SvelteRegisterComponent/SvelteDOM* custom-event
// instrumentation like Svelte 4 — instead, a companion Vite plugin
// (svelte-devtools-vite-plugin) patches a handful of already-DEV-only anchor
// points in svelte/internal/client/{context,reactivity/effects,dom/template}.js
// to call the hook methods below, which drive the SAME version-agnostic
// `index` tree (./tree.js) the Svelte 4 path uses.
//
// Only components and DOM nodes are shown. Component identity = the
// `ComponentContext` object for its instance lifetime, used directly as an
// `index.map` key via `node.detail`. Effects aren't shown, only tracked (see
// effectCreate()). DOM nodes need one extra WeakMap (below) since click/hover
// need to resolve an arbitrary descendant DOM node up to its owning leaf
// DebugNode.

/** @type {WeakMap<Node, SvelteBlockDetail>} */
const domNodes = new WeakMap();

/**
 * `fn.name` is useless here — vite-plugin-svelte's HMR/inspector wrapping
 * means every component function is literally named "wrapper". Svelte tags
 * each component function with a `Symbol('filename')` (from its own
 * constants.js) holding the real source path, but that exact Symbol
 * reference isn't importable into this content script (separate module
 * registry/realm from the page's own Vite-served modules — Symbols aren't
 * shared unless created via Symbol.for, and this one isn't). Work around it
 * by scanning the function's own symbol keys for one whose *description* is
 * "filename" — Object.getOwnPropertySymbols() returns the real Symbol object
 * used as the key regardless of which module created it, so this works
 * without needing the same reference.
 * @param {Function} [fn]
 */
function componentName(fn) {
	if (!fn) return 'Component';
	const filenameSymbol = Object.getOwnPropertySymbols(fn).find((s) => s.description === 'filename');
	const path = filenameSymbol && /** @type {any} */ (fn)[filenameSymbol];
	if (typeof path === 'string' && path) {
		const base = path.slice(path.lastIndexOf('/') + 1);
		return base.replace(/\.svelte$/, '') || base;
	}
	return fn.name || 'Component';
}

/**
 * @param {ComponentContext} context
 * @param {Function} fn
 */
export function componentPush(context, fn) {
	// mount()/hydrate() push an anonymous context (no fn) around the root
	// component — keep it on the init stack but don't show it in the tree
	if (fn) {
		// nest the component in the effect tree via `context.r` (the effect it
		// is instantiated in — with HMR, its own wrapper branch) rather than via
		// `context.p`, otherwise components and their DOM/blocks end up in two
		// disjoint trees and the panel shows a lone, DOM-less component root
		add(
			/** @type {any} */ ({
				id: crypto.randomUUID(),
				type: 'component',
				tagName: componentName(fn),
				detail: context,
				children: [],
			}),
			ownerOf(context.r ?? null) ?? (context.p ? index.map.get(context.p) : undefined),
			context.r ?? null,
		);
	}
	initializing.push(context);
}

/**
 * The tree node that things (effects, DOM) created inside `effect` belong to:
 * the component currently initializing in it, if any — a component's own
 * template/effects are created directly in its owning effect (`context.r`)
 * — else whatever owned the effect itself.
 * @param {Effect | null} effect
 * @returns {SvelteBlockDetail | undefined}
 */
function ownerOf(effect) {
	if (!effect) return undefined;
	for (let i = initializing.length - 1; i >= 0; i -= 1) {
		const context = initializing[i];
		if (context.r !== effect) continue;
		const node = index.map.get(context);
		if (node) return node;
	}
	return effectOwners.get(effect);
}

/**
 * @param {SvelteBlockDetail} node
 * @param {SvelteBlockDetail | undefined} container
 * @param {Effect | null} effect the effect `node` is created in
 */
function add(node, container, effect) {
	node.container = container;
	index.add({ node, target: container?.detail, anchor: undefined });
	trackRoot(node);
	own(effect, node);
}

/**
 * @param {Effect | null} effect
 * @param {SvelteBlockDetail} node
 */
function own(effect, node) {
	if (!effect) return;
	const nodes = effectNodes.get(effect);
	if (nodes) nodes.push(node);
	else effectNodes.set(effect, [node]);
}

/** @param {ComponentContext} context */
export function componentPop(context) {
	if (initializing.at(-1) === context) initializing.pop();
	const node = index.map.get(context);
	if (node) index.update({ node });
}

/**
 * Components whose init (script body) is currently running, innermost last —
 * push()/pop() nest exactly like the component tree during initialization.
 * @type {ComponentContext[]}
 */
const initializing = [];

/** @type {WeakMap<object, ComponentContext>} reactive source -> owning component */
const stateOwners = new WeakMap();

/**
 * A named `$state`/`$derived` was just declared (the compiler's DEV-only
 * `$.tag(source, 'name')`). Top-level declarations run during the owning
 * component's init, so attribute it to the innermost initializing component;
 * module-level/class-field state (no component initializing) is skipped.
 * @param {object} source
 * @param {string} label
 * @param {{ derived: boolean; get: () => unknown; set: (value: unknown) => void }} api
 */
export function stateTagged(source, label, api) {
	const context = initializing.at(-1);
	if (!context) return;

	// still map a deep proxy's inner sources (`user.name`, `user version`, ...)
	// to the component so mutations refresh it — but only list real variables
	stateOwners.set(source, context);
	if (!IDENTIFIER.test(label)) return;

	const states = statesOf(context);
	// labels are panel keys (keyed each + inject path) — keep them unique
	let key = label;
	for (let n = 2; states.some((s) => s.key === key); n += 1) key = `${label} (${n})`;

	states.push({ key, ...api });
}

/**
 * A never-reassigned `$state({...})` object: compiled to
 * `$.tag_proxy(proxy, 'name')` with no source of its own. Not reassignable, but
 * its fields are editable in place (it's a deep proxy). tag() also forwards to
 * tag_proxy() for reassignable object state — that one is already listed.
 * @param {object} proxy
 * @param {string} label
 */
export function proxyTagged(proxy, label) {
	const context = initializing.at(-1);
	if (!context || !IDENTIFIER.test(label)) return;

	const states = statesOf(context);
	if (states.some((s) => s.key === label)) return;
	states.push({ key: label, derived: false, get: () => proxy });
}

const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

/** @param {ComponentContext} context */
function statesOf(context) {
	let states = componentStates.get(context);
	if (!states) componentStates.set(context, (states = []));
	return states;
}

/** @param {object} source */
export function stateSet(source) {
	const context = stateOwners.get(source);
	if (context) scheduleRefresh(context);
}

/** @type {Set<ComponentContext>} */
const dirty = new Set();

/**
 * Re-serialize a component on the next frame (coalesces bursts of writes, and
 * runs after Svelte's flush so derived values read fresh).
 * @param {ComponentContext} context
 */
function scheduleRefresh(context) {
	if (dirty.size === 0) {
		requestAnimationFrame(() => {
			for (const ctx of dirty) {
				const node = index.map.get(ctx);
				if (node) index.update({ node });
			}
			dirty.clear();
		});
	}
	dirty.add(context);
}

/**
 * Effects are Svelte's internal plumbing (every template, branch, render
 * effect... is one), so they are not shown — only the block effects of
 * `{#if}`/`{#each}`/`{#await}`/`{#key}` (identified via add_svelte_meta()) and
 * each items are. Each effect remembers which visible node things created
 * inside it belong to.
 * @type {WeakMap<Effect, SvelteBlockDetail | undefined>}
 */
const effectOwners = new WeakMap();

/**
 * Tree nodes created directly inside each effect, removed with it.
 * @type {WeakMap<Effect, SvelteBlockDetail[]>}
 */
const effectNodes = new WeakMap();

/** @param {Effect} effect */
export function effectCreate(effect) {
	const owner = ownerOf(effect.parent);
	effectOwners.set(effect, owner);

	// the block effect that $.if()/$.each()/... creates first inside its
	// add_svelte_meta() frame is that block — show it as `{#if}` etc.
	const frame = metaStack.at(-1);
	if (frame && !claimedFrames.has(frame) && effect.f & BLOCK_EFFECT && BLOCKS.has(frame.type)) {
		claimedFrames.add(frame);
		const node = /** @type {any} */ ({
			id: crypto.randomUUID(),
			type: 'block',
			tagName: frame.type,
			detail: frame,
			children: [],
		});
		add(node, owner, effect);
		effectOwners.set(effect, node);
		if (frame.type === 'each') eachEffects.add(effect);
		return;
	}

	// each item (and the {:else} fallback) is a branch of the each block
	if (effect.parent && eachEffects.has(effect.parent) && effect.f & BRANCH_EFFECT) {
		const node = /** @type {any} */ ({
			id: crypto.randomUUID(),
			type: 'iteration',
			tagName: 'each',
			detail: {},
			children: [],
		});
		add(node, owner, effect);
		effectOwners.set(effect, node);
	}
}

// effect flags from svelte/internal/client/constants.js
const BLOCK_EFFECT = 1 << 4;
const BRANCH_EFFECT = 1 << 5;

const BLOCKS = new Set(['if', 'each', 'await', 'key']);

/**
 * add_svelte_meta() frames (Svelte's DEV `dev_stack`) being executed,
 * innermost last
 * @type {{ type: string; file?: string; line: number; column: number }[]}
 */
const metaStack = [];

/** @type {WeakSet<object>} frames whose block effect was already created */
const claimedFrames = new WeakSet();

/** @type {WeakSet<Effect>} */
const eachEffects = new WeakSet();

/** @param {any} frame */
export function metaPush(frame) {
	metaStack.push(frame);
}

/** @param {any} frame */
export function metaPop(frame) {
	if (metaStack.at(-1) === frame) metaStack.pop();
}

/**
 * Root nodes created by the hydration attempt in progress, plus how deep the
 * init stack was when it started — see hydrateFailed().
 * @type {{ roots: SvelteBlockDetail[]; depth: number } | null}
 */
let hydration = null;

/** @param {SvelteBlockDetail} node */
function trackRoot(node) {
	if (hydration && !node.parent) hydration.roots.push(node);
}

export function hydrateStart() {
	hydration = { roots: [], depth: initializing.length };
}

/**
 * Svelte abandoned a mismatched hydration and is about to mount from scratch:
 * the first attempt's components never popped and its effects are never
 * destroyed, so drop its nodes here or they linger as a stale (often
 * childless) root that the panel selects first.
 */
export function hydrateFailed() {
	if (!hydration) return;
	for (const root of hydration.roots) removeTree(root);
	initializing.length = hydration.depth;
	hydration = null;
}

/** @param {SvelteBlockDetail} node */
function removeTree(node) {
	if (index.map.get(node.id) !== node) return; // already removed
	for (const child of [...node.children]) removeTree(child);
	if (node.type === 'element' || node.type === 'text') domNodes.delete(node.detail);
	index.remove(node);
}

/** @param {Effect} effect */
export function effectDestroy(effect) {
	for (const node of effectNodes.get(effect) ?? []) removeTree(node);
	effectNodes.delete(effect);
}

/**
 * @param {Effect} effect with `.nodes = { start, end }` just assigned
 *
 * Timing risk to verify against the real app: if a nested block's DOM range
 * is a subset of an ancestor's, and the ancestor's own nodesAttached walk
 * runs (and recurses into children) before the descendant's content actually
 * exists in the DOM, ownership/nesting in the tree may end up flatter than
 * the real component structure. Observe the actual rendered tree in Chrome
 * DevTools before assuming this is correct.
 */
export function nodesAttached(effect) {
	const parentNode = ownerOf(effect);
	const range = effect.nodes;
	if (!range?.start) return;

	// when hydrating, the end is only known once the effect's markup was
	// walked (e.g. each items never report it) — walk again once it's set
	if (!range.end && !pendingEnd.has(effect)) {
		pendingEnd.add(effect);
		queueMicrotask(() => {
			pendingEnd.delete(effect);
			if (effect.nodes === range && range.end) nodesAttached(effect);
		});
	}

	// blocks/components start out under their owner; move them into the
	// element their first DOM node is rendered in (an each item stays in its block)
	const placeable = parentNode?.type === 'iteration' ? parentNode.container : parentNode;
	if (placeable?.type === 'component' || placeable?.type === 'block') {
		place(placeable, range.start);
	}

	/** @type {Node | null} */
	let domNode = range.start;
	while (domNode) {
		// when hydrating, an outer effect's walk already registered the whole
		// server-rendered subtree — a deeper effect is the real owner, so
		// re-claim from ancestors only (append() reports ranges inner-first)
		const claimed = domNodes.get(domNode);
		if (claimed && claimed.container !== parentNode) {
			const owner = nearestOwner(claimed);
			if (!owner || (owner !== parentNode && parentNode && within(parentNode, owner))) {
				removeTree(claimed);
			}
		}
		const node = registerDomNode(domNode, parentNode?.detail, parentNode);
		if (node) {
			trackRoot(node);
			own(effect, node);
		}
		if (!range.end || domNode === range.end) break;
		domNode = domNode.nextSibling;
	}
}

/** @type {WeakSet<Effect>} effects waiting for their hydration end node */
const pendingEnd = new WeakSet();

/** @type {WeakSet<SvelteBlockDetail>} components already moved to their DOM position */
const placed = new WeakSet();

/**
 * Components are created before their DOM exists, so they start out as
 * children of their parent component. Once the component's first DOM node is
 * known, move it under the parent component's element that contains it, so
 * `<div><Child /></div>` shows Child inside the div, not next to it.
 * @param {SvelteBlockDetail} component
 * @param {Node} first first DOM node rendered by the component
 */
function place(component, first) {
	if (placed.has(component)) return;
	placed.add(component);
	// outside hydration the nodes are still in a detached fragment here —
	// Svelte inserts them synchronously right after, so look them up later
	queueMicrotask(() => {
		if (index.map.get(component.id) === component) move(component, first);
	});
}

/**
 * @param {SvelteBlockDetail} component
 * @param {Node} first
 */
function move(component, first) {
	let element = first.parentNode && resolveDomNode(first.parentNode);
	// skip elements the component itself rendered (e.g. inside a nested range)
	while (element && within(element, component)) element = element.container;
	if (!element || element.type !== 'element') return;
	// only within the owner's own markup — not e.g. a snippet that a
	// grandparent passed down and rendered somewhere else
	if (nearestOwner(element) !== component.container) return;

	index.remove(component);
	component.container = element;
	readd(component);
}

/**
 * Re-sends `node` and its whole subtree to the panel after a move (the panel
 * has no "move" message — remove + add). `node.container` must be set.
 * @param {SvelteBlockDetail} node
 */
function readd(node) {
	const children = node.children;
	node.children = [];
	index.add({ node, target: node.container?.detail, anchor: undefined });
	for (const child of children) readd(child);
}

/**
 * @param {SvelteBlockDetail} node
 * @param {SvelteBlockDetail} ancestor
 */
function within(node, ancestor) {
	for (let n = /** @type {SvelteBlockDetail | undefined} */ (node); n; n = n.container) {
		if (n === ancestor) return true;
	}
	return false;
}

/**
 * The component, block or each item whose markup `node` belongs to.
 * @param {SvelteBlockDetail} node
 */
function nearestOwner(node) {
	let n = node.container;
	while (n && n.type === 'element') n = n.container;
	return n;
}

/**
 * @param {Node} domNode
 * @param {object | undefined} targetKey key already registered in index.map (component context or parent DOM node)
 * @param {SvelteBlockDetail | undefined} containerNode
 * @returns {SvelteBlockDetail | undefined} the new node, if one was registered
 */
function registerDomNode(domNode, targetKey, containerNode) {
	if (domNodes.has(domNode)) return;

	const isElement = domNode.nodeType === Node.ELEMENT_NODE;
	const isText = domNode.nodeType === Node.TEXT_NODE && !!domNode.nodeValue?.trim();
	if (!isElement && !isText) return;

	const node = /** @type {any} */ ({
		id: crypto.randomUUID(),
		type: isElement ? 'element' : 'text',
		tagName: isElement ? domNode.nodeName.toLowerCase() : '#text',
		detail: domNode,
		container: containerNode,
		children: [],
	});
	index.add({ node, target: targetKey, anchor: undefined });
	domNodes.set(domNode, node);

	if (isElement) {
		for (const child of domNode.childNodes) registerDomNode(child, domNode, node);
	}
	return node;
}

/**
 * Resolves an arbitrary DOM node (e.g. a click target) to its nearest
 * registered DebugNode, walking up the parent chain if the exact node isn't
 * itself registered (e.g. it's inside an element whose own children weren't
 * individually walked, or it's a node Vite/Svelte inserted after the fact).
 * @param {Node | null} domNode
 * @returns {SvelteBlockDetail | undefined}
 */
export function resolveDomNode(domNode) {
	let node = domNode;
	while (node) {
		const found = domNodes.get(node);
		if (found) return found;
		node = node.parentElement;
	}
	return undefined;
}

// Registered immediately at module-eval time (not deferred) — this content
// script runs at document_start, before any page script, so the global must
// exist before the Vite-plugin-patched svelte internals ever get imported.
/** @type {any} */ (globalThis).__svelte_devtools_hook__ = {
	componentPush,
	componentPop,
	effectCreate,
	effectDestroy,
	nodesAttached,
	stateTagged,
	proxyTagged,
	stateSet,
	hydrateStart,
	hydrateFailed,
	metaPush,
	metaPop,
};

// Structural add/remove of DOM nodes is covered by nodesAttached()/
// effectDestroy() above. Attribute/text-content *changes* on already-known
// nodes still need to reach the panel live — rather than patch every
// individual DOM attribute-setter call site in svelte/internal/client/dom/
// elements/*.js (large surface, high churn risk across Svelte versions), a
// single scoped MutationObserver keeps them fresh.
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			const node = domNodes.get(mutation.target);
			if (!node) continue;
			index.update({ node });

			// a DOM change usually reflects state of the owning component —
			// covers deep proxy mutations and $derived values, which don't go
			// through the patched set()
			let owner = node.container;
			while (owner && owner.type !== 'component') owner = owner.container;
			if (owner) scheduleRefresh(owner.detail);
		}
	});
	const start = () => {
		observer.observe(document.documentElement, {
			attributes: true,
			characterData: true,
			subtree: true,
		});
	};
	if (document.documentElement) start();
	else document.addEventListener('DOMContentLoaded', start, { once: true });
}
