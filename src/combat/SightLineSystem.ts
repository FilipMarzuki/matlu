import * as Phaser from 'phaser';

export interface SightPoint {
  x: number;
  y: number;
}

export const SIGHT_RADIUS = 250;

const RAY_COUNT = 120;
const TAU = Math.PI * 2;

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function obstacleRectangles(
  obstacles: Phaser.Physics.Arcade.StaticGroup,
): Phaser.Geom.Rectangle[] {
  const rects: Phaser.Geom.Rectangle[] = [];
  for (const child of obstacles.getChildren()) {
    const body = (child as Phaser.GameObjects.GameObject & {
      body?: Phaser.Physics.Arcade.StaticBody;
    }).body;
    if (!body) continue;
    rects.push(new Phaser.Geom.Rectangle(body.position.x, body.position.y, body.width, body.height));
  }
  return rects;
}

function rectangleSegments(rect: Phaser.Geom.Rectangle): Segment[] {
  const right = rect.right;
  const bottom = rect.bottom;
  return [
    { x1: rect.x, y1: rect.y, x2: right, y2: rect.y },
    { x1: right, y1: rect.y, x2: right, y2: bottom },
    { x1: right, y1: bottom, x2: rect.x, y2: bottom },
    { x1: rect.x, y1: bottom, x2: rect.x, y2: rect.y },
  ];
}

function raySegmentIntersectionDistance(
  origin: SightPoint,
  dirX: number,
  dirY: number,
  segment: Segment,
): number | null {
  const segX = segment.x2 - segment.x1;
  const segY = segment.y2 - segment.y1;

  const denom = (dirX * segY) - (dirY * segX);
  if (Math.abs(denom) < 1e-6) return null;

  const deltaX = segment.x1 - origin.x;
  const deltaY = segment.y1 - origin.y;

  const t = ((deltaX * segY) - (deltaY * segX)) / denom;
  const u = ((deltaX * dirY) - (deltaY * dirX)) / denom;

  if (t < 0 || u < 0 || u > 1) return null;
  return t;
}

export function hasLineOfSight(
  from: SightPoint,
  to: SightPoint,
  obstacles: Phaser.Physics.Arcade.StaticGroup,
): boolean {
  const ray = new Phaser.Geom.Line(from.x, from.y, to.x, to.y);

  for (const rect of obstacleRectangles(obstacles)) {
    if (Phaser.Geom.Intersects.LineToRectangle(ray, rect)) {
      return false;
    }
  }

  return true;
}

export function computeVisibilityPolygon(
  origin: SightPoint,
  radius: number,
  obstacles: Phaser.Physics.Arcade.StaticGroup,
): Phaser.Geom.Polygon {
  const points: Phaser.Types.Math.Vector2Like[] = [];
  const obstacleRects = obstacleRectangles(obstacles);

  for (let i = 0; i < RAY_COUNT; i++) {
    const angle = (i / RAY_COUNT) * TAU;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    let bestDistance = radius;
    for (const rect of obstacleRects) {
      for (const segment of rectangleSegments(rect)) {
        const hitDistance = raySegmentIntersectionDistance(origin, dirX, dirY, segment);
        if (hitDistance !== null && hitDistance < bestDistance) {
          bestDistance = hitDistance;
        }
      }
    }

    points.push({
      x: origin.x + dirX * bestDistance,
      y: origin.y + dirY * bestDistance,
    });
  }

  return new Phaser.Geom.Polygon(points);
}
