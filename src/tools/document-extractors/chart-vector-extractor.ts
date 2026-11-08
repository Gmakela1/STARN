/**
 * chart-vector-extractor.ts — PDF chart reading, spec §6 stages 0-4.
 *
 * Purpose: turn pdfjs drawing operators into calibrated, sampled series.
 * - Stage 0 `walkOperatorList` replays an operator list into DrawingPath[] (pdfjs).
 * - Stages 1-4 (`classifyPaths`, `calibrateAxes`, `clusterSeries`, `sampleSeries`)
 *   are pure functions over plain data: no pdfjs import is executed for them.
 *
 * Coordinate convention: page space, PDF units, y-up.
 */
import type {
  AxisCalibration,
  AxisMap,
  BBox,
  DrawingPath,
  PathStyle,
  Point,
  SeriesCluster,
  SeriesSamples,
  TextItemLike,
} from './chart-types.js';

// ---------------------------------------------------------------------------
// Stage 0 — operator-list walk
// ---------------------------------------------------------------------------

/** Opcode name → number, matching pdfjs `OPS`. */
export type OpsMap = Record<string, number>;

/**
 * pdfjs-dist v6 `OPS` values. Used as the default so the walker runs without a
 * pdfjs import; `loadPdfOps()` supplies the real map for live PDFs.
 */
export const DEFAULT_OPS: OpsMap = {
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 2,
  setDash: 6,
  setLineDash: 6,
  setStrokeGray: 56,
  setStrokeRGBColor: 58,
  setStrokeCMYKColor: 60,
  constructPath: 91,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
};

/** Drawing data of one page: paths plus the text items needed by stage 2. */
export interface PageDrawing {
  paths: DrawingPath[];
  textItems: TextItemLike[];
}

/** DrawOPS stream codes inside `OPS.constructPath`. */
const DRAW_MOVE = 0;
const DRAW_LINE = 1;
const DRAW_CURVE = 2;
const DRAW_QUAD = 3;
const DRAW_CLOSE = 4;

/** Steps used to flatten one cubic segment (spec §6 stage 4). */
const CURVE_STEPS = 10;
/** Page-unit tolerance for "axis-aligned". */
const AXIS_EPS = 0.5;

type Matrix = [number, number, number, number, number, number];

let pdfOpsCache: OpsMap | null = null;

/**
 * Loads pdfjs `OPS` lazily, the same way `pdf-extractor.ts` loads pdfjs.
 * @returns The pdfjs opcode map.
 * @throws When pdfjs-dist cannot be imported.
 */
export async function loadPdfOps(): Promise<OpsMap> {
  if (!pdfOpsCache) {
    const lib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfOpsCache = lib.OPS as OpsMap;
  }
  return pdfOpsCache;
}

/**
 * Stage 0 for a live pdfjs page: operator list → paths + text items.
 * @param page A pdfjs `PDFPageProxy`.
 * @returns Paths in page space and text items with their transforms.
 * @throws When pdfjs page access fails.
 */
export async function collectDrawing(page: any): Promise<PageDrawing> {
  const ops = await loadPdfOps();
  const opList = await page.getOperatorList();
  const content = await page.getTextContent();
  const textItems: TextItemLike[] = content.items.map((item: any) => ({
    str: item.str ?? '',
    x: item.transform?.[4] ?? 0,
    y: item.transform?.[5] ?? 0,
    width: item.width ?? 0,
    height: item.height ?? 0,
  }));
  return { paths: walkOperatorList(opList.fnArray, opList.argsArray, textItems, ops), textItems };
}

/** @returns The painted path points, one array per subpath. */
function decodeSubpaths(buffer: ArrayLike<number>, ctm: Matrix): { points: Point[]; closed: boolean }[] {
  const subpaths: { points: Point[]; closed: boolean }[] = [];
  let points: Point[] = [];
  let closed = false;
  const flush = (): void => {
    if (points.length > 0) subpaths.push({ points, closed });
    points = [];
    closed = false;
  };

  for (let i = 0; i < buffer.length; ) {
    const code = buffer[i++];
    if (code === DRAW_MOVE) {
      flush();
      points.push(applyMatrix(ctm, buffer[i], buffer[i + 1]));
      i += 2;
    } else if (code === DRAW_LINE) {
      const p = applyMatrix(ctm, buffer[i], buffer[i + 1]);
      i += 2;
      if (points.length > 0) points.push(p);
    } else if (code === DRAW_CURVE) {
      const p1 = applyMatrix(ctm, buffer[i], buffer[i + 1]);
      const p2 = applyMatrix(ctm, buffer[i + 2], buffer[i + 3]);
      const p3 = applyMatrix(ctm, buffer[i + 4], buffer[i + 5]);
      i += 6;
      if (points.length > 0) flattenCubic(points[points.length - 1], p1, p2, p3, points);
    } else if (code === DRAW_QUAD) {
      const q = applyMatrix(ctm, buffer[i], buffer[i + 1]);
      const p3 = applyMatrix(ctm, buffer[i + 2], buffer[i + 3]);
      i += 4;
      if (points.length > 0) {
        const p0 = points[points.length - 1];
        const p1 = { x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) };
        const p2 = { x: p3.x + (2 / 3) * (q.x - p3.x), y: p3.y + (2 / 3) * (q.y - p3.y) };
        flattenCubic(p0, p1, p2, p3, points);
      }
    } else if (code === DRAW_CLOSE) {
      closed = true;
    } else {
      break; // unknown token: stop decoding this buffer
    }
  }
  flush();
  return subpaths;
}

/** Appends `CURVE_STEPS` interpolated points (t>0) of one cubic to `out`. */
function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point, out: Point[]): void {
  for (let s = 1; s <= CURVE_STEPS; s++) {
    const t = s / CURVE_STEPS;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    });
  }
}

function applyMatrix(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** CTM' = new × current, per PDF `cm`. */
function multiplyMatrix(n: ArrayLike<number>, m: Matrix): Matrix {
  const [a, b, c, d, e, f] = [n[0], n[1], n[2], n[3], n[4], n[5]];
  return [
    a * m[0] + c * m[1],
    b * m[0] + d * m[1],
    a * m[2] + c * m[3],
    b * m[2] + d * m[3],
    a * m[4] + c * m[5] + e,
    b * m[4] + d * m[5] + f,
  ];
}

function bboxOf(points: Point[]): BBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/** Paint opcodes that actually stroke; anything else paints fill only and is skipped. */
function strokePaintOps(ops: OpsMap): Set<number> {
  const set = new Set<number>();
  for (const name of ['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']) {
    const value = ops[name];
    if (typeof value === 'number') set.add(value);
  }
  return set;
}

function colourFromGray(args: unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (typeof first === 'number') {
    const hex = Math.round(Math.min(1, Math.max(0, first)) * 255)
      .toString(16)
      .padStart(2, '0');
    return `#${hex}${hex}${hex}`;
  }
  return undefined;
}

function colourFromCmyk(args: unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === 'string') return first;
  const parts = args.slice(0, 4).map((v) => (typeof v === 'number' ? v : 0));
  if (parts.length < 4) return undefined;
  const [c, m, y, k] = parts;
  const hex = [c, m, y]
    .map((v) => Math.round(Math.min(1, Math.max(0, 1 - Math.min(1, v + k))) * 255).toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

function dashFromArgs(args: unknown[]): number[] | undefined {
  const first = args[0];
  if (Array.isArray(first)) return first.filter((v): v is number => typeof v === 'number');
  if (Array.isArray(args) && args.every((v) => typeof v === 'number')) return args as number[];
  return undefined;
}

/** `OPS.constructPath` args are `[paintOp, buffer, minMax]`; buffer may be nested. */
function constructPathBuffer(args: unknown[]): ArrayLike<number> | null {
  const raw = args[1] as any;
  if (!raw) return null;
  if (typeof raw.length === 'number' && typeof raw[0] === 'number') return raw as ArrayLike<number>;
  if (raw.length > 0 && raw[0] && typeof raw[0].length === 'number') return raw[0] as ArrayLike<number>;
  return null;
}

/**
 * Stage 0. Replays a pdfjs operator list into drawing paths.
 *
 * CTM stack: `save`/`restore`/`transform`. Style replay: stroke colour, dash,
 * line width. `constructPath` is decoded from its DrawOPS buffer; curves are
 * flattened at 10 steps and every moveTo starts a new DrawingPath. Fill-only
 * paint ops are skipped because they carry no stroke geometry.
 *
 * @param fnArray pdfjs `opList.fnArray`.
 * @param argsArray pdfjs `opList.argsArray`; `argsArray[i]` is the arg array of op i.
 * @param textItems Accepted for stage-0 symmetry with `collectDrawing`; the walk reads geometry only.
 * @param ops Opcode map; defaults to {@link DEFAULT_OPS} so tests need no pdfjs.
 * @returns One DrawingPath per subpath, in paint order, with style and bbox.
 */
export function walkOperatorList(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  textItems: TextItemLike[] = [],
  ops: OpsMap = DEFAULT_OPS,
): DrawingPath[] {
  void textItems;
  const stroking = strokePaintOps(ops);
  const dashOp = ops.setLineDash ?? ops.setDash;
  const paths: DrawingPath[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let style: PathStyle = { dash: [], lineWidth: 1 };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = ((argsArray[i] as unknown[]) ?? []) as unknown[];

    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === ops.transform) {
      ctm = multiplyMatrix(args as ArrayLike<number>, ctm);
    } else if (fn === ops.setLineWidth) {
      const width = args[0];
      if (typeof width === 'number') style = { ...style, lineWidth: width };
    } else if (dashOp !== undefined && fn === dashOp) {
      const dash = dashFromArgs(args);
      if (dash) style = { ...style, dash };
    } else if (fn === ops.setStrokeRGBColor) {
      const stroke = typeof args[0] === 'string' ? (args[0] as string) : undefined;
      if (stroke) style = { ...style, stroke };
    } else if (fn === ops.setStrokeGray) {
      const stroke = colourFromGray(args);
      if (stroke) style = { ...style, stroke };
    } else if (fn === ops.setStrokeCMYKColor) {
      const stroke = colourFromCmyk(args);
      if (stroke) style = { ...style, stroke };
    } else if (fn === ops.constructPath) {
      const paintOp = args[0];
      const buffer = constructPathBuffer(args);
      if (!buffer || typeof paintOp !== 'number' || !stroking.has(paintOp)) continue;
      for (const subpath of decodeSubpaths(buffer, ctm)) {
        paths.push({
          points: subpath.points,
          closed: subpath.closed,
          style: { ...style, dash: style.dash ? [...style.dash] : [] },
          bbox: bboxOf(subpath.points),
        });
      }
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Stage 1 — classify
// ---------------------------------------------------------------------------

export interface PathClassification {
  ticks: DrawingPath[];
  frame: DrawingPath[];
  data: DrawingPath[];
}

/** @returns Union bbox of the paths, or null when there are none. */
export function pathsBounds(paths: DrawingPath[]): BBox | null {
  if (paths.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of paths) {
    if (p.bbox.x0 < x0) x0 = p.bbox.x0;
    if (p.bbox.y0 < y0) y0 = p.bbox.y0;
    if (p.bbox.x1 > x1) x1 = p.bbox.x1;
    if (p.bbox.y1 > y1) y1 = p.bbox.y1;
  }
  return { x0, y0, x1, y1 };
}

function axisAlignedSegments(path: DrawingPath): number {
  let count = 0;
  for (let i = 1; i < path.points.length; i++) {
    const dx = Math.abs(path.points[i].x - path.points[i - 1].x);
    const dy = Math.abs(path.points[i].y - path.points[i - 1].y);
    if (dx <= AXIS_EPS || dy <= AXIS_EPS) count++;
  }
  return count;
}

/**
 * Stage 1. Splits paths into axis furniture and plotted data.
 *
 * - tick: short dimension < 6 pt and both dimensions < 6 % of plot width.
 * - frame: span > 15 % of plot width with 1-2 axis-aligned segments.
 * - data: everything else with ≥ 3 points.
 *
 * @param paths Paths from stage 0.
 * @param plotBox Plot extent in page space (frame bbox, or the page's path bbox).
 * @returns Paths grouped by class; unclassified paths are dropped.
 */
export function classifyPaths(paths: DrawingPath[], plotBox: BBox): PathClassification {
  const plotWidth = Math.max(plotBox.x1 - plotBox.x0, 1);
  const result: PathClassification = { ticks: [], frame: [], data: [] };

  for (const path of paths) {
    const width = path.bbox.x1 - path.bbox.x0;
    const height = path.bbox.y1 - path.bbox.y0;
    const shortDim = Math.min(width, height);
    const span = Math.max(width, height);

    // A tick is small in both dimensions; an axis line spanning the plot has a
    // long span and must not be read as a tick.
    if (shortDim < 6 && shortDim < 0.06 * plotWidth && span < 0.06 * plotWidth) {
      result.ticks.push(path);
      continue;
    }
    const aligned = axisAlignedSegments(path);
    if (span > 0.15 * plotWidth && aligned >= 1 && aligned <= 2) {
      result.frame.push(path);
      continue;
    }
    if (path.points.length >= 3) result.data.push(path);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Stage 2 — calibrate
// ---------------------------------------------------------------------------

interface Anchor {
  coord: number;
  value: number;
}

const NUMBER_PREFIX = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

/** @returns The leading numeric token of a label, or null. Thousands separators are dropped. */
function parseLeadingNumber(str: string): number | null {
  const cleaned = str.replace(/[,\u00a0\u2009]/g, '').trim();
  const match = cleaned.match(NUMBER_PREFIX);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function dedupeByCoord(anchors: Anchor[]): Anchor[] {
  const seen = new Map<string, Anchor>();
  for (const anchor of anchors) {
    const key = anchor.coord.toFixed(2);
    if (!seen.has(key)) seen.set(key, anchor);
  }
  return [...seen.values()];
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** @returns Least-squares `y = a*x + b`, or null when all x are equal. */
function leastSquares(xs: number[], ys: number[]): { a: number; b: number } | null {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (!(den > 0)) return null;
  const a = num / den;
  return { a, b: my - a * mx };
}

/** Log axis when ≥ 3 positive anchors step by a constant ratio other than 1. */
function isGeometric(sorted: Anchor[]): boolean {
  if (sorted.length < 3) return false;
  if (sorted.some((a) => a.value <= 0)) return false;
  const ratios: number[] = [];
  for (let i = 1; i < sorted.length; i++) ratios.push(sorted[i].value / sorted[i - 1].value);
  const first = ratios[0];
  if (!Number.isFinite(first) || Math.abs(first - 1) < 1e-9) return false;
  return ratios.every((r) => Math.abs(r - first) <= 0.03 * Math.abs(first));
}

interface FitResult {
  map?: AxisMap;
  error?: string;
}

function fitAxis(anchors: Anchor[], axis: 'x' | 'y', label: string, side?: 'left' | 'right'): FitResult {
  const unique = dedupeByCoord(anchors);
  if (unique.length < 2) {
    return { error: `fewer than 2 anchors on the ${label} axis (found ${unique.length})` };
  }
  const sorted = [...unique].sort((a, b) => a.coord - b.coord);
  const increasing = sorted.every((a, i) => i === 0 || a.value > sorted[i - 1].value);
  const decreasing = sorted.every((a, i) => i === 0 || a.value < sorted[i - 1].value);
  if (!increasing && !decreasing) {
    return { error: `non-monotonic ${label} axis labels: values do not increase or decrease with position` };
  }
  const valueMin = Math.min(...sorted.map((a) => a.value));
  const valueMax = Math.max(...sorted.map((a) => a.value));
  if (!(valueMax - valueMin > 0)) {
    return { error: `zero ${label} axis span: every anchor reads ${valueMin}` };
  }
  const log = isGeometric(sorted);
  const ys = sorted.map((a) => (log ? Math.log10(a.value) : a.value));
  const fit = leastSquares(
    sorted.map((a) => a.coord),
    ys,
  );
  if (!fit) {
    return { error: `zero ${label} axis span: all anchors share one coordinate` };
  }
  return {
    map: {
      axis,
      side,
      a: fit.a,
      b: fit.b,
      log,
      coordMin: sorted[0].coord,
      coordMax: sorted[sorted.length - 1].coord,
      valueMin,
      valueMax,
      anchors: sorted.length,
    },
  };
}

function describeRange(map: AxisMap): string {
  return `${map.valueMin}–${map.valueMax}`;
}

/**
 * Stage 2. Fits axis maps from numeric tick labels around the plot frame.
 *
 * Labels below the plot are x anchors; labels left of it are left-y anchors;
 * labels right of it are right-y anchors. Two anchors per axis define the map;
 * log axes are fitted in log10 space. Ambiguity is refused, never guessed.
 *
 * @param textItems Page text items.
 * @param framePaths Frame paths from stage 1 (defines the plot box).
 * @param dataPaths Data paths, used as plot box only when no frame exists.
 * @returns `{ ok: true, xAxis, yAxes }`, or `{ ok: false, reason }` with the refusal.
 */
export function calibrateAxes(
  textItems: TextItemLike[],
  framePaths: DrawingPath[],
  dataPaths: DrawingPath[],
): AxisCalibration {
  const plotBox = pathsBounds(framePaths) ?? pathsBounds(dataPaths);
  if (!plotBox) return { ok: false, reason: 'no drawing paths to calibrate against' };

  const xAnchors: Anchor[] = [];
  const leftAnchors: Anchor[] = [];
  const rightAnchors: Anchor[] = [];

  for (const item of textItems) {
    const value = parseLeadingNumber(item.str);
    if (value === null) continue;
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const withinX = cx >= plotBox.x0 - 2 && cx <= plotBox.x1 + 2;
    const withinY = cy >= plotBox.y0 - 2 && cy <= plotBox.y1 + 2;

    if (cy < plotBox.y0 + 1 && withinX) {
      xAnchors.push({ coord: cx, value });
    } else if (cx < plotBox.x0 + 1 && withinY) {
      leftAnchors.push({ coord: cy, value });
    } else if (cx > plotBox.x1 - 1 && withinY) {
      rightAnchors.push({ coord: cy, value });
    }
  }

  const xFit = fitAxis(xAnchors, 'x', 'x');
  if (!xFit.map) return { ok: false, reason: xFit.error ?? 'x axis not calibratable' };

  const leftFit = fitAxis(leftAnchors, 'y', 'left y', 'left');
  const rightFit = fitAxis(rightAnchors, 'y', 'right y', 'right');

  if (leftFit.map && rightFit.map) {
    return {
      ok: false,
      reason:
        `ambiguous y-axes: left labels (${describeRange(leftFit.map)}) and right labels ` +
        `(${describeRange(rightFit.map)}) both have ≥2 anchors; a series→axis mapping is required`,
    };
  }
  const yMap = leftFit.map ?? rightFit.map;
  if (!yMap) {
    // Report the side with more evidence; that is the axis the reader expected.
    const preferred = leftAnchors.length >= rightAnchors.length ? leftFit : rightFit;
    return { ok: false, reason: preferred.error ?? 'y axis not calibratable' };
  }
  return { ok: true, xAxis: xFit.map, yAxes: [yMap] };
}

/** @returns The data value at a page coordinate under an axis map. */
export function axisToValue(map: AxisMap, coord: number): number {
  const t = map.a * coord + map.b;
  return map.log ? 10 ** t : t;
}

// ---------------------------------------------------------------------------
// Stage 3 — cluster
// ---------------------------------------------------------------------------

function styleKey(style: PathStyle): string {
  const stroke = style.stroke ?? 'none';
  const dash = style.dash && style.dash.length > 0 ? style.dash.join(',') : 'solid';
  const lineWidth = style.lineWidth === undefined ? '?' : String(style.lineWidth);
  return `${stroke}|${dash}|${lineWidth}`;
}

/**
 * Stage 3. Groups data paths into series.
 *
 * Paths sharing stroke colour + dash + line width are merged when x-continuous
 * (gap ≤ 2 % of plot width). Legend swatches (bbox < 6 pt high and < 40 pt wide)
 * are dropped. A cluster needs ≥ 3 points and an x-span ≥ 5 % of plot width.
 *
 * @param dataPaths Paths from stage 1's `data` class; stage 0 already split at moveTo.
 * @param plotBox Plot extent in page space.
 * @returns Clusters ordered by first appearance of their style key.
 */
export function clusterSeries(dataPaths: DrawingPath[], plotBox: BBox): SeriesCluster[] {
  const plotWidth = Math.max(plotBox.x1 - plotBox.x0, 1);
  const gapLimit = 0.02 * plotWidth;
  const minSpan = 0.05 * plotWidth;

  const byKey = new Map<string, { path: DrawingPath; index: number }[]>();
  for (let i = 0; i < dataPaths.length; i++) {
    const path = dataPaths[i];
    const width = path.bbox.x1 - path.bbox.x0;
    const height = path.bbox.y1 - path.bbox.y0;
    if (height < 6 && width < 40) continue;
    const key = styleKey(path.style);
    const group = byKey.get(key);
    if (group) group.push({ path, index: i });
    else byKey.set(key, [{ path, index: i }]);
  }

  const clusters: SeriesCluster[] = [];
  for (const [key, entries] of byKey) {
    entries.sort((a, b) => a.path.bbox.x0 - b.path.bbox.x0);
    let points: Point[] = [];
    let pathIds: number[] = [];
    let style: PathStyle = entries[0].path.style;
    let chainMaxX = -Infinity;

    const flush = (): void => {
      if (points.length < 3) return;
      const sorted = [...points].sort((a, b) => a.x - b.x);
      const span = sorted[sorted.length - 1].x - sorted[0].x;
      if (span >= minSpan) clusters.push({ key, points: sorted, style, pathIds });
    };

    for (const entry of entries) {
      if (points.length > 0 && entry.path.bbox.x0 - chainMaxX <= gapLimit) {
        points = points.concat(entry.path.points);
        pathIds.push(entry.index);
        chainMaxX = Math.max(chainMaxX, entry.path.bbox.x1);
      } else {
        flush();
        points = [...entry.path.points];
        pathIds = [entry.index];
        style = entry.path.style;
        chainMaxX = entry.path.bbox.x1;
      }
    }
    flush();
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Stage 4 — sample
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round4(value: number): number {
  const rounded = Number(value.toPrecision(4));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Inserts interpolated points so no step exceeds `stepX` in x. Stage 0 already
 * flattened curves at 10 steps; this guarantees enough points per sample bin.
 */
function densify(points: Point[], stepX: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (i > 0) {
      const prev = points[i - 1];
      const dx = point.x - prev.x;
      const dy = point.y - prev.y;
      const steps = Math.min(64, Math.max(1, Math.ceil(Math.abs(dx) / stepX)));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push({ x: prev.x + dx * t, y: prev.y + dy * t });
      }
    }
    out.push(point);
  }
  return out;
}

/**
 * Stage 4. Samples every cluster onto a shared x grid.
 *
 * Bins span the calibrated x-axis range. Each bin contributes the median y of
 * its points (robust to overlapping strokes), mapped to data units and rounded
 * to 4 significant figures. Rows are ascending in x.
 *
 * @param clusters Clusters from stage 3.
 * @param calibration A successful stage-2 calibration.
 * @param maxSamples Bin count, default 40, clamped to 1..200.
 * @returns One entry per cluster that produced samples; empty when uncalibrated.
 */
export function sampleSeries(
  clusters: SeriesCluster[],
  calibration: AxisCalibration,
  maxSamples = 40,
): SeriesSamples[] {
  const xAxis = calibration.xAxis;
  const yAxis = calibration.yAxes?.[0];
  if (!calibration.ok || !xAxis || !yAxis) return [];

  const bins = Math.min(200, Math.max(1, Math.round(maxSamples)));
  const x0 = xAxis.coordMin;
  const binWidth = (xAxis.coordMax - x0) / bins;
  if (!(binWidth > 0)) return [];
  const axis: 'left' | 'right' = yAxis.side === 'right' ? 'right' : 'left';

  const result: SeriesSamples[] = [];
  for (const cluster of clusters) {
    const buckets: number[][] = Array.from({ length: bins }, () => []);
    for (const point of densify(cluster.points, binWidth / 4)) {
      const index = Math.floor((point.x - x0) / binWidth);
      if (index >= 0 && index < bins) buckets[index].push(point.y);
    }
    const samples: { x: number; y: number }[] = [];
    for (let i = 0; i < bins; i++) {
      if (buckets[i].length === 0) continue;
      const center = x0 + (i + 0.5) * binWidth;
      samples.push({
        x: round4(axisToValue(xAxis, center)),
        y: round4(axisToValue(yAxis, median(buckets[i]))),
      });
    }
    if (samples.length > 0) result.push({ series: cluster.key, axis, samples });
  }
  return result;
}
