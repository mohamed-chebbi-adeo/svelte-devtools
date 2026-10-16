import { index } from './tree.js';

/** @type {undefined | SvelteBlockDetail} */
let current_block;

document.addEventListener('SvelteRegisterComponent', ({ detail }) => {
	const { component, tagName } = detail;

	const node = index.map.get(component.$$.fragment);
	if (node) {
		index.map.delete(component.$$.fragment);

		node.detail = component;
		node.tagName = tagName;

		index.update({ node });
	} else {
		// @ts-expect-error - component special case
		index.map.set(component.$$.fragment, {
			type: 'component',
			detail: component,
			tagName,
		});
	}
});

/** @type {any} */
let last_promise;
document.addEventListener('SvelteRegisterBlock', ({ detail }) => {
	const { type, id, block, ...rest } = detail;
	const current_node_id = crypto.randomUUID();

	if (block.m) {
		const original = block.m;
		block.m = (target, anchor) => {
			const parent = current_block;

			// @ts-expect-error - only the necessities
			const node = /** @type {SvelteBlockDetail} */ ({
				id: current_node_id,
				type: 'block',
				detail: rest,
				tagName: type === 'pending' ? 'await' : type,
				container: parent,
				children: [],
			});

			switch (type) {
				case 'then':
				case 'catch':
					if (!node.container) node.container = last_promise;
					break;

				case 'slot':
					node.type = 'slot';
					break;

				case 'component': {
					const component = index.map.get(block);
					if (component) {
						index.map.delete(block);
						Object.assign(node, component);
					} else {
						node.type = 'component';
						node.tagName = 'Unknown';
						node.detail = {};
						index.map.set(block, node);
					}

					Promise.resolve().then(() => {
						const invalidate = node.detail.$$?.bound || {};
						Object.keys(invalidate).length && index.update({ node });
					});
					break;
				}
			}

			if (type === 'each') {
				let group = parent && index.map.get(parent.id + id);
				if (!group) {
					// @ts-expect-error - each block fallback
					group = /** @type {SvelteBlockDetail} */ ({
						version: '',
						id: crypto.randomUUID(),
						type: 'block',
						tagName: 'each',
						container: parent,
						children: [],
						detail: {
							ctx: {},
							source: detail.source,
						},
					});
					parent && index.map.set(parent.id + id, group);
					index.add({ node: group, target, anchor });
				}

				node.container = group;
				node.type = 'iteration';

				index.add({ node, target: group, anchor });
			} else {
				index.add({ node, target, anchor });
			}

			current_block = node;

			original(target, anchor);

			current_block = parent;
		};
	}

	if (block.p) {
		const original = block.p;
		block.p = (changed, ctx) => {
			const parent = current_block;
			current_block = index.map.get(current_node_id);
			current_block && index.update({ node: current_block });

			original(changed, ctx);

			current_block = parent;
		};
	}

	if (block.d) {
		const original = block.d;
		block.d = (detaching) => {
			const node = index.map.get(current_node_id);
			if (node) {
				if (node.tagName === 'await') {
					last_promise = node.container;
				}
				index.remove(node);
			}

			original(detaching);
		};
	}
});

document.addEventListener('SvelteDOMInsert', ({ detail }) => {
	deep_insert(detail); // { node, target, anchor }

	/** @param {Omit<DocumentEventMap['SvelteDOMInsert']['detail'], 'version'>} opts */
	function deep_insert({ node: element, target, anchor }) {
		const type =
			element.nodeType === Node.ELEMENT_NODE
				? 'element'
				: element.nodeValue && element.nodeValue !== ' '
					? 'text'
					: 'anchor';

		index.add({
			anchor,
			target,
			// @ts-expect-error - missing properties are irrelevant
			node: {
				id: crypto.randomUUID(),
				type,
				detail: element,
				tagName: element.nodeName.toLowerCase(),
				container: current_block,
				children: [],
			},
		});

		element.childNodes.forEach((child) => {
			!index.map.has(child) && deep_insert({ node: child, target: element });
		});
	}
});

document.addEventListener('SvelteDOMRemove', ({ detail }) => {
	const node = index.map.get(detail.node);
	if (node) index.remove(node);
});

document.addEventListener('SvelteDOMAddEventListener', ({ detail }) => {
	const { node, ...rest } = detail;
	node.__listeners = node.__listeners || [];
	node.__listeners.push(rest);
});

document.addEventListener('SvelteDOMRemoveEventListener', ({ detail }) => {
	const { node, event, handler, modifiers } = detail;
	if (!node.__listeners || node.__listeners.length) return;
	node.__listeners = node.__listeners.filter(
		(l) => l.event !== event || l.handler !== handler || l.modifiers !== modifiers,
	);
});

document.addEventListener('SvelteDOMSetData', ({ detail }) => {
	const node = index.map.get(detail.node);
	if (!node) return;
	if (node.type === 'anchor') node.type = 'text';
	index.update({ node });
});

document.addEventListener('SvelteDOMSetProperty', ({ detail }) => {
	const node = index.map.get(detail.node);
	if (!node) return;
	if (node.type === 'anchor') node.type = 'text';
	index.update({ node });
});

document.addEventListener('SvelteDOMSetAttribute', ({ detail }) => {
	const node = index.map.get(detail.node);
	if (!node) return;
	if (node.type === 'anchor') node.type = 'text';
	index.update({ node });
});

document.addEventListener('SvelteDOMRemoveAttribute', ({ detail }) => {
	const node = index.map.get(detail.node);
	if (!node) return;
	if (node.type === 'anchor') node.type = 'text';
	index.update({ node });
});
