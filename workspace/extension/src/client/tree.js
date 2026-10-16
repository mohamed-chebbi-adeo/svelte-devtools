import { send } from './runtime.js';
import { serialize } from './utils.js';

// Version-agnostic tree bookkeeping: builds the parent/child DebugNode tree
// the panel understands and pushes each change over the postMessage bridge.
// Originally embedded in svelte-4.js; extracted so svelte-5.js can drive the
// same tree without duplicating this reconciliation logic.
export const index = {
	/** @type {Map<string | object | Node, SvelteBlockDetail>} */
	map: new Map(),

	/** @param {{ node: SvelteBlockDetail; target?: string | object | Node; anchor?: string | object | Node }} opts */
	add({ node, target: source, anchor }) {
		this.map.set(node.id, node);
		this.map.set(node.detail, node);

		let target = source ? this.map.get(source) : undefined;
		if (!target || target.container != node.container) {
			target = node.container;
		}
		node.parent = target;

		const sibling = anchor ? this.map.get(anchor) : undefined;
		if (target) {
			const idx = target.children.findIndex((n) => n === sibling);
			if (idx === -1) target.children.push(node);
			else target.children.splice(idx, 0, node);
		}

		send('bridge::courier/node->add', {
			node: serialize(node),
			target: node.parent?.id,
			anchor: sibling?.id,
		});
	},

	/** @param {{ node: SvelteBlockDetail }} opts */
	update({ node }) {
		send('bridge::courier/node->update', {
			node: serialize(node),
		});
	},

	/** @param {SvelteBlockDetail} node */
	remove(node) {
		if (!node) return;

		this.map.delete(node.id);
		this.map.delete(node.detail);

		if (node.parent) {
			node.parent.children = node.parent.children.filter((n) => n !== node);
			node.parent = undefined;
		}

		send('bridge::courier/node->remove', {
			node: serialize(node),
		});
	},
};
