import type { PetPlacement, PetSurfaceId, PetSurfaceSlot } from '../../../shared/tamagotchi.ts';
import { element } from '../../ui/dom.ts';

const KENNEY = '/assets/tamagotchi/kenney/';
const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 800;
const HEIGHT = 720;

interface RoomSprite {
  file: string;
  width: number;
  floor?: boolean;
}

// Original PNG sizes share one scale, camera and light direction. Three small
// project-native SVGs cover catalogue objects missing from the furniture kit.
const FURNITURE: Readonly<Record<string, RoomSprite>> = {
  rug: { file: 'rugRound_SE.png', width: 161, floor: true },
  plant: { file: 'pottedPlant_SE.png', width: 34 },
  wardrobe: { file: 'bookcaseClosedDoors_SE.png', width: 80 },
  lamp: { file: 'lampRoundFloor_SE.png', width: 29 },
  bed: { file: 'bedDouble_SE.png', width: 190 },
  books: { file: 'bookcaseOpen_SE.png', width: 80 },
  sofa: { file: 'loungeSofa_SE.png', width: 169 },
  art: { file: '../wall-art.svg', width: 62 },
  fountain: { file: '../fountain.svg', width: 130 },
  swing: { file: '../swing.svg', width: 130 },
  'starter-rug': { file: 'rugRound_SE.png', width: 220, floor: true },
  'starter-chair': { file: 'loungeChair_SE.png', width: 110 },
  'starter-table': { file: 'tableCoffee_SE.png', width: 132 },
  'starter-console': { file: 'cabinetTelevision_SW.png', width: 131 },
  'starter-radio': { file: 'radio_SW.png', width: 49 },
  'starter-pot': { file: 'plantSmall1_SW.png', width: 23 },
  'starter-books': { file: 'books_SE.png', width: 32 },
  'starter-plant': { file: 'pottedPlant_SE.png', width: 34 },
};
const SURFACES: Record<
  PetSurfaceId,
  { width: number; height: number; anchors: readonly { x: number; y: number }[] }
> = {
  'starter-console': {
    width: 109,
    height: 110,
    anchors: [
      { x: 32, y: 26 },
      { x: 80, y: 51 },
    ],
  },
  'starter-table': {
    width: 110,
    height: 102,
    anchors: [
      { x: 39, y: 43 },
      { x: 78, y: 30 },
    ],
  },
  wardrobe: { width: 67, height: 137, anchors: [{ x: 34, y: 24 }] },
  books: { width: 67, height: 140, anchors: [{ x: 34, y: 31 }] },
};
function surfaceSprite(item: string, surface: PetSurfaceId) {
  const orientation = surface === 'starter-console' ? 'SW' : 'SE';
  switch (item) {
    case 'starter-radio':
      return {
        file: `radio_${orientation}.png`,
        width: 49,
        sourceWidth: 41,
        sourceHeight: orientation === 'SW' ? 51 : 50,
        contact: 0.75,
      };
    case 'starter-pot':
      return {
        file: `plantSmall1_${orientation}.png`,
        width: 23,
        sourceWidth: orientation === 'SW' ? 12 : 14,
        sourceHeight: orientation === 'SW' ? 19 : 18,
        contact: 0.86,
      };
    case 'starter-books':
      return {
        file: `books_${orientation}.png`,
        width: 32,
        sourceWidth: orientation === 'SW' ? 24 : 26,
        sourceHeight: orientation === 'SW' ? 28 : 27,
        contact: 0.84,
      };
    default:
      return {
        file: `lampRoundTable_${orientation}.png`,
        width: 29,
        sourceWidth: orientation === 'SW' ? 25 : 24,
        sourceHeight: 49,
        contact: 0.94,
      };
  }
}
function surfaceAnchor(surface: PetSurfaceId, slot: PetSurfaceSlot) {
  const config = SURFACES[surface];
  const point = config.anchors[slot] ?? config.anchors[0];
  if (!point) throw new Error('Surface requires an anchor');
  const width = FURNITURE[surface]?.width ?? 80;
  return {
    x: (point.x / config.width - 0.5) * width,
    y: ((point.y - config.height) / config.width) * width,
    width,
  };
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function project(u: number, v: number): { x: number; y: number } {
  return { x: 400 + (u - v) * 56, y: 184 + (u + v) * 37.5 };
}

export function livingItemImage(item: string, on?: PetSurfaceId): HTMLImageElement | undefined {
  const sprite = on ? surfaceSprite(item, on) : FURNITURE[item];
  if (!sprite) return undefined;
  const image = element('img', 'pet-room-sprite');
  image.src = KENNEY + sprite.file;
  image.alt = '';
  image.draggable = false;
  image.decoding = 'async';
  const surface = SURFACES[item as PetSurfaceId];
  if (surface) {
    image.width = surface.width;
    image.height = surface.height;
  }
  return image;
}

function locate(node: HTMLElement, x: number, y: number, width: number, depth = y): void {
  node.style.left = `${(x / WIDTH) * 100}%`;
  node.style.top = `${(y / HEIGHT) * 100}%`;
  node.style.bottom = 'auto';
  node.style.width = `${(width / WIDTH) * 100}%`;
  node.style.zIndex = String(Math.round(depth));
}

export function locateLivingFurniture(
  node: HTMLElement,
  placement: PetPlacement,
  all: readonly PetPlacement[],
): void {
  if (placement.on) {
    const parent = all.find((p) => p.item === placement.on);
    if (parent) {
      const point = project(parent.x + 0.5, 5 - parent.y * 2);
      const anchor = surfaceAnchor(placement.on, placement.slot ?? 0);
      const sprite = surfaceSprite(placement.item, placement.on);
      const contact =
        (sprite.width / sprite.sourceWidth) * sprite.sourceHeight * (1 - sprite.contact);
      locate(
        node,
        point.x + anchor.x,
        point.y + anchor.y + contact,
        sprite.width,
        point.y + 1 + (placement.slot ?? 0),
      );
      node.dataset.support = placement.on;
      node.dataset.surfaceSlot = String(placement.slot);
      return;
    }
  }
  const point = project(placement.x + 0.5, 5 - placement.y * 2);
  const sprite = FURNITURE[placement.item];
  locate(node, point.x, point.y, sprite?.width ?? 90, sprite?.floor ? 10 : point.y);
}
export function locateLivingSurface(
  node: HTMLElement,
  parent: PetPlacement & { item: PetSurfaceId },
  slot: PetSurfaceSlot,
): void {
  const point = project(parent.x + 0.5, 5 - parent.y * 2);
  const anchor = surfaceAnchor(parent.item, slot);
  node.style.left = `${((point.x + anchor.x) / WIDTH) * 100}%`;
  node.style.top = `${((point.y + anchor.y) / HEIGHT) * 100}%`;
}

// Other rooms still use the previous floor projection. Anchor accessories to
// the actual rendered parent image so its surface stays coherent there too.
export function layoutRoomSurfaces(scene: HTMLElement, all: readonly PetPlacement[]): void {
  const room = scene.getBoundingClientRect();
  const anchorFor = (surface: PetSurfaceId, slot: PetSurfaceSlot) => {
    const host = scene.querySelector<HTMLElement>(`[data-item="${surface}"]`);
    const rect = host?.getBoundingClientRect();
    if (!rect) return undefined;
    const anchor = surfaceAnchor(surface, slot);
    const scale = rect.width / anchor.width;
    return {
      x: rect.left + rect.width / 2 + anchor.x * scale - room.left,
      y: rect.bottom + anchor.y * scale - room.top,
      scale,
      depth: Number(host?.style.zIndex ?? 0) + 1 + slot,
    };
  };
  for (const placement of all) {
    if (!placement.on) continue;
    const node = scene.querySelector<HTMLElement>(`[data-item="${placement.item}"]`);
    const anchor = anchorFor(placement.on, placement.slot ?? 0);
    if (!node || !anchor) continue;
    const sprite = surfaceSprite(placement.item, placement.on);
    node.style.left = `${(anchor.x / room.width) * 100}%`;
    node.style.top = `${((anchor.y + (sprite.width / sprite.sourceWidth) * sprite.sourceHeight * (1 - sprite.contact) * anchor.scale) / room.height) * 100}%`;
    node.style.bottom = 'auto';
    node.style.width = `${((sprite.width * anchor.scale) / room.width) * 100}%`;
    node.style.zIndex = String(anchor.depth);
    node.dataset.support = placement.on;
    node.dataset.surfaceSlot = String(placement.slot);
  }
  for (const node of scene.querySelectorAll<HTMLElement>('.pet-surface-point')) {
    const surface = node.dataset.surfaceHost as PetSurfaceId;
    const slot = Number(node.dataset.slot) as PetSurfaceSlot;
    const anchor = anchorFor(surface, slot);
    if (!anchor) continue;
    node.style.left = `${(anchor.x / room.width) * 100}%`;
    node.style.top = `${(anchor.y / room.height) * 100}%`;
  }
}

export function locateLivingPet(node: HTMLElement): void {
  const point = project(3.8, 3.6);
  locate(node, point.x, point.y, 155);
}

export function locateLivingCell(node: HTMLElement, x: number, y: number): void {
  const point = project(x, 4 - y * 2);
  node.style.left = `${((point.x - 112) / WIDTH) * 100}%`;
  node.style.top = `${(point.y / HEIGHT) * 100}%`;
}

export function livingRoom(): HTMLElement {
  const world = element('div', 'pet-iso-world');
  const shell = svg('svg', {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    'aria-hidden': 'true',
    class: 'pet-iso-shell',
  });
  const defs = svg('defs', {});
  const shadow = svg('filter', {
    id: 'pet-room-shadow',
    x: '-30%',
    y: '-60%',
    width: '160%',
    height: '220%',
  });
  shadow.append(svg('feGaussianBlur', { stdDeviation: '10' }));
  defs.append(shadow);
  shell.append(defs);
  shell.append(
    svg('ellipse', {
      cx: '400',
      cy: '478',
      rx: '317',
      ry: '142',
      fill: '#635a46',
      opacity: '.12',
      filter: 'url(#pet-room-shadow)',
    }),
    svg('polygon', { points: '64,409 400,634 736,409 736,421 400,648 64,421', fill: '#be9061' }),
    svg('polygon', { points: '400,34 64,259 64,409 400,184', fill: 'var(--iso-wall-left)' }),
    svg('polygon', { points: '400,34 736,259 736,409 400,184', fill: 'var(--iso-wall-right)' }),
    svg('path', {
      d: 'M64 259 400 34 736 259',
      fill: 'none',
      stroke: '#fffaf0',
      'stroke-width': '8',
      'stroke-linejoin': 'round',
    }),
  );
  // The window lives in the wall plane, rather than floating above the floor.
  const window = svg('g', { transform: 'matrix(1 -.669643 0 1 64 409)' });
  window.append(
    svg('rect', { x: '93', y: '-136', width: '111', height: '102', rx: '3', fill: '#c9baa0' }),
    svg('rect', { x: '100', y: '-130', width: '97', height: '90', fill: '#fffaf0' }),
    svg('rect', { x: '106', y: '-124', width: '85', height: '77', fill: '#b7d1ce' }),
    svg('path', { d: 'M106 -69 Q130 -95 149 -72 T191 -82 V-47 H106Z', fill: '#94b49b' }),
    svg('path', { d: 'M148 -124 V-47 M106 -85 H191', stroke: '#fffaf0', 'stroke-width': '5' }),
    svg('path', {
      d: 'M96 -36 H207',
      stroke: '#e4c6a0',
      'stroke-width': '9',
      'stroke-linecap': 'round',
    }),
  );
  shell.append(window);
  const picture = svg('g', { transform: 'matrix(1 .669643 0 1 400 184)' });
  picture.append(
    svg('rect', { x: '202', y: '-127', width: '61', height: '76', rx: '2', fill: '#b38a65' }),
    svg('rect', { x: '208', y: '-121', width: '49', height: '64', fill: '#f8efd9' }),
    svg('circle', { cx: '232', cy: '-99', r: '12', fill: '#d6aa72' }),
    svg('path', { d: 'M212 -61 229 -85 244 -69 253 -79 V-61Z', fill: '#8a9d83' }),
  );
  shell.append(picture);
  // The PNG floor uses exactly the same projection as the furniture sprites.
  for (let v = 0; v < 6; v++)
    for (let u = 0; u < 6; u++) {
      const point = project(u, v);
      shell.append(
        svg('image', {
          href: `${KENNEY}floorFull_SE.png`,
          x: String(point.x - 56.2),
          y: String(point.y - 0.2),
          width: '112.4',
          height: '82.14',
        }),
      );
    }
  shell.append(
    svg('path', {
      d: 'M64 406 400 181 736 406',
      fill: 'none',
      stroke: '#fff2d8',
      'stroke-width': '5',
    }),
  );
  world.append(shell);
  return world;
}
