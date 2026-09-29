import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isValidAppId } from './config.mjs';
import { parseDeploymentManifest } from './manifest.mjs';

export const PUBLISH_INFO_FILE = '.publish.json';

function formatDateBerlin(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year}`;
}

// Returns the single *.application file name in dir, or null if 0 or >1.
export async function findManifest(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const manifests = entries.filter((e) => e.isFile() && /\.application$/i.test(e.name)).map((e) => e.name);
  return manifests.length === 1 ? manifests[0] : null;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Same rule as the old Zope getAppList: a folder is an app iff it contains
// setup.exe (plus, new: exactly one deployment manifest).
export async function describeApp(config, id) {
  if (!isValidAppId(id)) return null;
  const dir = path.join(config.downloadsDir, id);
  if (!(await exists(path.join(dir, 'setup.exe')))) return null;
  const manifestName = await findManifest(dir);
  if (!manifestName) return null;
  const manifestPath = path.join(dir, manifestName);
  let manifest = { version: null, deploymentProvider: null };
  try {
    manifest = parseDeploymentManifest(await readFile(manifestPath, 'utf8'));
  } catch {
    /* unreadable manifest: still list the app, without version */
  }
  let info = null;
  try {
    info = JSON.parse(await readFile(path.join(dir, PUBLISH_INFO_FILE), 'utf8'));
  } catch {
    info = null;
  }
  let publishedAt = typeof info?.publishedAt === 'string' ? info.publishedAt : null;
  if (!publishedAt) {
    try {
      publishedAt = (await stat(manifestPath)).mtime.toISOString();
    } catch {
      publishedAt = null;
    }
  }
  const base = `${config.downloadUrlPrefix}${encodeURIComponent(id)}/`;
  return {
    id,
    version: manifest.version,
    publishedAt,
    published: publishedAt ? formatDateBerlin(publishedAt) : null,
    publishedBy: typeof info?.publishedBy === 'string' ? info.publishedBy : null,
    manifest: manifestName,
    deploymentProvider: manifest.deploymentProvider,
    setupUrl: `${base}setup.exe`,
    manifestUrl: `${base}${encodeURIComponent(manifestName)}`
  };
}

export async function listApps(config) {
  let entries;
  try {
    entries = await readdir(config.downloadsDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const apps = [];
  for (const e of entries) {
    if ((!e.isDirectory() && !e.isSymbolicLink()) || e.name.startsWith('.')) continue;
    const app = await describeApp(config, e.name);
    if (app) apps.push(app);
  }
  apps.sort((a, b) => a.id.localeCompare(b.id, 'en', { sensitivity: 'base' }));
  return apps;
}
