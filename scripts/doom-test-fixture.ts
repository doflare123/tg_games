// Original, tiny test rooms appended to a locally installed IWAD. No game data is committed.
export function doomTestWad(original: Uint8Array, secretRoute = false): Uint8Array {
  const base = Buffer.from(original);
  const count = base.readInt32LE(4),
    directory = base.readInt32LE(8);
  const entries: { name: string; offset: number; bytes: Buffer }[] = [];
  let offset = base.length;
  const add = (name: string, bytes: Buffer) => {
    entries.push({ name, offset, bytes });
    offset += bytes.length;
  };
  for (let map = 1; map <= 9; map++) {
    add(`E1M${map}`, Buffer.alloc(0));
    const things = Buffer.alloc(10);
    [96, 64, 0, 1, 7].forEach((value, i) => {
      things.writeInt16LE(value, i * 2);
    });
    add('THINGS', things);
    const lines = Buffer.alloc(4 * 14);
    for (let i = 0; i < 4; i++)
      [i, (i + 1) % 4, 1, i === 2 ? (map === 3 && secretRoute ? 51 : 11) : 0, 0, 0, 65535].forEach(
        (value, j) => {
          lines.writeUInt16LE(value, i * 14 + j * 2);
        },
      );
    add('LINEDEFS', lines);
    const sides = Buffer.alloc(30);
    sides.write('-', 4);
    sides.write('-', 12);
    sides.write('STARTAN3', 20);
    add('SIDEDEFS', sides);
    const vertices = Buffer.alloc(16);
    [0, 0, 0, 128, 128, 128, 128, 0].forEach((value, i) => {
      vertices.writeInt16LE(value, i * 2);
    });
    add('VERTEXES', vertices);
    const segs = Buffer.alloc(4 * 12);
    for (let i = 0; i < 4; i++)
      [i, (i + 1) % 4, [16384, 0, 49152, 32768][i] ?? 0, i, 0, 0].forEach((value, j) => {
        segs.writeUInt16LE(value, i * 12 + j * 2);
      });
    add('SEGS', segs);
    const subsector = Buffer.alloc(4);
    subsector.writeUInt16LE(4, 0);
    add('SSECTORS', subsector);
    add('NODES', Buffer.alloc(0));
    const sector = Buffer.alloc(26);
    sector.writeInt16LE(128, 2);
    sector.write('FLOOR0_1', 4);
    sector.write('CEIL1_1', 12);
    sector.writeInt16LE(160, 20);
    add('SECTORS', sector);
    add('REJECT', Buffer.alloc(1));
    const block = Buffer.alloc(28);
    [0, 0, 2, 2, 8, 8, 8, 8, 0, 0, 1, 2, 3, 65535].forEach((value, i) => {
      block.writeUInt16LE(value, i * 2);
    });
    add('BLOCKMAP', block);
  }
  const records = Buffer.alloc((count + entries.length) * 16);
  base.copy(records, 0, directory, directory + count * 16);
  entries.forEach((entry, i) => {
    const index = (count + i) * 16;
    records.writeInt32LE(entry.offset, index);
    records.writeInt32LE(entry.bytes.length, index + 4);
    records.write(entry.name, index + 8, 8);
  });
  const result = Buffer.concat([base, ...entries.map((entry) => entry.bytes), records]);
  result.writeInt32LE(count + entries.length, 4);
  result.writeInt32LE(offset, 8);
  return result;
}
