export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

export function normalizeRectLike<T extends Rect>(rect: T): T {
  return {
    ...rect,
    ...rectFromPoints(
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height }
    ),
  }
}

export function shapeFromDrag<T extends Rect>(shape: T, start: Point, current: Point): T {
  return {
    ...shape,
    ...rectFromPoints(start, current),
  }
}
