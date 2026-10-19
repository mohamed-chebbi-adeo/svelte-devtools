import { type DebugNode, app } from './state.svelte';

const tabId = chrome.devtools.inspectedWindow.tabId;
let port = chrome.runtime.connect({ name: `${tabId}` });

port.postMessage({ source: 'svelte-devtools', tabId, type: 'bypass::ext/init' });

export const background = {
	send(type: `bridge::${'ext' | 'page'}/${string}` | 'bypass::ext/page->refresh', payload?: any) {
		try {
			port.postMessage({ source: 'svelte-devtools', tabId, type, payload });
		} catch {
			// https://developer.chrome.com/docs/extensions/develop/concepts/messaging#port-lifetime
			// chrome aggressively disconnects the port, not much we can do other than to reconnect
			port = chrome.runtime.connect({ name: `${tabId}` });
			background.send(type, payload); // retry immediately
		}
	},
};

function resolveEventBubble(node: any) {
	if (!node.detail || !node.detail.listeners) return;

	for (const listener of node.detail.listeners) {
		if (!listener.handler.includes('bubble($$self, event)')) continue;

		listener.handler = () => {
			let target = node;
			while ((target = target.parent)) if (target.type === 'component') break;

			const listeners = target.detail.listeners;
			if (!listeners) return null;

			const parentListener = listeners.find((o: any) => o.event === listener.event);
			if (!parentListener) return null;

			const handler = parentListener.handler;
			if (!handler) return null;

			return `// From parent\n${handler}`;
		};
	}
}

port.onMessage.addListener(({ type, payload }) => {
	switch (type) {
		case 'bridge::ext/clear': {
			app.nodes = {};
			app.selected = undefined;
			app.hovered = undefined;
			break;
		}

		case 'bridge::ext/inspect': {
			if (typeof payload === 'string') break;
			app.selected = app.nodes[payload.node.id];
			app.inspecting = false;
			break;
		}

		case 'bridge::courier/node->add': {
			const { node, target, anchor } = payload as {
				node: DebugNode;
				target: string;
				anchor: string;
			};

			// already known, e.g. replayed by a resync
			if (app.nodes[node.id]) break;

			node.parent = app.nodes[target];
			node.children = [];
			node.expanded = false;
			resolveEventBubble(node);

			app.nodes[node.id] = node;
			if (!node.parent) break;

			// link the $state proxy, not the raw object: pushing `node` again
			// would wrap it in a second, independent proxy, so its later
			// children and updates (made through app.nodes) would never render
			const proxied = app.nodes[node.id];
			const siblings = node.parent.children;
			const index = siblings.findIndex((n) => n.id === anchor);
			if (index === -1) siblings.push(proxied);
			else siblings.splice(index, 0, proxied);

			break;
		}

		case 'bridge::courier/node->remove': {
			const node = payload.node as SvelteBlockDetail;
			const current = app.nodes[node.id];
			if (!current) break;
			// drop the whole subtree: a moved component is removed and re-added
			// with its descendants' same ids, which add would otherwise skip
			const forget = (n: DebugNode) => {
				delete app.nodes[n.id];
				n.children.forEach(forget);
			};
			forget(current);
			if (!current.parent) break;

			const index = current.parent.children.findIndex((o) => o.id === current.id);
			if (index !== -1) current.parent.children.splice(index, 1);
			break;
		}

		case 'bridge::courier/node->update': {
			const node = payload.node as SvelteBlockDetail;
			const current = app.nodes[node.id];
			if (!current) break;
			Object.assign(current, node);
			resolveEventBubble(current);
			break;
		}

		// case 'bridge::courier/profile->update': {
		// 	resolveFrame(frame);
		// 	profileFrame.set(frame);
		// 	break;

		// 	function resolveFrame(frame) {
		// 		frame.children.forEach(resolveFrame);

		// 		if (!frame.node) return;

		// 		frame.node = app.nodes.get(frame.node) || {
		// 			type: 'Unknown',
		// 			tagName: 'Unknown',
		// 		};
		// 	}
		// }
	}
});
