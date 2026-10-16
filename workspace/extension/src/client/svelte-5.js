import { index } from './tree.js';

/**
 * @typedef {object} ComponentContext
 * @property {ComponentContext | null} p parent context
 * @property {Record<string, any>} [s] props
 * @property {Record<string, any>} [x] exports
 * @property {Function} [function] the component function
 */

/**
 * @typedef {object} Effect
 * @property {Effect | null} parent
 * @property {{ start: Node; end: Node | null } | null} [nodes]
 */

// Svelte 5 has no SvelteRegisterComponent/SvelteDOM* custom-event
// instrumentation like Svelte 4 — instead, a companion Vite plugin
// (svelte-devtools-vite-plugin) patches a handful of already-DEV-only anchor
// points in svelte/internal/client/{context,reactivity/effects,dom/template}.js
// to call the hook methods below, which drive the SAME version-agnostic
// `index` tree (./tree.js) the Svelte 4 path uses.
//
// Component identity = the `ComponentContext` object for its instance
// lifetime; effect identity = the `Effect` object. Both are used directly as
// `index.map` keys via `node.detail` (index.add() already does
// `this.map.set(node.detail, node)`), so no separate bookkeeping maps are
// needed for those two node kinds. DOM nodes need one extra WeakMap (below)
// since click/hover need to resolve an arbitrary descendant DOM node up to
// its owning leaf DebugNode.

/** @type {WeakMap<object, SvelteBlockDetail>} keyed by DOM Node, Effect, or ComponentContext */
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
	const filenameSymbol = Object.getOwnPropertySymbols(fn).find(
		(s) => s.description === 'filename',
	);
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
	const node = /** @type {any} */ ({
		id: crypto.randomUUID(),
		type: 'component',
		tagName: componentName(fn),
		detail: context,
		container: context.p && index.map.get(context.p),
		children: [],
	});
	index.add({ node, target: context.p ?? undefined, anchor: undefined });
}

/** @param {ComponentContext} context */
export function componentPop(context) {
	const node = index.map.get(context);
	if (node) index.update({ node });
}

/** @param {Effect} effect */
export function effectCreate(effect) {
	// Every effect (component root, each-iteration, if-branch, template
	// render effect, ...) gets a generic 'block' node nested under whichever
	// component/effect owns it. This over-registers slightly — a component's
	// own root effect ends up as a 'component' node with a redundant 'block'
	// child wrapping it — cosmetic, not a correctness bug (the panel's
	// existing "block" visibility toggle hides these). Known follow-up: some
	// effects Svelte itself elides post-creation (see the `e.first === e.last`
	// collapse check in create_effect) will register a node here that never
	// gets a matching effectDestroy call if the parent gets pruned rather than
	// the child — verify against the real app and tune if the tree looks off.
	const parent = effect.parent;
	const node = /** @type {any} */ ({
		id: crypto.randomUUID(),
		type: 'block',
		// detail = the effect itself (not {}) so index.map — keyed by node.detail
		// — can resolve this node as a parent for nested effects/DOM via
		// index.map.get(effect). serialize() already treats any detail without
		// a `source` field as "no ctx/source derivable", so this doesn't change
		// what gets sent to the panel.
		tagName: 'block',
		detail: effect,
		container: parent && index.map.get(parent),
		children: [],
	});
	index.add({ node, target: parent ?? undefined, anchor: undefined });
}

/** @param {Effect} effect */
export function effectDestroy(effect) {
	const node = index.map.get(effect);
	if (node) index.remove(node);
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
	const parentNode = index.map.get(effect);
	const range = effect.nodes;
	if (!range?.start) return;

	/** @type {Node | null} */
	let domNode = range.start;
	while (domNode) {
		registerDomNode(domNode, effect, parentNode);
		if (!range.end || domNode === range.end) break;
		domNode = domNode.nextSibling;
	}
}

/**
 * @param {Node} domNode
 * @param {Effect | Node} targetKey key already registered in index.map (effect or a parent DOM node)
 * @param {SvelteBlockDetail | undefined} containerNode
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
			if (node) index.update({ node });
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
