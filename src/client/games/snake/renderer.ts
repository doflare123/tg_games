import { SNAKE_DIRECTIONS, type SnakeState } from '../../../games/snake/engine.ts';

export function snakeRenderer(canvas: HTMLCanvasElement) {
  canvas.width = 768;
  canvas.height = 768;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas недоступен');
  const ctx = context;
  const ground = document.createElement('canvas');
  ground.width = ground.height = 768;
  let groundSize = 0;
  function grass(size: number) {
    const g = ground.getContext('2d');
    if (!g) return;
    const cell = 768 / size;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        g.fillStyle = (x + y) % 2 ? '#264933' : '#2b5038';
        g.fillRect(x * cell, y * cell, cell, cell);
        for (let i = 0; i < 5; i++) {
          const h = (x * 193 + y * 337 + i * 103) % 997;
          const px = x * cell + ((h % 89) / 89) * cell;
          const py = y * cell + ((h % 67) / 67) * cell;
          g.strokeStyle = i % 2 ? '#92b26a16' : '#132e232d';
          g.lineWidth = 1.3;
          g.beginPath();
          g.moveTo(px - 2, py + 2);
          g.lineTo(px, py - 3);
          g.lineTo(px + 2, py + 1);
          g.stroke();
        }
      }
    const vignette = g.createRadialGradient(384, 340, 140, 384, 384, 560);
    vignette.addColorStop(0, '#07150d00');
    vignette.addColorStop(1, '#07150d65');
    g.fillStyle = vignette;
    g.fillRect(0, 0, 768, 768);
    groundSize = size;
  }
  return (state: SnakeState, previous: readonly number[] = state.body, progress = 1, time = 0) => {
    if (groundSize !== state.size) grass(state.size);
    ctx.drawImage(ground, 0, 0);
    const cell = 768 / state.size;
    const point = (cellIndex: number) => ({
      x: ((cellIndex % state.size) + 0.5) * cell,
      y: (Math.floor(cellIndex / state.size) + 0.5) * cell,
    });
    if (state.food !== null) {
      const p = point(state.food);
      ctx.save();
      ctx.translate(p.x, p.y);
      const pulse = 1 + Math.sin(time / 300) * 0.035;
      ctx.scale((pulse * cell) / 40, (pulse * cell) / 40);
      ctx.shadowColor = '#0c211e80';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 4;
      const apple = ctx.createRadialGradient(-6, -6, 2, 0, 0, 18);
      apple.addColorStop(0, '#ffb07c');
      apple.addColorStop(0.35, '#f86c55');
      apple.addColorStop(1, '#b52e45');
      ctx.fillStyle = apple;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.bezierCurveTo(-19, -21, -24, 6, -10, 15);
      ctx.bezierCurveTo(-5, 19, -2, 14, 0, 15);
      ctx.bezierCurveTo(22, 23, 26, -22, 0, -10);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#ba8d61';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.quadraticCurveTo(-3, -17, 2, -20);
      ctx.stroke();
      ctx.fillStyle = '#b6df75';
      ctx.beginPath();
      ctx.ellipse(8, -16, 8, 3.5, -0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff5d785';
      ctx.beginPath();
      ctx.ellipse(-9, -4, 3, 5, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const points = state.body.map((v, i) => {
      const a = point(previous[i] ?? previous[previous.length - 1] ?? v);
      const b = point(v);
      return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
    });
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#081e16b0';
    ctx.shadowBlur = cell * 0.14;
    ctx.shadowOffsetY = cell * 0.12;
    ctx.strokeStyle = '#527f3c';
    ctx.lineWidth = cell * 0.76;
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    });
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      if (!p) continue;
      const radius = cell * (i === points.length - 1 ? 0.29 : 0.39);
      const shine = ctx.createRadialGradient(
        p.x - radius * 0.3,
        p.y - radius * 0.4,
        1,
        p.x,
        p.y,
        radius,
      );
      shine.addColorStop(0, i === 0 ? '#e4f6a0' : '#c1e981');
      shine.addColorStop(0.6, i === 0 ? '#aad65d' : '#92c25c');
      shine.addColorStop(1, '#5d943f');
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (i > 0) {
        ctx.strokeStyle = '#41763265';
        ctx.lineWidth = cell * 0.025;
        for (const offset of [-0.17, 0.1]) {
          ctx.beginPath();
          ctx.arc(p.x + cell * offset, p.y - cell * 0.06, cell * 0.13, 0.15, Math.PI - 0.15);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x + cell * offset, p.y + cell * 0.15, cell * 0.11, 0.15, Math.PI - 0.15);
          ctx.stroke();
        }
      }
    }
    const head = points[0];
    if (head) {
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(((SNAKE_DIRECTIONS.indexOf(state.direction) - 1) * Math.PI) / 2);
      for (const side of [-1, 1]) {
        ctx.fillStyle = '#f8f9d9';
        ctx.beginPath();
        ctx.ellipse(cell * 0.11, cell * 0.23 * side, cell * 0.16, cell * 0.13, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#18332b';
        ctx.beginPath();
        ctx.arc(cell * 0.17, cell * 0.23 * side, cell * 0.075, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cell * 0.19, cell * (0.23 * side - 0.025), cell * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#386338';
      ctx.lineWidth = cell * 0.025;
      ctx.beginPath();
      ctx.arc(cell * 0.13, 0, cell * 0.16, -0.7, 0.7);
      ctx.stroke();
      ctx.restore();
    }
  };
}
