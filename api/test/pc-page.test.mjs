import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../../config/assets/it/it.js', import.meta.url), 'utf8');
function element() {
  return {
    children: [], textContent: '',
    get firstChild() { return this.children[0]; },
    appendChild(child) { this.children.push(child); },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
    setAttribute() {}
  };
}
async function page(response, reject = false) {
  const ul = element(), ts = element(), timers = new Map();
  let next = 0, refresh;
  const document = {
    hidden: false,
    createElement: element,
    createTextNode: (text) => ({ textContent: text }),
    querySelectorAll: () => [],
    getElementById: (id) => ({ ul_pcs: ul, ts })[id],
    addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') fn(); }
  };
  vm.runInNewContext(script, {
    document, location: { pathname: '/it/available-pcs/' }, AbortController,
    performance: { now: () => 0 },
    setTimeout: (fn, ms) => { timers.set(++next, { fn, ms }); return next; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn) => { refresh = fn; },
    fetch: async () => { if (reject) throw new Error('offline'); return { ok: true, json: async () => response }; }
  });
  // Flush promises through fetch, JSON parsing, render and finally.
  await new Promise((resolve) => setImmediate(resolve));
  return { ul, ts, timers, refresh };
}
const fresh = {
  status: 'fresh', staleAfterMs: 60000, ageMs: 10000, list: ['.88 REMOTE'],
  remote: 1, percentRemote: 3, timestamp: 'Stand vom Test', footnotes: []
};

test('page expires displayed PCs without waiting for another HTTP response', async () => {
  const { ul, ts, timers } = await page(fresh);
  assert.match(ul.children[0].textContent, /REMOTE/);
  const expiry = [...timers.values()].find((timer) => timer.ms === 50000);
  assert.ok(expiry);
  expiry.fn();
  assert.match(ul.children[0].textContent, /Status veraltet/);
  assert.equal(ts.textContent, 'Stand vom Test');
  assert.equal(ts.children.length, 0); // no misleading free-PC count
});

test('outdated reports hide historical PCs and counts', async () => {
  const { ul, ts } = await page({ ...fresh, status: 'stale', ageMs: 60000 });
  assert.match(ul.children[0].textContent, /Status veraltet/);
  assert.equal(ul.children.length, 1);
  assert.equal(ts.children.length, 0);
});

test('fresh empty, missing data and connection failure have different messages', async () => {
  assert.match((await page({ ...fresh, list: [], remote: 0 })).ul.children[0].textContent, /Derzeit sind keine Computer frei/);
  assert.match((await page({ ...fresh, status: 'unavailable' })).ul.children[0].textContent, /Status unbekannt/);
  assert.match((await page(null, true)).ul.children[0].textContent, /Status nicht abrufbar/);
});
