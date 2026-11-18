import { sha256 } from '@noble/hashes/sha2.js';
import { gunzipSync } from 'fflate';
import { db } from 'sdk';
import { DOOM_WAD_SHA256 } from '../../shared/doom.ts';
import { AppError, integer, object, text } from '../../shared/errors.ts';

let cached: Promise<Uint8Array> | undefined;
export function serverDoomWad(): Promise<Uint8Array> {
  cached ??= load().catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}
async function load(): Promise<Uint8Array> {
  if (typeof Reflect.get(globalThis, 'WebAssembly') !== 'object')
    throw new AppError('UNAVAILABLE', 'Среда серверной проверки Doom требует WebAssembly');
  let row: unknown;
  try {
    row = await db.get('SELECT data FROM doom_assets WHERE id=:id', {
      ':id': `${DOOM_WAD_SHA256}:meta`,
    });
  } catch {
    throw new AppError('UNAVAILABLE', 'Серверные данные Freedoom ещё не установлены');
  }
  if (!row) throw new AppError('UNAVAILABLE', 'Серверные данные Freedoom не установлены');
  const manifest = object(JSON.parse(text(object(row).data, 1, 1000)));
  const parts = integer(manifest.parts, 1, 256);
  const generation = text(manifest.generation, 64, 64);
  if (!/^[a-f0-9]{64}$/.test(generation))
    throw new AppError('UNAVAILABLE', 'Повреждён manifest Freedoom');
  const compressed = new Uint8Array(integer(manifest.bytes, 1, 64 * 1024 * 1024));
  let offset = 0;
  for (let part = 0; part < parts; part++) {
    const row = await db.get('SELECT data FROM doom_assets WHERE id=:id', {
      ':id': `${DOOM_WAD_SHA256}:${generation}:${part}`,
    });
    if (!row) throw new AppError('UNAVAILABLE', 'Неполные серверные данные Freedoom');
    const chunk = decodeBase64(text(object(row).data, 4, 350000));
    if (offset + chunk.length > compressed.length)
      throw new AppError('UNAVAILABLE', 'Повреждены серверные данные Freedoom');
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== compressed.length)
    throw new AppError('UNAVAILABLE', 'Неполные серверные данные Freedoom');
  // Build-time gzip data is trusted only after the decompressed IWAD hash matches.
  const bytes = gunzipSync(compressed);
  // Native cloud WebCrypto rejects a 28 MB input; portable SHA-256 has no I/O cap.
  const digest = Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== DOOM_WAD_SHA256)
    throw new AppError('UNAVAILABLE', 'Версия серверного Freedoom не совпадает');
  return bytes;
}

// The cloud has neither Node Buffer nor the browser's atob.
function decodeBase64(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const length = (value.length * 3) / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  const bytes = new Uint8Array(length);
  let bits = 0,
    buffer = 0,
    offset = 0;
  for (let i = 0; i < value.length; i++) {
    const character = value.charCodeAt(i);
    if (character === 61) break;
    const digit = lookup[character];
    if (digit === undefined || digit < 0)
      throw new AppError('UNAVAILABLE', 'Повреждены серверные данные Freedoom');
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (buffer >> bits) & 255;
    }
  }
  return bytes;
}
