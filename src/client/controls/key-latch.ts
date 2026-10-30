export class KeyLatch<K extends number> {
  private readonly sources = new Map<string, ReadonlySet<K>>();
  private pressed = new Set<K>();
  constructor(private readonly emit: (key: K, pressed: boolean) => void) {}
  set(source: string, keys: readonly K[]): void {
    if (keys.length) this.sources.set(source, new Set(keys));
    else this.sources.delete(source);
    const next = new Set<K>();
    for (const keys of this.sources.values()) for (const key of keys) next.add(key);
    for (const key of this.pressed) if (!next.has(key)) this.emit(key, false);
    for (const key of next) if (!this.pressed.has(key)) this.emit(key, true);
    this.pressed = next;
  }
  clear(): void {
    for (const key of this.pressed) this.emit(key, false);
    this.pressed.clear();
    this.sources.clear();
  }
}
export function directions(x: number, y: number, deadZone = 0.28) {
  return { left: x < -deadZone, right: x > deadZone, up: y > deadZone, down: y < -deadZone };
}
