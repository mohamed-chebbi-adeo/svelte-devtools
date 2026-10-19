/** @type {Map<number, chrome.runtime.Port>} */
const ports = new Map();

chrome.runtime.onConnect.addListener((port) => {
	if (port.sender?.url !== chrome.runtime.getURL('/index.html')) {
		console.error(`Unexpected connection from ${port.sender?.url || '<unknown>'}`);
		return port.disconnect();
	}

	// messages are from the devtools page and not content script (courier.js)
	port.onMessage.addListener((message, sender) => {
		switch (message.type) {
			case 'bypass::ext/init': {
				ports.set(message.tabId, sender);
				if (!chrome.tabs.onUpdated.hasListener(courier)) {
					chrome.tabs.onUpdated.addListener(courier);
				}
				// DevTools opened on an already-loaded page: connect now and ask
				// courier.js for the tree it built so far, instead of requiring a reload
				resync(message.tabId).catch(() => {}); // e.g. chrome:// pages
				break;
			}
			case 'bypass::ext/page->refresh': {
				chrome.tabs.reload(message.tabId, { bypassCache: true });
				break;
			}

			default: // relay messages from devtools to tab
				chrome.tabs.sendMessage(message.tabId, message);
		}
	});

	port.onDisconnect.addListener((disconnected) => {
		ports.delete(+disconnected.name);

		if (ports.size === 0) {
			chrome.tabs.onUpdated.removeListener(courier);
		}
	});
});

// relay messages from `chrome.scripting` to devtools page
chrome.runtime.onMessage.addListener((message, sender) => {
	if (sender.id !== chrome.runtime.id) return; // unexpected sender

	if (message.type === 'bypass::ext/icon:set') {
		const selected = message.payload ? 'default' : 'disabled';
		const icons = [16, 24, 48, 96, 128].map((s) => [s, `icons/${selected}-${s}.png`]);
		return chrome.action.setIcon({ path: Object.fromEntries(icons) });
	}

	const port = sender.tab?.id && ports.get(sender.tab.id);
	if (port) return port.postMessage(message);
});

/** @type {Parameters<typeof chrome.tabs.onUpdated.addListener>[0]} */
function courier(tabId, changed) {
	const port = ports.get(tabId);
	if (!port) return;
	if (changed.status === 'complete') {
		// the relay is injected asynchronously, so the first tree messages of a
		// fast hydration can be lost — resync the full tree once loaded
		resync(tabId).catch(() => {});
		return;
	}
	if (changed.status !== 'loading') return;
	// a new page is loading: drop the previous page's tree. Done here rather
	// than from the page's `unload` event, which Chrome no longer reliably fires
	port.postMessage({ type: 'bridge::ext/clear' });
	relay(tabId).catch(() => {});
}

/**
 * Makes sure the relay is listening, then asks courier.js to replace the
 * panel's tree with the one it built so far.
 * @param {number} tabId
 */
async function resync(tabId) {
	await relay(tabId);
	await chrome.tabs.sendMessage(tabId, { source: 'svelte-devtools', type: 'bridge::ext/resync' });
}

/** @param {number} tabId */
function relay(tabId) {
	return chrome.scripting.executeScript({
		target: { tabId },

		// ensures we're listening to the events before they're dispatched
		injectImmediately: true,

		// no lexical context, `func` is serialized and deserialized.
		// a limbo world where both `chrome` and `window` are defined
		// with many unexpected and out of the ordinary behaviors, do
		// minimal work here and delegate to `courier.js` in the page.
		// only a subset of APIs are available in this `chrome` limbo
		//	- chrome.csi->f()
		//	- chrome.dom.{openOrClosedShadowRoot->f()}
		//	- chrome.extension.{ViewType, inIncognitoContext}
		//	- chrome.i18n
		//	- chrome.runtime
		func: () => {
			// injected on page load and again whenever a panel connects — only once per page
			// @ts-ignore
			if (window.__svelte_devtools_relay__) return;
			// @ts-ignore
			window.__svelte_devtools_relay__ = true;

			chrome.runtime.onMessage.addListener((message, sender) => {
				if (sender.id !== chrome.runtime.id) return; // unexpected sender
				window.postMessage(message); // relay to content script (courier.js)
			});

			window.addEventListener('message', ({ source, data }) => {
				// only accept messages from our application or script
				if (source === window && data?.source === 'svelte-devtools') {
					chrome.runtime.sendMessage(data);
				}
			});
		},
	});
}

chrome.tabs.onActivated.addListener(({ tabId }) => sensor(tabId));
chrome.tabs.onUpdated.addListener(
	(tabId, changed) => changed.status === 'complete' && sensor(tabId),
);

/** @param {number} tabId */
async function sensor(tabId) {
	try {
		// add SvelteDevTools event listener
		await chrome.scripting.executeScript({
			target: { tabId },
			func: () => {
				document.addEventListener('SvelteDevTools', ({ detail }) => {
					chrome.runtime.sendMessage(detail);
				});
			},
		});
		// capture data to send to listener
		await chrome.scripting.executeScript({
			target: { tabId },
			world: 'MAIN',
			func: () => {
				// @ts-ignore - injected if the website is using svelte
				const [major] = [...(window.__svelte?.v ?? [])];

				document.dispatchEvent(
					new CustomEvent('SvelteDevTools', {
						detail: { type: 'bypass::ext/icon:set', payload: major },
					}),
				);
			},
		});
	} catch {
		// for internal URLs like `chrome://` or `edge://` and extension gallery
		// https://chromium.googlesource.com/chromium/src/+/ee77a52baa1f8a98d15f9749996f90e9d3200f2d/chrome/common/extensions/chrome_extensions_client.cc#131
		const icons = [16, 24, 48, 96, 128].map((s) => [s, `icons/disabled-${s}.png`]);
		chrome.action.setIcon({ path: Object.fromEntries(icons) });
	}
}
