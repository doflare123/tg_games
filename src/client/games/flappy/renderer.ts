import {
  FLAPPY_BIRD_X,
  FLAPPY_GAP,
  FLAPPY_GROUND,
  FLAPPY_SCALE,
  type FlappyState,
} from '../../../games/flappy/engine.ts';
export type FlappyPhase = 'ready' | 'playing' | 'dying' | 'over' | 'paused';
const assetNames = [
  'background-day',
  'background-night',
  'base',
  'pipe-green',
  'message',
  'gameover',
  'yellowbird-upflap',
  'yellowbird-midflap',
  'yellowbird-downflap',
  ...Array.from({ length: 10 }, (_, i) => String(i)),
];
export async function flappyRenderer(canvas: HTMLCanvasElement) {
  const assets = new Map<string, HTMLImageElement>();
  await Promise.all(
    assetNames.map(async (name) => {
      const img = new Image();
      img.src = `/assets/flappy/${name}.png`;
      await img.decode();
      assets.set(name, img);
    }),
  );
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas недоступен');
  const ctx = context;
  canvas.width = 288;
  canvas.height = 512;
  ctx.imageSmoothingEnabled = false;
  function sprite(name: string, x: number, y: number) {
    const img = assets.get(name);
    if (img) ctx.drawImage(img, Math.round(x), Math.round(y));
  }
  function digits(
    value: number,
    x: number,
    y: number,
    scale = 1,
    align: 'center' | 'right' = 'center',
  ) {
    const numbers = [...String(value)].map((v) => assets.get(v)).filter((v) => v !== undefined);
    const width = numbers.reduce((sum, img) => sum + (img.width + 2) * scale, -2 * scale);
    let left = x - (align === 'right' ? width : width / 2);
    for (const img of numbers) {
      ctx.drawImage(img, Math.round(left), y, img.width * scale, img.height * scale);
      left += (img.width + 2) * scale;
    }
  }
  // Small pixel lettering for the original cream results card.
  const letters: Record<string, string> = {
    S: '111/100/111/001/111',
    C: '111/100/100/100/111',
    O: '111/101/101/101/111',
    R: '110/101/110/101/101',
    E: '111/100/110/100/111',
    B: '110/101/110/101/110',
    T: '111/010/010/010/010',
    M: '10001/11011/10101/10001/10001',
    D: '110/101/101/101/110',
    A: '010/101/111/101/101',
    L: '100/100/100/100/111',
    N: '1001/1101/1011/1001/1001',
    W: '10001/10001/10101/11011/10001',
    P: '110/101/110/100/100',
    U: '101/101/101/101/111',
  };
  function label(value: string, x: number, y: number, color = '#d79d55', size = 2) {
    ctx.fillStyle = color;
    for (const char of value) {
      const rows = letters[char]?.split('/') ?? [];
      for (let row = 0; row < rows.length; row++) {
        const line = rows[row] ?? '';
        for (let col = 0; col < line.length; col++)
          if (line[col] === '1') ctx.fillRect(x + col * size, y + row * size, size, size);
      }
      x += ((rows[0]?.length ?? 2) + 1) * size;
    }
  }
  return (
    state: FlappyState,
    phase: FlappyPhase,
    time: number,
    best: number,
    night = false,
    deathAge = 0,
  ) => {
    sprite(night ? 'background-night' : 'background-day', 0, 0);
    const pipeImage = assets.get('pipe-green');
    if (phase !== 'ready' && pipeImage) {
      for (const pipe of state.pipes) {
        const x = Math.round(pipe.x / FLAPPY_SCALE);
        const top = pipe.gapY - FLAPPY_GAP / 2;
        ctx.save();
        ctx.translate(x, top);
        ctx.scale(1, -1);
        ctx.drawImage(pipeImage, 0, 0);
        ctx.restore();
        ctx.drawImage(pipeImage, x, top + FLAPPY_GAP);
      }
    }
    let birdY = state.y / FLAPPY_SCALE;
    if (phase === 'ready') birdY = 235 + Math.sin(time / 180) * 4;
    if (phase === 'dying' || phase === 'over')
      birdY = Math.min(FLAPPY_GROUND - 12, birdY + deathAge * deathAge * 0.0005);
    const alive = phase === 'ready' || phase === 'playing';
    const wing = alive ? ['up', 'mid', 'down', 'mid'][Math.floor(time / 90) % 4] : 'mid';
    ctx.save();
    ctx.translate(FLAPPY_BIRD_X, Math.round(birdY));
    const angle =
      phase === 'ready'
        ? 0
        : phase === 'dying' || phase === 'over'
          ? Math.min(Math.PI / 2, deathAge / 350)
          : Math.max(-0.4, Math.min(Math.PI / 2, (state.velocity - 1200) / 6500));
    ctx.rotate(angle);
    sprite(`yellowbird-${wing}flap`, -17, -12);
    ctx.restore();
    const offset = alive
      ? Math.floor((phase === 'ready' ? time * 0.132 : state.ticks * 2.2) % 48)
      : 0;
    sprite('base', -offset, FLAPPY_GROUND);
    if (phase === 'ready') {
      const msg = assets.get('message');
      if (msg) {
        ctx.drawImage(msg, 0, 0, 184, 48, 52, 60, 184, 48);
        ctx.drawImage(msg, 0, 98, 184, 54, 52, 148, 184, 54);
        ctx.drawImage(msg, 0, 200, 184, 67, 52, 270, 184, 67);
      }
    } else if (phase === 'playing' || phase === 'dying') digits(state.score, 144, 40);
    if (phase === 'dying' && deathAge < 120) {
      ctx.fillStyle = `rgba(255,255,255,${1 - deathAge / 120})`;
      ctx.fillRect(0, 0, 288, 512);
    }
    if (phase === 'over') {
      sprite('gameover', 48, 104);
      ctx.fillStyle = '#543847';
      ctx.fillRect(30, 173, 228, 118);
      ctx.fillStyle = '#e0d39b';
      ctx.fillRect(33, 176, 222, 109);
      ctx.fillStyle = '#fff0bc';
      ctx.fillRect(36, 179, 216, 3);
      ctx.fillStyle = '#c7b97c';
      ctx.fillRect(36, 282, 216, 3);
      label('MEDAL', 49, 191);
      label('SCORE', 193, 191);
      label('BEST', 201, 237);
      digits(state.score, 237, 207, 0.6, 'right');
      digits(best, 237, 254, 0.6, 'right');
      if (state.score >= 10) {
        const gold = state.score >= 30;
        ctx.fillStyle = '#ad8b57';
        ctx.beginPath();
        ctx.arc(79, 240, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = gold ? '#f6d65b' : state.score >= 20 ? '#e6e6dd' : '#dba372';
        ctx.beginPath();
        ctx.arc(79, 238, 19, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff0bc';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(79, 238, 15, 0, Math.PI * 2);
        ctx.stroke();
        sprite('yellowbird-midflap', 62, 226);
      }
      if (state.score > 0 && state.score >= best) {
        ctx.fillStyle = '#eb6236';
        ctx.fillRect(154, 235, 29, 12);
        label('NEW', 157, 238, '#fff', 1);
      }
    }
    if (phase === 'paused') {
      ctx.fillStyle = '#0006';
      ctx.fillRect(0, 0, 288, 400);
      label('PAUSED', 98, 180, '#fff');
    }
  };
}
