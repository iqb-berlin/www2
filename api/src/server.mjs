import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { loadConfig, isValidAppId } from './config.mjs';
import { clientIp, hasPcToken, ipAllowed, uploaderFor } from './auth.mjs';
import { PcStore, normalizePcPayload } from './pcs.mjs';
import { describeApp, listApps } from './apps.mjs';
import { Uploader, UploadError } from './upload.mjs';

process.umask(0o022); // files must stay readable by the nginx container (uid 101)

const config = loadConfig();
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const pcs = new PcStore(config.stateDir, config.pcMax);
const uploader = new Uploader(config, log);

const PC_BODY_LIMIT = 64 * 1024;

function send(res, status, body, extraHeaders = {}) {
  const headers = { 'Cache-Control': 'no-store', ...extraHeaders };
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function fail(res, status, message, extra = {}, headers = {}) {
  send(res, status, { error: message, ...extra }, headers);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error(`Body larger than ${limit} bytes`), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Drain a request we are rejecting so the client sees the response.
function drain(req) {
  req.resume();
}

async function handlePcsGet(req, res) {
  send(res, 200, await pcs.view());
}

async function handlePcsPost(req, res) {
  const ip = clientIp(req);
  if (!hasPcToken(req, config.pcUpdateToken)) {
    drain(req);
    return fail(res, 401, 'Missing or invalid token', {}, { 'WWW-Authenticate': 'Bearer' });
  }
  if (!ipAllowed(ip, config.pcUpdateAllowCidrs)) {
    drain(req);
    return fail(res, 403, `Source address ${ip} is not allowed to update the PC list`);
  }
  let body;
  try {
    body = await readBody(req, PC_BODY_LIMIT);
  } catch (err) {
    return fail(res, err.status || 400, err.message);
  }
  let payload;
  try {
    const current = await pcs.read();
    payload = normalizePcPayload(body, current.pcMax);
  } catch (err) {
    return fail(res, err.status || 400, err.message);
  }
  await pcs.write(payload.list, payload.pcMax);
  log(`pcs update entries=${payload.list.length} pc_max=${payload.pcMax} ip=${ip}`);
  send(res, 204);
}

async function handleAppsList(req, res) {
  send(res, 200, { apps: await listApps(config) }, { 'Cache-Control': 'no-cache' });
}

async function handleAppGet(req, res, id) {
  const app = await describeApp(config, id);
  if (!app) return fail(res, 404, `Unknown app "${id}"`);
  send(res, 200, app, { 'Cache-Control': 'no-cache' });
}

async function handleAppPut(req, res, id) {
  const ip = clientIp(req);
  const publisher = uploaderFor(req, config.uploadTokens);
  if (!publisher) {
    drain(req);
    log(`publish denied app=${id} ip=${ip}`);
    return fail(res, 401, 'Missing or invalid upload token', {}, { 'WWW-Authenticate': 'Bearer' });
  }
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(type)) {
    drain(req);
    return fail(res, 415, 'Content-Type must be application/zip');
  }
  try {
    const { status, body } = await uploader.publish(req, id, publisher, ip);
    send(res, status, body);
  } catch (err) {
    if (err instanceof UploadError) {
      log(`publish rejected app=${id} by=${publisher} status=${err.status} reason="${err.message}"`);
      return send(res, err.status, { error: err.errors[0], errors: err.errors });
    }
    throw err;
  }
}

const routes = [
  { method: 'GET', re: /^\/health$/, handler: (req, res) => send(res, 200, { ok: true }) },
  { method: 'GET', re: /^\/pcs$/, handler: handlePcsGet },
  { method: 'POST', re: /^\/pcs$/, handler: handlePcsPost },
  { method: 'GET', re: /^\/apps$/, handler: handleAppsList },
  { method: 'GET', re: /^\/apps\/([^/]+)$/, handler: (req, res, m) => handleAppGet(req, res, m[1]) },
  { method: 'PUT', re: /^\/apps\/([^/]+)$/, handler: (req, res, m) => handleAppPut(req, res, m[1]) },
  { method: 'POST', re: /^\/apps\/([^/]+)$/, handler: (req, res, m) => handleAppPut(req, res, m[1]) }
];

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith(config.apiPrefix + '/')) return fail(res, 404, 'Not found');
  const sub = url.pathname.slice(config.apiPrefix.length).replace(/\/+$/, '') || '/';
  let methodMismatch = false;
  for (const r of routes) {
    const m = r.re.exec(sub);
    if (!m) continue;
    if (r.method !== req.method) {
      methodMismatch = true;
      continue;
    }
    if (m[1] !== undefined) {
      let id;
      try {
        id = decodeURIComponent(m[1]);
      } catch {
        return fail(res, 400, 'Malformed app id');
      }
      if (!isValidAppId(id)) {
        drain(req);
        return fail(res, 400, 'Invalid app id: use letters, digits, "_" or "-" (max 64 chars)');
      }
      m[1] = id;
    }
    return r.handler(req, res, m);
  }
  if (methodMismatch) {
    drain(req);
    return fail(res, 405, 'Method not allowed');
  }
  drain(req);
  return fail(res, 404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    log(`${req.method} ${req.url} ${res.statusCode} ${ms.toFixed(1)}ms ip=${clientIp(req)}`);
  });
  try {
    await route(req, res);
  } catch (err) {
    console.error(`${new Date().toISOString()} ERROR ${req.method} ${req.url}:`, err);
    if (!res.headersSent) fail(res, 500, 'Internal error');
    else res.destroy();
  }
});

server.requestTimeout = 600_000; // large uploads over slow links
server.headersTimeout = 65_000;

async function main() {
  await mkdir(config.stateDir, { recursive: true });
  await mkdir(config.downloadsDir, { recursive: true });
  await uploader.cleanTmp();
  server.listen(config.port, '0.0.0.0', () => {
    log(
      `it-api listening on :${config.port} downloads=${config.downloadsDir} state=${config.stateDir} uploaders=${[...config.uploadTokens.values()].join(',')} pcAllow=${config.pcUpdateAllowCidrs.join(',') || 'any'}`
    );
  });
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(`${sig} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
