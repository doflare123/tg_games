const CHUNK_BYTES = 1024 * 1024;

// Large static responses can fail on the hosting layer while byte ranges work.
export async function downloadRangedAsset(
  url: string,
  totalBytes: number,
  request: typeof fetch = fetch,
  onProgress: (loaded: number, total: number) => void = () => {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 1) throw new Error('Invalid asset size');
  const abort = new AbortController();
  async function read(
    start: number,
    end: number,
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; whole: boolean }> {
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await request(url, {
          headers: { Range: `bytes=${start}-${end}` },
          signal: abort.signal,
        });
        if (!response.ok)
          throw new Error(`Не удалось загрузить данные Freedoom (HTTP ${response.status}).`);
        const whole = response.status === 200 && start === 0;
        if (
          !whole &&
          (response.status !== 206 ||
            response.headers.get('Content-Range') !== `bytes ${start}-${end}/${totalBytes}`)
        ) {
          await response.body?.cancel();
          throw new Error('Сервер вернул неверный фрагмент данных Freedoom.');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length !== (whole ? totalBytes : end - start + 1))
          throw new Error('Данные Freedoom загрузились не полностью.');
        return { bytes, whole };
      } catch (error) {
        failure = error;
        if (abort.signal.aborted) throw error;
      }
    }
    throw failure;
  }
  try {
    const first = await read(0, Math.min(CHUNK_BYTES, totalBytes) - 1);
    onProgress(first.bytes.length, totalBytes);
    if (first.whole || first.bytes.length === totalBytes) return first.bytes;
    const bytes = new Uint8Array(totalBytes);
    bytes.set(first.bytes);
    let cursor = first.bytes.length;
    let loaded = first.bytes.length;
    async function worker(): Promise<void> {
      while (cursor < totalBytes) {
        const start = cursor;
        cursor = Math.min(totalBytes, start + CHUNK_BYTES);
        const { bytes: chunk } = await read(start, cursor - 1);
        bytes.set(chunk, start);
        loaded += chunk.length;
        onProgress(loaded, totalBytes);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return bytes;
  } catch (error) {
    abort.abort();
    throw error;
  }
}
