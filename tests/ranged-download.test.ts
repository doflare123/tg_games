import { describe, expect, it } from 'vitest';
import { downloadRangedAsset } from '../src/client/platform/ranged-download.ts';

const MB = 1024 * 1024;
describe('large static asset downloads', () => {
  it('reassembles out-of-order ranges when full downloads fail, and retries a transient failure', async () => {
    const source = Uint8Array.from({ length: 3 * MB + 17 }, (_, i) => i % 251);
    const requests: string[] = [];
    let failed = false;
    const request: typeof fetch = async (_url, options) => {
      const range = new Headers(options?.headers).get('Range');
      if (!range) return new Response('ERROR', { status: 500 });
      requests.push(range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) throw new Error('Invalid request');
      const start = Number(match[1]),
        end = Number(match[2]);
      expect(end - start + 1).toBeLessThanOrEqual(MB);
      if (start === MB && !failed) {
        failed = true;
        return new Response('ERROR', { status: 502 });
      }
      if (start === MB) await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(source.slice(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${source.length}` },
      });
    };
    const downloaded = await downloadRangedAsset('/freedoom.wad', source.length, request);
    expect(Buffer.from(downloaded).equals(Buffer.from(source))).toBe(true);
    expect(requests.filter((range) => range.startsWith(`bytes=${MB}-`))).toHaveLength(2);
  });
  it('accepts a complete initial response from servers that ignore Range', async () => {
    let calls = 0;
    const request: typeof fetch = async () => {
      calls++;
      return new Response(new Uint8Array([1, 2, 3]));
    };
    expect(await downloadRangedAsset('/file', 3, request)).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toBe(1);
  });
  it.each(['wrong range', 'truncated data', 'wrong total'])(
    'rejects %s instead of assembling a corrupt asset',
    async (problem) => {
      const request: typeof fetch = async () =>
        new Response(new Uint8Array(problem === 'truncated data' ? 2 : 3), {
          status: 206,
          headers: {
            'Content-Range':
              problem === 'wrong range'
                ? 'bytes 1-3/3'
                : problem === 'wrong total'
                  ? 'bytes 0-2/4'
                  : 'bytes 0-2/3',
          },
        });
      await expect(downloadRangedAsset('/file', 3, request)).rejects.toThrow();
    },
  );
});
