import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Transform, pipeline } from 'node:stream';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import { describeApp, PUBLISH_INFO_FILE } from './apps.mjs';
import { parseDeploymentManifest } from './manifest.mjs';
import { Deployments } from './deployments.mjs';

const pipe = promisify(pipeline);

export class UploadError extends Error {
  constructor(status, errors) {
    super(Array.isArray(errors) ? errors.join('; ') : errors);
    this.status = status;
    this.errors = Array.isArray(errors) ? errors : [errors];
  }
}

// A stream that counts bytes and aborts once a limit is exceeded.
function limiter(maxBytes, onLimit) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) {
        cb(onLimit());
        return;
      }
      cb(null, chunk);
    }
  });
}

function openZip(file) {
  return new Promise((resolve, reject) => {
    // strictFileNames:false lets yauzl convert the backslashes that Windows
    // PowerShell's Compress-Archive writes into forward slashes; yauzl also
    // rejects absolute paths and ".." segments on its own.
    yauzl.open(file, { lazyEntries: true, decodeStrings: true, strictFileNames: false }, (err, zip) => {
      if (err) reject(err);
      else resolve(zip);
    });
  });
}

function readEntries(zip) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zip.on('entry', (entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', reject);
    zip.readEntry();
  });
}

function normalizeName(raw) {
  let name = raw.replace(/\\/g, '/');
  while (name.startsWith('./')) name = name.slice(2);
  return name;
}

function validateName(name) {
  if (!name || name === '/') return 'empty entry name';
  if (name.startsWith('/')) return `absolute path in archive: ${name}`;
  if (/(^|\/)\.\.(\/|$)/.test(name)) return `path traversal in archive: ${name}`;
  if (name.includes('\0')) return 'NUL byte in entry name';
  const base = path.posix.basename(name.replace(/\/$/, ''));
  if (base === PUBLISH_INFO_FILE) return `${PUBLISH_INFO_FILE} may not be part of an upload`;
  return null;
}

// If every entry lives under one top-level folder (typical when someone zips
// the "publish" folder itself instead of its contents), strip that folder.
function commonPrefix(names) {
  let prefix = null;
  for (const name of names) {
    const idx = name.indexOf('/');
    if (idx <= 0) return null; // a root-level file → nothing to strip
    const head = name.slice(0, idx + 1);
    if (prefix === null) prefix = head;
    else if (head !== prefix) return null;
  }
  return prefix;
}

function analyse(entries, inflatedLimit) {
  const errors = [];
  const items = [];
  let inflated = 0;
  for (const entry of entries) {
    const name = normalizeName(entry.fileName);
    const problem = validateName(name);
    if (problem) {
      errors.push(problem);
      continue;
    }
    inflated += entry.uncompressedSize;
    items.push({ entry, name, isDir: name.endsWith('/') });
  }
  if (errors.length) throw new UploadError(422, errors.slice(0, 10));
  if (inflated > inflatedLimit) {
    throw new UploadError(413, `Archive inflates to ${inflated} bytes, limit is ${inflatedLimit}`);
  }
  const prefix = commonPrefix(items.map((i) => i.name));
  if (prefix) {
    for (const i of items) i.name = i.name.slice(prefix.length);
  }
  const files = items.filter((i) => !i.isDir && i.name !== '');
  const rootFiles = files.filter((i) => !i.name.includes('/')).map((i) => i.name);
  const manifests = rootFiles.filter((n) => /\.application$/i.test(n));
  if (!rootFiles.some((n) => n.toLowerCase() === 'setup.exe')) errors.push('setup.exe missing at archive root');
  if (manifests.length !== 1) errors.push(`expected exactly one *.application at archive root, found ${manifests.length}`);
  if (!files.some((i) => /^Application Files\//i.test(i.name))) errors.push('"Application Files/" folder missing');
  if (errors.length) throw new UploadError(422, errors);
  return { items: items.filter((i) => i.name !== ''), manifestName: manifests[0], fileCount: files.length };
}

async function extract(zipFile, items, targetDir, inflatedLimit) {
  const zip = await openZip(zipFile);
  const byName = new Map(items.map((i) => [i.entry.fileName, i]));
  let inflated = 0;
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const item = byName.get(entry.fileName);
        if (!item) {
          zip.readEntry();
          return;
        }
        const dest = path.join(targetDir, item.name);
        if (!dest.startsWith(targetDir + path.sep)) {
          reject(new UploadError(422, `refusing to write outside target: ${item.name}`));
          return;
        }
        if (item.isDir) {
          mkdir(dest, { recursive: true, mode: 0o755 }).then(() => zip.readEntry(), reject);
          return;
        }
        mkdir(path.dirname(dest), { recursive: true, mode: 0o755 })
          .then(
            () =>
              new Promise((res, rej) => {
                zip.openReadStream(entry, (err, stream) => {
                  if (err) return rej(err);
                  const counter = limiter(inflatedLimit - inflated, () =>
                    new UploadError(413, `Archive inflates beyond ${inflatedLimit} bytes`)
                  );
                  stream.on('data', (c) => (inflated += c.length));
                  pipe(stream, counter, createWriteStream(dest, { mode: 0o644 })).then(res, rej);
                });
              })
          )
          .then(() => zip.readEntry(), reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

export class Uploader {
  constructor(config, log) {
    this.config = config;
    this.log = log;
    this.locks = new Set();
    this.tmpRoot = path.join(config.downloadsDir, '.tmp');
    this.deployments = new Deployments(config.downloadsDir);
  }

  // Streams the request body to a temp zip, validates, extracts and swaps.
  async publish(req, id, publishedBy, sourceIp) {
    if (this.locks.has(id)) throw new UploadError(409, `An upload for ${id} is already in progress`);
    this.locks.add(id);
    const token = randomBytes(6).toString('hex');
    const tmpZip = path.join(this.tmpRoot, `${id}-${token}.zip`);
    const tmpDir = path.join(this.tmpRoot, `${id}-${token}`);
    try {
      await mkdir(this.tmpRoot, { recursive: true, mode: 0o755 });

      // 1. body → temp file, capped
      const cap = limiter(this.config.uploadMaxBytes, () =>
        new UploadError(413, `Upload larger than ${this.config.uploadMaxBytes} bytes`)
      );
      await pipe(req, cap, createWriteStream(tmpZip, { mode: 0o600 }));
      const size = (await stat(tmpZip)).size;
      if (size === 0) throw new UploadError(400, 'Empty request body');

      // 2. inspect
      let zip;
      try {
        zip = await openZip(tmpZip);
      } catch (err) {
        throw new UploadError(400, `Not a readable zip archive: ${err.message}`);
      }
      let entries;
      try {
        entries = await readEntries(zip);
      } catch (err) {
        throw new UploadError(422, `Invalid zip entry: ${err.message}`);
      } finally {
        zip.close();
      }
      const inflatedLimit = this.config.uploadMaxBytes * 3;
      const { items, manifestName, fileCount } = analyse(entries, inflatedLimit);

      // 3. extract
      await mkdir(tmpDir, { recursive: true, mode: 0o755 });
      await extract(tmpZip, items, tmpDir, inflatedLimit);

      // 4. manifest checks
      const manifest = parseDeploymentManifest(await readFile(path.join(tmpDir, manifestName), 'utf8'));
      const errors = [];
      const warnings = [];
      if (!manifest.appName) errors.push(`${manifestName} has no assemblyIdentity`);
      else if (manifest.appName.toLowerCase() !== id.toLowerCase()) {
        errors.push(`manifest is for "${manifest.appName}" but the upload targets "${id}"`);
      }
      if (!manifest.version) errors.push(`${manifestName} has no four-part version`);
      if (errors.length) throw new UploadError(422, errors);
      const expected = this.config.expectedDeployBase ? `${this.config.expectedDeployBase}${id}/` : null;
      if (!manifest.deploymentProvider) {
        warnings.push('manifest has no deploymentProvider (installed clients will not auto-update)');
      } else if (expected && !manifest.deploymentProvider.toLowerCase().startsWith(expected.toLowerCase())) {
        warnings.push(`deploymentProvider is ${manifest.deploymentProvider}, expected it to start with ${expected}`);
      }

      // 5. publish info + swap
      const previous = await describeApp(this.config, id);
      const publishedAt = new Date().toISOString();
      await writeFile(
        path.join(tmpDir, PUBLISH_INFO_FILE),
        JSON.stringify({ version: manifest.version, publishedAt, publishedBy, sourceIp, files: fileCount, bytes: size }),
        { mode: 0o644 }
      );
      await this.deployments.activate(id, tmpDir);
      this.log(
        `publish app=${id} version=${manifest.version} prev=${previous?.version ?? '-'} by=${publishedBy} ip=${sourceIp} files=${fileCount} bytes=${size}`
      );
      return {
        status: previous ? 200 : 201,
        body: {
          id,
          version: manifest.version,
          previousVersion: previous?.version ?? null,
          files: fileCount,
          bytes: size,
          publishedBy,
          publishedAt,
          warnings
        }
      };
    } finally {
      try {
        await rm(tmpZip, { force: true });
        await rm(tmpDir, { recursive: true, force: true });
      } finally {
        this.locks.delete(id);
      }
    }
  }

  // Housekeeping for leftovers of crashed uploads.
  async cleanTmp() {
    await this.deployments.recover();
    try {
      for (const name of await readdir(this.tmpRoot)) {
        await rm(path.join(this.tmpRoot, name), { recursive: true, force: true });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}
