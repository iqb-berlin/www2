import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const PC_STALE_AFTER_MS = 60_000;

const MAX_ENTRIES = 1000;
const MAX_ENTRY_LENGTH = 200;

function berlinParts(date) {
  const fmt = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return parts;
}

// "Stand vom 22.09.2026, 09:06 Uhr" – same wording as the old Zope page.
export function formatTimestamp(date) {
  const p = berlinParts(date);
  return `Stand vom ${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute} Uhr`;
}

// Accepts the raw JSON array the LAN scanner has always sent, or an object
// {list: [...], pc_max: N}. Returns {list, pcMax} or throws with .status.
export function normalizePcPayload(body, fallbackPcMax) {
  let parsed;
  if (body.trim() === '') {
    parsed = [];
  } else {
    try {
      parsed = JSON.parse(body);
    } catch {
      throw Object.assign(new Error('Body is not valid JSON'), { status: 400 });
    }
  }
  let list;
  let pcMax = fallbackPcMax;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.list)) {
    list = parsed.list;
    if (parsed.pc_max !== undefined) {
      if (!Number.isInteger(parsed.pc_max) || parsed.pc_max <= 0) {
        throw Object.assign(new Error('pc_max must be a positive integer'), { status: 400 });
      }
      pcMax = parsed.pc_max;
    }
  } else {
    throw Object.assign(new Error('Body must be a JSON array of strings or {list: [...]}'), { status: 400 });
  }
  if (list.length > MAX_ENTRIES) {
    throw Object.assign(new Error(`Too many entries (max ${MAX_ENTRIES})`), { status: 400 });
  }
  const cleaned = [];
  for (const item of list) {
    if (typeof item !== 'string') {
      throw Object.assign(new Error('All list entries must be strings'), { status: 400 });
    }
    const s = item.replace(/[\r\n\t]+/g, ' ').trim();
    if (!s) continue;
    if (s.length > MAX_ENTRY_LENGTH) {
      throw Object.assign(new Error(`Entry longer than ${MAX_ENTRY_LENGTH} characters`), { status: 400 });
    }
    cleaned.push(s);
  }
  return { list: cleaned, pcMax };
}

export class PcStore {
  constructor(stateDir, defaultPcMax) {
    this.file = path.join(stateDir, 'pcs.json');
    this.defaultPcMax = defaultPcMax;
    this.pendingWrite = Promise.resolve();
  }

  async read() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const data = JSON.parse(raw);
      return {
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
        list: Array.isArray(data.list) ? data.list.filter((x) => typeof x === 'string') : [],
        pcMax: Number.isInteger(data.pc_max) && data.pc_max > 0 ? data.pc_max : this.defaultPcMax
      };
    } catch (err) {
      if (err.code === 'ENOENT') return { updatedAt: null, list: [], pcMax: this.defaultPcMax };
      throw err;
    }
  }

  write(list, pcMax) {
    // Serialize updates in arrival order; failed writes must not block later ones.
    const result = this.pendingWrite.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const data = { updatedAt: new Date().toISOString(), list, pc_max: pcMax };
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(data), { mode: 0o644, flag: 'wx' });
        await rename(tmp, this.file);
      } finally {
        await rm(tmp, { force: true });
      }
      return data;
    });
    this.pendingWrite = result.catch(() => {});
    return result;
  }

  // The public shape consumed by available-pcs/index.html.
  async view(now = Date.now()) {
    const { updatedAt, list, pcMax } = await this.read();
    const updatedMs = Date.parse(updatedAt);
    const validTime = Number.isFinite(updatedMs) && updatedMs <= now;
    const ageMs = validTime ? now - updatedMs : null;
    const status = !validTime ? 'unavailable' : ageMs >= PC_STALE_AFTER_MS ? 'stale' : 'fresh';
    const footnotes = list.filter((s) => s.startsWith('('));
    const pcs = list.filter((s) => !s.startsWith('('));
    const remote = pcs.filter((s) => /REMOTE/i.test(s)).length;
    return {
      updatedAt: validTime ? updatedAt : null,
      status,
      stale: status !== 'fresh',
      ageMs,
      staleAfterMs: PC_STALE_AFTER_MS,
      timestamp: validTime ? formatTimestamp(new Date(updatedAt)) : null,
      pc_max: pcMax,
      list: pcs,
      footnotes,
      remote,
      total: pcs.length,
      percentRemote: pcMax > 0 ? Math.round((remote * 100) / pcMax) : 0
    };
  }
}
