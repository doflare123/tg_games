import {
  ADVENTURE_HEIGHT,
  ADVENTURE_PLAYER_HEIGHT,
  ADVENTURE_WIDTH,
  type AdventurePlatform,
  type AdventureState,
  adventurePlatformX,
  monsterX,
} from '../../../games/doodle/adventure.ts';
import { SPRITES, type SpriteName } from './sprites.ts';
export type DoodlePhase = 'ready' | 'playing' | 'paused' | 'over';
const W = ADVENTURE_WIDTH,
  H = ADVENTURE_HEIGHT;
export function doodleRenderer(canvas: HTMLCanvasElement, atlas: HTMLImageElement) {
  canvas.width = W * 2;
  canvas.height = H * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas недоступен');
  const ctx = context;
  ctx.scale(2, 2);
  function sprite(name: SpriteName, x: number, y: number, width: number, height: number) {
    const [sx, sy, sw, sh] = SPRITES[name];
    ctx.drawImage(atlas, sx, sy, sw, sh, x, y, width, height);
  }
  function card(x: number, y: number, width: number, height: number, fill: string, radius = 12) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  }
  function platform(item: AdventurePlatform, state: AdventureState, camera: number) {
    const x = adventurePlatformX(item, state.ticks) / 1000;
    const y = H - (item.y - camera) / 1000;
    if (y < -50 || y > H + 50) return;
    const age = state.ticks - item.bouncedAt;
    const recoil = age >= 0 && age < 12 ? Math.sin((age / 12) * Math.PI) * 3 : 0;
    ctx.save();
    ctx.translate(x, y + recoil);
    if (item.brokenAt !== null) {
      const brokenAge = state.ticks - item.brokenAt;
      ctx.translate(0, brokenAge * brokenAge * 0.12);
      ctx.rotate(brokenAge * 0.025);
      ctx.globalAlpha = Math.max(0, 1 - brokenAge / 30);
    }
    if (item.kind === 'vanishing' && item.brokenAt === null)
      ctx.globalAlpha = 0.55 + Math.sin(state.ticks / 25 + item.phase) * 0.2;
    ctx.fillStyle = '#344f5020';
    ctx.beginPath();
    ctx.ellipse(1, 23, 33, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (item.kind === 'spring' || item.kind === 'trampoline') {
      const name =
        age >= 0 && age < 5 ? 'spring_in' : age >= 5 && age < 15 ? 'spring_out' : 'spring';
      const height =
        item.kind === 'trampoline'
          ? name === 'spring_out'
            ? 40
            : name === 'spring_in'
              ? 22
              : 32
          : name === 'spring_out'
            ? 30
            : name === 'spring_in'
              ? 16
              : 23;
      sprite(name, -32, -1, 64, height);
      if (item.kind === 'trampoline') {
        ctx.strokeStyle = '#ef8a68';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-30, 0);
        ctx.lineTo(30, 0);
        ctx.stroke();
        ctx.fillStyle = '#b65d46';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('БАТУТ', 0, height + 10);
      }
    } else {
      let name: SpriteName =
        item.kind === 'moving'
          ? 'ground_stone_small'
          : item.kind === 'fragile'
            ? 'ground_wood_small'
            : item.kind === 'vanishing'
              ? 'ground_snow_small'
              : 'ground_grass_small';
      if (item.brokenAt !== null)
        name = item.kind === 'fragile' ? 'ground_wood_small_broken' : 'ground_snow_small_broken';
      sprite(name, -36, -1, 72, 25);
      if (item.kind === 'moving') {
        ctx.fillStyle = '#fbfff9';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('↔', 0, 15);
      }
      if (item.kind === 'fragile' && item.brokenAt === null) {
        ctx.strokeStyle = '#925c3e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(1, 2);
        ctx.lineTo(-4, 10);
        ctx.lineTo(3, 12);
        ctx.lineTo(0, 20);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function player(
    state: AdventureState,
    phase: DoodlePhase,
    now: number,
    camera: number,
    deathAge: number,
  ) {
    let y = H - (state.y - camera) / 1000;
    if (phase === 'ready') y += Math.sin(now / 220) * 3;
    if (phase === 'over') y += Math.min(600, deathAge * deathAge * 0.00035);
    const bounceAge = state.ticks - state.lastBounce;
    const shotAge = state.ticks - state.lastShot;
    const name: SpriteName =
      phase === 'over'
        ? 'bunny1_hurt'
        : bounceAge < 7
          ? 'bunny1_ready'
          : state.vy > 0
            ? 'bunny1_jump'
            : Math.floor(state.ticks / 8) % 2
              ? 'bunny1_walk1'
              : 'bunny1_walk2';
    for (const dx of [-W, 0, W]) {
      ctx.save();
      ctx.translate(state.x / 1000 + dx, y);
      const powered = state.power !== 'none' && state.powerUntil > state.ticks;
      if (state.shieldUntil > state.ticks) {
        ctx.globalAlpha = 0.65;
        sprite('bubble', -30, -52, 60, 61);
        ctx.globalAlpha = 1;
      }
      if (state.invulnerableUntil > state.ticks && !powered && Math.floor(state.ticks / 5) % 2)
        ctx.globalAlpha = 0.45;
      if (powered && state.power === 'jetpack') {
        const flame = 17 + Math.sin(state.ticks * 1.8) * 6;
        sprite('flame', -22, -6, 13, flame);
        sprite('flame', 10, -6, 13, flame);
        sprite('jetpack', -27, -37, 54, 38);
      }
      if (powered && state.power === 'wings') {
        const flap = Math.sin(state.ticks * 0.5) * 5;
        sprite('wing_left', -42, -31 + flap, 28, 23);
        sprite('wing_right', 14, -31 - flap, 28, 23);
      }
      ctx.rotate(state.vx / 70000 + (phase === 'over' ? Math.min(1.4, deathAge / 500) : 0));
      if (state.vx < -100) ctx.scale(-1, 1);
      if (bounceAge >= 0 && bounceAge < 7) ctx.scale(1.12, 0.84 + bounceAge * 0.018);
      else if (state.vy > 5000) ctx.scale(0.95, 1.05);
      if (shotAge < 4) ctx.translate(0, 2 - shotAge * 0.4);
      const [, , sw, sh] = SPRITES[name];
      const height = ADVENTURE_PLAYER_HEIGHT / 1000,
        width = (sw / sh) * height;
      sprite(name, -width / 2, -height, width, height);
      ctx.restore();
    }
  }
  return (
    state: AdventureState,
    phase: DoodlePhase,
    now: number,
    best: number,
    deathAge = 0,
    ranked = false,
    verified = false,
  ) => {
    const camera = state.camera;
    const animationTick = phase === 'ready' ? Math.floor((now * 60) / 1000) : state.ticks;
    const gradient = ctx.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, '#e6f4ef');
    gradient.addColorStop(1, '#fff9e8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 5; i++) {
      const x = ((i * 107 + Math.sin(now / 13000 + i) * 12) % 400) - 35;
      const y = ((i * 137 + (camera / 1000) * 0.15) % 660) - 60;
      sprite('cloud', x, y, 90 + (i % 2) * 40, 45);
    }
    ctx.restore();
    ctx.strokeStyle = '#84b1a214';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = 0; x < W; x += 24) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = (camera / 1000) % 24; y < H; y += 24) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    for (const item of state.platforms) platform(item, state, camera);
    for (const pickup of state.pickups) {
      const x = pickup.x / 1000,
        y = H - (pickup.y - camera) / 1000 - Math.sin(state.ticks / 14 + pickup.id) * 3;
      if (y < -30 || y > H + 30) continue;
      ctx.save();
      ctx.shadowColor = '#fff5b6';
      ctx.shadowBlur = 12;
      sprite(
        pickup.kind === 'jetpack'
          ? 'powerup_jetpack'
          : pickup.kind === 'wings'
            ? 'powerup_wings'
            : 'powerup_bubble',
        x - 15,
        y - 15,
        30,
        30,
      );
      ctx.restore();
    }
    for (const monster of state.monsters) {
      const x = monsterX(monster, state.ticks) / 1000,
        y = H - (monster.y - camera) / 1000;
      if (y < -45 || y > H + 45) continue;
      const wingFrames = ['wingMan1', 'wingMan2', 'wingMan3', 'wingMan4', 'wingMan5'] as const;
      const rotorFrames = ['flyMan_fly', 'flyMan_stand', 'flyMan_jump'] as const;
      const spikeFrames = ['spikeMan_walk1', 'spikeMan_stand', 'spikeMan_walk2'] as const;
      const name =
        monster.kind === 'wing'
          ? (wingFrames[Math.floor(animationTick / 5) % 5] ?? 'wingMan1')
          : monster.kind === 'rotor'
            ? (rotorFrames[Math.floor(animationTick / 5) % 3] ?? 'flyMan_fly')
            : (spikeFrames[Math.floor(animationTick / 9) % 3] ?? 'spikeMan_stand');
      ctx.save();
      ctx.translate(x, y + Math.sin(state.ticks / 13 + monster.phase) * 2);
      if (monster.deadAt !== null) {
        const age = state.ticks - monster.deadAt;
        ctx.globalAlpha = 1 - age / 24;
        ctx.rotate(age * 0.15);
        ctx.scale(1 - age / 32, 1 - age / 32);
      } else if (state.ticks - monster.hitAt < 5) ctx.filter = 'brightness(2)';
      const width = monster.kind === 'wing' ? 50 : 34,
        height = monster.kind === 'wing' ? 31 : 40;
      sprite(name, -width / 2, -height / 2, width, height);
      if (monster.kind === 'rotor' && monster.hp > 0) {
        for (let i = 0; i < 2; i++)
          card(-8 + i * 10, -27, 7, 3, i < monster.hp ? '#db755a' : '#db755a40', 1);
      }
      ctx.restore();
    }
    for (const bullet of state.bullets) {
      const y = H - (bullet.y - camera) / 1000;
      ctx.save();
      ctx.translate(bullet.x / 1000, y);
      ctx.rotate(Math.atan2(bullet.vx, bullet.vy));
      ctx.fillStyle = '#f7bc47';
      ctx.shadowColor = '#f7bc47';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.3, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    player(state, phase, now, camera, deathAge);
    for (const event of state.effects) {
      const age = state.ticks - event.tick;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 30);
      const count = event.kind === 'shot' ? 3 : 8;
      for (let i = 0; i < count; i++) {
        const angle = (i * Math.PI * 2) / count + event.id;
        const speed = event.kind === 'pickup' ? 1.5 : 0.7;
        const x = event.x / 1000 + Math.cos(angle) * age * speed;
        const y =
          H -
          (event.y - camera) / 1000 +
          Math.sin(angle) * age * speed +
          (event.kind === 'break' ? age * age * 0.05 : 0);
        sprite(
          event.kind === 'break'
            ? 'particle_brown'
            : event.kind === 'shield'
              ? 'particle_blue'
              : event.kind === 'pop'
                ? 'particle_pink'
                : 'particle_green',
          x - 3,
          y - 3,
          6,
          6,
        );
      }
      ctx.restore();
    }
    card(8, 8, W - 16, 52, '#fffcf2ef', 13);
    ctx.fillStyle = '#526d60';
    ctx.textAlign = 'left';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('ВЫСОТА', 20, 23);
    ctx.font = 'bold 25px sans-serif';
    ctx.fillStyle = '#263e34';
    ctx.fillText(String(state.score), 19, 48);
    ctx.textAlign = 'right';
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#526d60';
    ctx.fillText(`ЛИЧНЫЙ РЕКОРД  ${best}`, 338, 24);
    sprite('wingMan1', 284, 33, 20, 15);
    ctx.fillStyle = '#263e34';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`× ${state.kills}`, 338, 46);
    const active = state.power !== 'none' && state.powerUntil > state.ticks;
    if (active || state.shieldUntil > state.ticks) {
      const icon: SpriteName = active
        ? state.power === 'jetpack'
          ? 'powerup_jetpack'
          : 'powerup_wings'
        : 'powerup_bubble';
      const title = active ? (state.power === 'jetpack' ? 'ДЖЕТПАК' : 'КРЫЛЬЯ') : 'ЗАЩИТНЫЙ ПУЗЫРЬ';
      const remaining = active
        ? (state.powerUntil - state.ticks) / (state.power === 'jetpack' ? 180 : 240)
        : (state.shieldUntil - state.ticks) / 720;
      card(98, H - 45, 164, 35, '#fffcf2ee', 12);
      sprite(icon, 106, H - 40, 25, 25);
      ctx.fillStyle = '#3a5947';
      ctx.textAlign = 'left';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(title, 138, H - 29);
      card(138, H - 23, 110, 4, '#dbe6d9', 2);
      card(138, H - 23, Math.max(1, 110 * Math.min(1, remaining)), 4, '#79b565', 2);
    }
    if (phase !== 'playing') {
      ctx.fillStyle = '#eef5e950';
      ctx.fillRect(0, 60, W, H - 60);
      ctx.save();
      ctx.shadowColor = '#476f5024';
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 8;
      card(30, 160, 300, phase === 'ready' ? 208 : 166, '#fffdf4', 20);
      ctx.restore();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#2b4937';
      ctx.font = 'bold 27px sans-serif';
      ctx.fillText(
        phase === 'ready' ? 'Doodle Jump' : phase === 'paused' ? 'Пауза' : 'Ещё выше?',
        180,
        201,
      );
      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#71816f';
      ctx.fillText(
        phase === 'ready'
          ? 'Прыгай. Стреляй. Лети.'
          : phase === 'paused'
            ? 'Отдохни и продолжай прыжок'
            : `Высота ${state.score} · монстров ${state.kills}`,
        180,
        227,
      );
      if (phase === 'ready') {
        for (const [i, [icon, label]] of [
          ['powerup_jetpack', 'Джетпак'],
          ['spring', 'Батут'],
          ['powerup_bubble', 'Защита'],
        ].entries()) {
          sprite(icon as SpriteName, 66 + i * 90, 248, 30, 30);
          ctx.font = '10px sans-serif';
          ctx.fillText(label ?? '', 81 + i * 90, 295);
        }
        ctx.font = '11px sans-serif';
        ctx.fillText('Нажми «Начать» над полем', 180, 339);
      } else {
        ctx.font = '11px sans-serif';
        ctx.fillText(
          phase === 'paused'
            ? 'Нажми «Продолжить»'
            : state.reason === 'monster'
              ? 'Монстров можно сбивать выстрелами'
              : 'Выбирай площадку для приземления',
          180,
          269,
        );
        ctx.fillStyle = '#9aa58f';
        ctx.font = '10px sans-serif';
        ctx.fillText(
          verified
            ? 'Результат проверен и записан'
            : ranked
              ? 'Рейтинговая партия · проверка результата'
              : 'Свободная игра · без рейтинга',
          180,
          299,
        );
      }
    }
  };
}
