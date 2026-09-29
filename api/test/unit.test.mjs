import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeploymentManifest } from '../src/manifest.mjs';
import { normalizePcPayload, formatTimestamp } from '../src/pcs.mjs';
import { ipAllowed, tokensEqual } from '../src/auth.mjs';
import { isValidAppId, loadConfig } from '../src/config.mjs';

const MANIFEST = `﻿<?xml version="1.0" encoding="utf-8"?>
<asmv1:assembly manifestVersion="1.0" xmlns:asmv1="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity name="IQB-Kodieren.application" version="4.3.0.3" publicKeyToken="0000000000000000" language="de" processorArchitecture="msil" xmlns="urn:schemas-microsoft-com:asm.v1" />
  <deployment install="true" mapFileExtensions="true">
    <deploymentProvider codebase="https://www.iqb.hu-berlin.de/downloads/IQB-Kodieren/IQB-Kodieren.application" />
  </deployment>
</asmv1:assembly>`;

test('parseDeploymentManifest extracts name, version and provider', () => {
  const m = parseDeploymentManifest(MANIFEST);
  assert.equal(m.name, 'IQB-Kodieren.application');
  assert.equal(m.appName, 'IQB-Kodieren');
  assert.equal(m.version, '4.3.0.3');
  assert.equal(m.deploymentProvider, 'https://www.iqb.hu-berlin.de/downloads/IQB-Kodieren/IQB-Kodieren.application');
});

test('parseDeploymentManifest tolerates garbage', () => {
  const m = parseDeploymentManifest('<html>nope</html>');
  assert.equal(m.appName, null);
  assert.equal(m.version, null);
  assert.equal(m.deploymentProvider, null);
});

test('normalizePcPayload accepts the legacy raw array and strips CR/LF', () => {
  const { list, pcMax } = normalizePcPayload('[".60 ... (nur vor Ort nutzbar)", ".88 ... (nur REMOTE)", "(gem. von 1)\\r\\n"]', 29);
  assert.deepEqual(list, ['.60 ... (nur vor Ort nutzbar)', '.88 ... (nur REMOTE)', '(gem. von 1)']);
  assert.equal(pcMax, 29);
});

test('normalizePcPayload treats an empty body as an empty list (Zope behaviour)', () => {
  assert.deepEqual(normalizePcPayload('   ', 29).list, []);
});

test('normalizePcPayload accepts {list, pc_max} and rejects junk', () => {
  assert.equal(normalizePcPayload('{"list":[".1"],"pc_max":12}', 29).pcMax, 12);
  assert.throws(() => normalizePcPayload('{"x":1}', 29), /JSON array/);
  assert.throws(() => normalizePcPayload('[1]', 29), /strings/);
  assert.throws(() => normalizePcPayload('nope', 29), /valid JSON/);
});

test('formatTimestamp renders Berlin local time in the old wording', () => {
  assert.equal(formatTimestamp(new Date('2026-09-22T07:06:00Z')), 'Stand vom 22.09.2026, 09:06 Uhr');
  assert.equal(formatTimestamp(new Date('2026-01-05T23:30:00Z')), 'Stand vom 06.01.2026, 00:30 Uhr');
});

test('ipAllowed handles CIDRs, single addresses and the empty allowlist', () => {
  assert.equal(ipAllowed('10.1.2.3', []), true);
  assert.equal(ipAllowed('141.20.5.6', ['141.20.0.0/16']), true);
  assert.equal(ipAllowed('141.21.5.6', ['141.20.0.0/16']), false);
  assert.equal(ipAllowed('::ffff:10.0.0.7', ['10.0.0.7']), true);
  assert.equal(ipAllowed('10.0.0.8', ['10.0.0.7', 'fe80::1']), false);
  assert.equal(ipAllowed('fe80::1', ['fe80::1']), true);
});

test('tokensEqual compares without leaking on length', () => {
  assert.equal(tokensEqual('abc', 'abc'), true);
  assert.equal(tokensEqual('abc', 'abcd'), false);
});

test('isValidAppId rejects reserved names, dots and traversal', () => {
  assert.equal(isValidAppId('IQB-Kodieren'), true);
  assert.equal(isValidAppId('itc_ToolBox2'), true);
  assert.equal(isValidAppId('api'), false);
  assert.equal(isValidAppId('DL'), false);
  assert.equal(isValidAppId('..'), false);
  assert.equal(isValidAppId('a.b'), false);
  assert.equal(isValidAppId('-x'), false);
  assert.equal(isValidAppId('a/b'), false);
});

test('loadConfig fails fast on weak or missing tokens', () => {
  const base = { DOWNLOADS_DIR: '/d', STATE_DIR: '/s', PC_UPDATE_TOKEN: 'x'.repeat(20), UPLOAD_TOKENS: 'alice:' + 'y'.repeat(20) };
  const saved = { ...process.env };
  try {
    Object.assign(process.env, base);
    const c = loadConfig();
    assert.equal(c.uploadTokens.get('y'.repeat(20)), 'alice');
    process.env.UPLOAD_TOKENS = 'alice:short';
    assert.throws(() => loadConfig(), /too short/);
    process.env.UPLOAD_TOKENS = 'nocolon';
    assert.throws(() => loadConfig(), /name:token/);
    delete process.env.PC_UPDATE_TOKEN;
    assert.throws(() => loadConfig(), /PC_UPDATE_TOKEN/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
