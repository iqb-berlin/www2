import { cp, lstat, mkdir, readdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isValidAppId } from './config.mjs';

async function info(file) {
  try { return await lstat(file); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

// Relative links resolve in both containers despite their different mount paths.
async function linkTo(target, link) {
  await symlink(path.relative(path.dirname(link), target), link);
}

export class Deployments {
  constructor(root, move = rename) {
    this.root = root;
    this.move = move;
    this.previous = path.join(root, '.prev');
    this.releases = path.join(root, '.releases');
  }

  async activate(id, staged) {
    const live = path.join(this.root, id);
    const prev = path.join(this.previous, id);
    const current = await info(live);
    const release = path.join(this.releases, id, randomUUID());
    const nextLink = path.join(this.root, `.next-${id}-${randomUUID()}`);
    await mkdir(path.dirname(release), { recursive: true });
    await mkdir(this.previous, { recursive: true });

    // Clients may already have fetched the previous manifest. Keep its versioned
    // payload URLs available across the switch. Uploaded files take precedence.
    if (current && await info(path.join(live, 'Application Files'))) {
      await cp(path.join(live, 'Application Files'), path.join(staged, 'Application Files'), {
        recursive: true, force: false, errorOnExist: false
      });
    }
    await this.move(staged, release);
    try {
      await linkTo(release, nextLink);
      if (current?.isSymbolicLink()) {
        const target = path.resolve(this.root, await readlink(live));
        await rm(prev, { recursive: true, force: true });
        await linkTo(target, prev);
        // Atomic replacement: readers see either the old or the new release.
        await this.move(nextLink, live);
      } else if (current) {
        // One-time conversion of a pre-existing ordinary directory. Restore on
        // failure; startup recovery covers a crash between these two renames.
        await rm(prev, { recursive: true, force: true });
        await this.move(live, prev);
        try { await this.move(nextLink, live); }
        catch (err) { await this.move(prev, live); throw err; }
      } else {
        await this.move(nextLink, live);
      }
    } finally {
      await rm(nextLink, { force: true });
    }
    // Keep releases: deleting an old tree could interrupt a download in flight.
  }

  async recover() {
    await mkdir(this.previous, { recursive: true });
    for (const id of await readdir(this.previous)) {
      if (!isValidAppId(id)) continue;
      const live = path.join(this.root, id);
      if (await info(live)) continue;
      const prev = path.join(this.previous, id);
      const previous = await info(prev);
      if (previous?.isSymbolicLink()) {
        await linkTo(path.resolve(this.previous, await readlink(prev)), live);
      } else if (previous?.isDirectory()) {
        await this.move(prev, live);
      }
    }
    for (const name of await readdir(this.root)) {
      if (name.startsWith('.next-') && (await info(path.join(this.root, name)))?.isSymbolicLink()) {
        await rm(path.join(this.root, name));
      }
    }
  }
}
