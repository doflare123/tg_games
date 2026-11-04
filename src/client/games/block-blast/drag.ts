export interface DragPoint {
  x: number;
  y: number;
}

export interface BlockDragGeometry {
  width: number;
  height: number;
  cellSize: number;
}

/** Viewport origin of the held piece. No easing or accumulated deltas: reversing
 * a gesture returns to exactly the same position, without drift or input lag.
 */
export function blockDragOrigin(
  start: DragPoint,
  pointer: DragPoint,
  shape: BlockDragGeometry,
  touch: boolean,
): DragPoint {
  if (!touch) return { x: pointer.x - shape.width / 2, y: pointer.y - shape.height / 2 };
  const lift = Math.max(40, Math.min(64, shape.cellSize * 1.1));
  const upwardTravel = Math.max(0, start.y - pointer.y);
  const extraLift = Math.min(upwardTravel * 0.5, shape.cellSize * 3);
  return {
    x: start.x + (pointer.x - start.x) * 1.2 - shape.width / 2,
    y: pointer.y - shape.height - lift - extraLift,
  };
}
