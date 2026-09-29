import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PcStore } from '../src/pcs.mjs';
import { Deployments } from '../src/deployments.mjs';
import { listApps } from '../src/apps.mjs';

async function temp(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'www2-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function stage(root, name, version) {
  const dir = path.join(root, name);
  await mkdir(path.join(dir, 'Application Files', version), { recursive: true });
  await writeFile(path.join(dir, 'setup.exe'), version);
  await writeFile(path.join(dir, 'App.application'), `<assemblyIdentity name="App.application" version="${version}" />`);
  await writeFile(path.join(dir, 'Application Files', version, 'app.exe.deploy'), version);
  return dir;
}

test('PC status distinguishes no report, fresh empty list and the exact one-minute boundary', async (t) => {
  const root = await temp(t);
  const pcs = new PcStore(root, 29);
  assert.equal((await pcs.view()).status, 'unavailable');
  const record = await pcs.write([], 29);
  const timestamp = Date.parse(record.updatedAt);
  assert.equal((await pcs.view(timestamp + 59999)).status, 'fresh');
  assert.equal((await pcs.view(timestamp + 60000)).status, 'stale');
  assert.equal((await pcs.view(timestamp + 60001)).stale, true);
  assert.equal((await pcs.view(timestamp + 60001)).total, 0);
  await pcs.write(['.88 (nur REMOTE)'], 29);
  assert.equal((await pcs.view()).status, 'fresh');
  assert.equal((await pcs.view()).remote, 1);
});

test('invalid or future timestamps are unavailable, not current or an exception', async (t) => {
  const root = await temp(t);
  const pcs = new PcStore(root, 29);
  for (const updatedAt of ['bad date', null, '2099-01-01T00:00:00Z']) {
    await writeFile(path.join(root, 'pcs.json'), JSON.stringify({ updatedAt, list: ['.88 REMOTE'] }));
    assert.equal((await pcs.view()).status, 'unavailable');
    assert.equal((await pcs.view()).timestamp, null);
  }
});

test('concurrent PC writes all succeed, preserve arrival order and leave no temporary files', async (t) => {
  const root = await temp(t);
  const pcs = new PcStore(root, 29);
  await Promise.all(Array.from({ length: 50 }, (_, i) => pcs.write([String(i)], 29)));
  assert.deepEqual((await pcs.read()).list, ['49']);
  assert.deepEqual(await readdir(root), ['pcs.json']);
});

test('a failed PC write does not poison subsequent updates', async (t) => {
  const root = await temp(t);
  const blocked = path.join(root, 'state');
  await writeFile(blocked, 'not a directory');
  const pcs = new PcStore(blocked, 29);
  await assert.rejects(pcs.write(['first'], 29));
  await rm(blocked);
  await pcs.write(['second'], 29);
  assert.deepEqual((await pcs.read()).list, ['second']);
});

test('publishing uses relative links, lists apps and preserves old payloads', async (t) => {
  const root = await temp(t);
  const deployments = new Deployments(root);
  await deployments.activate('App', await stage(root, '.stage1', '1.0.0.0'));
  assert.equal((await lstat(path.join(root, 'App'))).isSymbolicLink(), true);
  await deployments.activate('App', await stage(root, '.stage2', '2.0.0.0'));
  assert.equal(await readFile(path.join(root, 'App', 'setup.exe'), 'utf8'), '2.0.0.0');
  assert.equal(await readFile(path.join(root, '.prev', 'App', 'setup.exe'), 'utf8'), '1.0.0.0');
  assert.equal(await readFile(path.join(root, 'App', 'Application Files', '1.0.0.0', 'app.exe.deploy'), 'utf8'), '1.0.0.0');
  assert.equal((await listApps({ downloadsDir: root, downloadUrlPrefix: '/it/dl/' }))[0].version, '2.0.0.0');
  const relocated = path.join(await temp(t), 'downloads');
  await rename(root, relocated);
  assert.equal(await readFile(path.join(relocated, 'App', 'setup.exe'), 'utf8'), '2.0.0.0');
});

test('failure during atomic activation leaves the current deployment readable', async (t) => {
  const root = await temp(t);
  await new Deployments(root).activate('App', await stage(root, '.stage1', '1.0.0.0'));
  const deployments = new Deployments(root, async (from, to) => {
    if (path.basename(from).startsWith('.next-')) throw new Error('simulated activation failure');
    return rename(from, to);
  });
  await assert.rejects(deployments.activate('App', await stage(root, '.stage2', '2.0.0.0')), /simulated/);
  assert.equal(await readFile(path.join(root, 'App', 'setup.exe'), 'utf8'), '1.0.0.0');
});

test('first conversion of a legacy directory rolls back on activation failure', async (t) => {
  const root = await temp(t);
  await stage(root, 'App', '1.0.0.0');
  const deployments = new Deployments(root, async (from, to) => {
    if (path.basename(from).startsWith('.next-')) throw new Error('simulated activation failure');
    return rename(from, to);
  });
  await assert.rejects(deployments.activate('App', await stage(root, '.stage2', '2.0.0.0')), /simulated/);
  assert.equal(await readFile(path.join(root, 'App', 'setup.exe'), 'utf8'), '1.0.0.0');
});

test('startup recovers interrupted legacy conversion and handles symlink backups', async (t) => {
  const root = await temp(t);
  await stage(root, 'App', '1.0.0.0');
  await mkdir(path.join(root, '.prev'));
  await rename(path.join(root, 'App'), path.join(root, '.prev', 'App'));
  const deployments = new Deployments(root);
  await deployments.recover();
  assert.equal(await readFile(path.join(root, 'App', 'setup.exe'), 'utf8'), '1.0.0.0');
  await deployments.activate('App', await stage(root, '.stage2', '2.0.0.0'));
  await deployments.activate('App', await stage(root, '.stage3', '3.0.0.0'));
  await rm(path.join(root, 'App'));
  await deployments.recover();
  assert.equal(await readFile(path.join(root, 'App', 'setup.exe'), 'utf8'), '2.0.0.0');
});
