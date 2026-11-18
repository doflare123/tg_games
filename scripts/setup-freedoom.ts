import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { DOOM_WAD_SHA256 } from '../src/shared/doom.ts';

const archiveSha256 = '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59';
const folder = resolve('.cache/freedoom/freedoom-0.13.0');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let installed = false;
try {
  installed = sha256(await readFile(resolve(folder, 'freedoom1.wad'))) === DOOM_WAD_SHA256;
} catch {
  /* Download the pinned distribution. */
}
if (!installed) {
  let archive: Buffer | undefined;
  try {
    const cached = await readFile('.cache/freedoom.zip');
    if (sha256(cached) === archiveSha256) archive = cached;
  } catch {
    /* Not cached. */
  }
  if (!archive) {
    const response = await fetch(
      'https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip',
      { signal: AbortSignal.timeout(120000) },
    );
    if (!response.ok) throw new Error(`Freedoom download failed: ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
    if (sha256(archive) !== archiveSha256) throw new Error('Freedoom archive checksum mismatch');
    await mkdir(resolve('.cache'), { recursive: true });
    await writeFile('.cache/freedoom.zip', archive);
  }
  // Extract only the two known entries. Archive paths are never used as destination paths.
  let end = archive.length - 22;
  while (end >= Math.max(0, archive.length - 65557) && archive.readUInt32LE(end) !== 0x06054b50)
    end--;
  if (end < 0) throw new Error('Invalid Freedoom ZIP');
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const method = archive.readUInt16LE(cursor + 10),
      size = archive.readUInt32LE(cursor + 20),
      nameLength = archive.readUInt16LE(cursor + 28),
      extra = archive.readUInt16LE(cursor + 30),
      comment = archive.readUInt16LE(cursor + 32),
      local = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extra + comment;
    for (const wanted of ['freedoom1.wad', 'COPYING.txt'])
      if (name === `freedoom-0.13.0/${wanted}`) {
        const start =
            local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28),
          compressed = archive.subarray(start, start + size);
        if (method !== 0 && method !== 8) throw new Error('Unsupported Freedoom ZIP compression');
        files.set(
          wanted,
          method === 8
            ? inflateRawSync(compressed, { maxOutputLength: 64 * 1024 * 1024 })
            : compressed,
        );
      }
  }
  const wad = files.get('freedoom1.wad'),
    license = files.get('COPYING.txt');
  if (!wad || !license || sha256(wad) !== DOOM_WAD_SHA256)
    throw new Error('Freedoom data checksum mismatch');
  await mkdir(folder, { recursive: true });
  await writeFile(resolve(folder, 'freedoom1.wad'), wad);
  await writeFile(resolve(folder, 'COPYING.txt'), license);
}
console.log('Pinned Freedoom 0.13.0 is ready inside .cache; no game data added to Git.');
