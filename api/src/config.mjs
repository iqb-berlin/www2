// Environment parsing. Fails fast on missing secrets so a misconfigured
// deployment never comes up with an open write endpoint.

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

// "alice:token1,bob:token2" -> Map(token -> name)
function parseUploadTokens(raw) {
  const map = new Map();
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const idx = entry.indexOf(':');
    if (idx <= 0 || idx === entry.length - 1) {
      throw new Error(`UPLOAD_TOKENS entry "${entry}" must look like name:token`);
    }
    const name = entry.slice(0, idx).trim();
    const token = entry.slice(idx + 1).trim();
    if (token.length < 16) throw new Error(`Upload token for "${name}" is too short (min 16 chars)`);
    if (map.has(token)) throw new Error(`Upload token for "${name}" is not unique`);
    map.set(token, name);
  }
  if (map.size === 0) throw new Error('UPLOAD_TOKENS contains no usable name:token entries');
  return map;
}

function parseCidrs(raw) {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const pcUpdateToken = required('PC_UPDATE_TOKEN');
  if (pcUpdateToken.length < 16) throw new Error('PC_UPDATE_TOKEN is too short (min 16 chars)');
  return {
    port: intEnv('PORT', 3000),
    downloadsDir: required('DOWNLOADS_DIR'),
    stateDir: required('STATE_DIR'),
    pcUpdateToken,
    pcUpdateAllowCidrs: parseCidrs(env.PC_UPDATE_ALLOW_CIDRS),
    pcMax: intEnv('PC_MAX', 29),
    uploadTokens: parseUploadTokens(required('UPLOAD_TOKENS')),
    uploadMaxBytes: intEnv('UPLOAD_MAX_MB', 500) * 1024 * 1024,
    // Where Visual Studio should have been told to publish to; mismatches are
    // reported as warnings, not errors (dev servers use localhost).
    expectedDeployBase: (env.EXPECTED_DEPLOY_BASE || '').trim(),
    // Public URL prefix of the ClickOnce tree as served by nginx.
    downloadUrlPrefix: '/it/dl/',
    apiPrefix: '/it/api'
  };
}

export const RESERVED_APP_IDS = new Set(['api', 'dl', 'docs', '_inc', 'license', 'available-pcs']);
export const APP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidAppId(id) {
  return APP_ID_RE.test(id) && !RESERVED_APP_IDS.has(id.toLowerCase());
}
