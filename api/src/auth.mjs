import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest();
}

// Constant-time comparison independent of the input lengths.
export function tokensEqual(a, b) {
  return timingSafeEqual(digest(a), digest(b));
}

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

// Returns the publisher name for a valid upload token, otherwise null.
export function uploaderFor(req, uploadTokens) {
  const token = bearerToken(req);
  if (!token) return null;
  for (const [candidate, name] of uploadTokens) {
    if (tokensEqual(token, candidate)) return name;
  }
  return null;
}

export function hasPcToken(req, pcUpdateToken) {
  const token = bearerToken(req);
  return token !== null && tokensEqual(token, pcUpdateToken);
}

// nginx overwrites X-Real-IP after resolving only explicitly trusted proxies.
// The API is private to the nginx network; do not expose it directly.
export function clientIp(req) {
  const real = (req.headers['x-real-ip'] || '').toString().trim();
  if (real && isIP(real)) return real;
  const addr = req.socket?.remoteAddress || '';
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// IPv4 CIDR / single addresses. IPv6 entries match by exact string.
// An empty allowlist allows everything (token-only protection).
export function ipAllowed(ip, cidrs) {
  if (!cidrs || cidrs.length === 0) return true;
  const plain = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  for (const rule of cidrs) {
    if (rule === plain || rule === ip) return true;
    const [net, bitsRaw] = rule.split('/');
    if (isIP(net) !== 4 || isIP(plain) !== 4) continue;
    const bits = bitsRaw === undefined ? 32 : Number.parseInt(bitsRaw, 10);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    const a = ipv4ToInt(plain);
    const b = ipv4ToInt(net);
    if (a === null || b === null) continue;
    if ((a & mask) === (b & mask)) return true;
  }
  return false;
}
