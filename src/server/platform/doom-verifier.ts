import {
  DOOM_MAX_TICKS,
  type DoomCommandSpan,
  type DoomSkill,
  doomTicks,
} from '../../shared/doom.ts';
import type { DoomHeadlessFactory } from '../../shared/doom-engine.ts';
import { AppError } from '../../shared/errors.ts';
import type { DoomSplit, DoomVerification, DoomVerifier } from '../domain/doom.ts';

// Each verification owns a fresh WASM instance. No client memory or save file is trusted.
export class WasmDoomVerifier implements DoomVerifier {
  constructor(
    private readonly wad: () => Promise<Uint8Array>,
    private readonly createDoom: DoomHeadlessFactory,
  ) {}
  async verify(skill: DoomSkill, commands: readonly DoomCommandSpan[]): Promise<DoomVerification> {
    const total = doomTicks(commands);
    if (total > DOOM_MAX_TICKS) throw new AppError('BAD_INPUT', 'Слишком длинный забег Doom');
    const engine = await this.createDoom({
      noInitialRun: true,
      print: () => {},
      printErr: () => {},
    });
    engine.FS.writeFile('/doom.wad', await this.wad());
    engine.callMain(['-iwad', '/doom.wad', '-warp', '1', '1', '-skill', skill, '-nosound']);
    let map = 1;
    let startTick = 0;
    let splitCount = 0;
    const splits: DoomSplit[] = [];
    for (const span of commands) {
      for (let i = 0; i < span.ticks; i++) {
        if (engine._arcade_get(4)) throw new AppError('BAD_INPUT', 'Команды после конца Doom');
        engine._arcade_step(span.mask);
        const next = engine._arcade_get(2);
        if (next !== map) {
          map = next;
          startTick = engine._arcade_get(0) - 1;
        }
        while (splitCount < engine._arcade_get(5)) {
          const get = (field: number) => engine._arcade_split(splitCount, field);
          splits.push({
            map: get(0),
            ticks: get(1),
            totalTicks: get(2),
            endTick: get(3),
            startTick,
            max: get(4) >= get(5) && get(6) >= get(7),
          });
          splitCount++;
        }
      }
    }
    return { ticks: engine._arcade_get(0), complete: engine._arcade_get(4) === 1, splits };
  }
}
