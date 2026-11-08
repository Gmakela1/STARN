/**
 * chart-vector-extractor.ts — PDF chart reading, spec §6 stages 0-4.
 *
 * Purpose: turn pdfjs drawing operators into calibrated, sampled series.
 * - Stage 0 `walkOperatorList` replays an operator list into DrawingPath[] (pdfjs).
 * - Stages 1-4 (`classifyPaths`, `calibrateAxes`, `clusterSeries`, `sampleSeries`)
 *   are pure functions over plain data: no pdfjs import is executed for them.
 *
 * Coordinate conventions: page space is unrotated PDF space, units pt, y-up.
 * Stages 1-4 run in chart space — page space with the page rotation applied,
 * still y-up — so a `/Rotate 90` sheet calibrates like an upright one. Stage 0
 * keeps both; the legend rule reads page space, because a legend layout is a
 * page artefact (its row of keys turns into a column when the page rotates).
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  AxisCalibration,
  AxisDecl,
  AxisMap,
  BBox,
  ChartExtraction,
  ChartExtractionOptions,
  ChartSeries,
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
  /** Paths in page space (unrotated, y up). The legend rule reads these. */
  paths: DrawingPath[];
  /** Text items in page space. */
  textItems: TextItemLike[];
  /** Paths in chart space (page rotation applied, y up): stages 1-4 geometry. */
  chartPaths: DrawingPath[];
  /** Text items in chart space: the axis calibration anchors. */
  chartTextItems: TextItemLike[];
  /** Page extent from pdfjs `page.view`, in page space. */
  pageBox: BBox;
  /** Page extent in chart space. */
  chartBox: BBox;
  /** Chart-space box around the legend swatch row; null when the page has no row. */
  chartLegendBand: BBox | null;
  /** `constructPath` ops replayed (before any cap); 0 for hand-built fixtures. */
  constructPathOps: number;
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
 * @param maxConstructPaths Optional replay cap; the operator list is truncated at
 *   the N-th `constructPath` so a pathological page cannot blow the probe budget.
 * @returns Paths in page space and text items with their transforms.
 * @throws When pdfjs page access fails.
 */
export async function collectDrawing(page: any, maxConstructPaths = Infinity): Promise<PageDrawing> {
  const ops = await loadPdfOps();
  const opList = await page.getOperatorList();
  const content = await page.getTextContent();
  const bounds = truncateAtConstructPaths(opList.fnArray, opList.argsArray, ops, maxConstructPaths);
  const view = Array.isArray(page.view) && page.view.length === 4 ? page.view : [0, 0, 0, 0];
  const viewport = page.getViewport({ scale: 1 });
  const chartMatrix = chartSpaceMatrix(viewport.transform, viewport.height);
  const textItems: TextItemLike[] = content.items.map((item: any) => ({
    str: item.str ?? '',
    x: item.transform?.[4] ?? 0,
    y: item.transform?.[5] ?? 0,
    width: item.width ?? 0,
    height: item.height ?? 0,
  }));
  const paths = walkOperatorList(opList.fnArray, opList.argsArray, textItems, ops, bounds.end);
  const pageBox = { x0: view[0], y0: view[1], x1: view[2], y1: view[3] };
  const band = legendBand(paths);
  return {
    paths,
    textItems,
    chartPaths: paths.map((path) => transformPath(path, chartMatrix)),
    chartTextItems: textItems.map((item) => transformTextItem(item, chartMatrix)),
    pageBox,
    chartBox: transformBox(pageBox, chartMatrix),
    chartLegendBand: band ? transformBox(bandBox(band, pageBox), chartMatrix) : null,
    constructPathOps: bounds.count,
  };
}

/**
 * Finds where an operator list must stop so that at most `limit` `constructPath`
 * ops are replayed.
 * @returns `count` = observed constructPath ops (capped), `end` = slice end index.
 */
function truncateAtConstructPaths(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: OpsMap,
  limit: number,
): { count: number; end: number } {
  void argsArray;
  let count = 0;
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] !== ops.constructPath) continue;
    count++;
    if (count >= limit) return { count, end: i + 1 };
  }
  return { count, end: fnArray.length };
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

/**
 * Builds the page→chart-space matrix from a pdfjs viewport.
 *
 * Page space is unrotated and y-up; chart space is y-up with the page rotation
 * applied, so stages 1-4 always see x to the right and y up. Convention:
 * `x' = a*x + c*y + e`, `y' = b*x + d*y + f` (see `applyMatrix`).
 *
 * @param transform pdfjs viewport transform (page → rendered, y down).
 * @param renderedHeight Viewport height in points.
 * @returns The page→chart-space matrix; identity for an unrotated page.
 */
export function chartSpaceMatrix(transform: ArrayLike<number>, renderedHeight: number): Matrix {
  const [a, b, c, d, e, f] = [transform[0], transform[1], transform[2], transform[3], transform[4], transform[5]];
  const negate = (value: number): number => (value === 0 ? 0 : -value);
  return [a, negate(b), c, negate(d), e, renderedHeight - f];
}

/** @returns `path` mapped through `m`: every point and the bbox. */
function transformPath(path: DrawingPath, m: Matrix): DrawingPath {
  const points = path.points.map((point) => applyMatrix(m, point.x, point.y));
  return { ...path, points, bbox: bboxOf(points) };
}

/** @returns `item` with its baseline origin mapped through `m`; rotation leaves width and height unchanged. */
function transformTextItem(item: TextItemLike, m: Matrix): TextItemLike {
  const origin = applyMatrix(m, item.x, item.y);
  return { ...item, x: origin.x, y: origin.y };
}

/** @returns The bbox of a box mapped through `m`, taken over its four corners. */
function transformBox(box: BBox, m: Matrix): BBox {
  return bboxOf([
    applyMatrix(m, box.x0, box.y0),
    applyMatrix(m, box.x1, box.y0),
    applyMatrix(m, box.x0, box.y1),
    applyMatrix(m, box.x1, box.y1),
  ]);
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
 * @param end Exclusive replay end index; defaults to the whole operator list.
 * @returns One DrawingPath per subpath, in paint order, with style and bbox.
 */
export function walkOperatorList(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  textItems: TextItemLike[] = [],
  ops: OpsMap = DEFAULT_OPS,
  end = fnArray.length,
): DrawingPath[] {
  void textItems;
  const stroking = strokePaintOps(ops);
  const dashOp = ops.setLineDash ?? ops.setDash;
  const paths: DrawingPath[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let style: PathStyle = { dash: [], lineWidth: 1 };

  for (let i = 0; i < end; i++) {
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
// Stage 1b — plot box from the axis frame
// ---------------------------------------------------------------------------

/** A frame line is thinner than this, in points. */
const FRAME_LINE_THICKNESS = 1.5;
/** A horizontal frame line is wider than this fraction of the page width. */
const FRAME_HORIZONTAL_MIN_WIDTH = 0.4;
/** A vertical frame line is taller than this fraction of the page height. */
const FRAME_VERTICAL_MIN_HEIGHT = 0.25;

/** The plot rectangle recovered from the axis frame, with one gridline spacing. */
export interface AxisFrame {
  box: BBox;
  spacingX: number;
  spacingY: number;
}

/** @returns The distinct positions, rounded to 0.01 pt so a doubly painted gridline counts once. */
function uniquePositions(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b);
}

/** @returns The median gap between consecutive sorted positions. */
function medianStep(positions: number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < positions.length; i++) gaps.push(positions[i] - positions[i - 1]);
  return median(gaps);
}

/**
 * Stage 1b. Recovers the plot rectangle from the long axis-aligned gridlines.
 *
 * A frame line is a path thinner than 1.5 pt that spans more than 40 % of the
 * page width (horizontal) or 25 % of the page height (vertical). The rectangle
 * is the min/max of those line positions, pushed out by one gridline spacing on
 * each axis so the outermost gridlines are interior. This is the axis extent the
 * page furniture declares: title blocks, legends and annotations are excluded by
 * the span test, so they cannot stretch the box the way all-path bounds do.
 *
 * @param paths Every path on the page (stage 0 output, chart space).
 * @param pageBox Page extent in chart space.
 * @returns The frame box and its grid spacing, or null when either axis has fewer
 *   than two long lines.
 */
export function axisFrameBox(paths: DrawingPath[], pageBox: BBox): AxisFrame | null {
  const pageWidth = pageBox.x1 - pageBox.x0;
  const pageHeight = pageBox.y1 - pageBox.y0;
  const horizontals = paths.filter((p) => {
    const width = p.bbox.x1 - p.bbox.x0;
    const height = p.bbox.y1 - p.bbox.y0;
    return height < FRAME_LINE_THICKNESS && width > FRAME_HORIZONTAL_MIN_WIDTH * pageWidth;
  });
  const verticals = paths.filter((p) => {
    const width = p.bbox.x1 - p.bbox.x0;
    const height = p.bbox.y1 - p.bbox.y0;
    return width < FRAME_LINE_THICKNESS && height > FRAME_VERTICAL_MIN_HEIGHT * pageHeight;
  });

  const xs = uniquePositions(verticals.map((p) => p.bbox.x0));
  const ys = uniquePositions(horizontals.map((p) => p.bbox.y0));
  if (xs.length < 2 || ys.length < 2) return null;

  const spacingX = medianStep(xs);
  const spacingY = medianStep(ys);
  return {
    box: {
      x0: xs[0] - spacingX,
      y0: ys[0] - spacingY,
      x1: xs[xs.length - 1] + spacingX,
      y1: ys[ys.length - 1] + spacingY,
    },
    spacingX,
    spacingY,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — calibrate
// ---------------------------------------------------------------------------

interface Anchor {
  coord: number;
  value: number;
  /** Position across the label band: label y for x anchors, label x for y anchors. */
  cross?: number;
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

/** Numeric tick labels split by the plot edge they sit against. */
interface AxisAnchorGroups {
  /** Labels below the plot: x anchors. */
  x: Anchor[];
  /** Labels left of the plot: left y anchors. */
  left: Anchor[];
  /** Labels right of the plot: right y anchors. */
  right: Anchor[];
}

/**
 * Sorts numeric text items into the axis they label: below the plot is x, left of
 * it is left-y, right of it is right-y. Shared by `calibrateAxes` and
 * `collectAxisCandidates` so both read the page the same way.
 *
 * @param textItems Page text items (chart space).
 * @param plotBox Plot extent the labels are measured against.
 * @returns One anchor list per plot edge; empty when no label fits that edge.
 */
function groupAxisAnchors(textItems: TextItemLike[], plotBox: BBox): AxisAnchorGroups {
  const groups: AxisAnchorGroups = { x: [], left: [], right: [] };

  for (const item of textItems) {
    const value = parseLeadingNumber(item.str);
    if (value === null) continue;
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    const withinX = cx >= plotBox.x0 - 2 && cx <= plotBox.x1 + 2;
    const withinY = cy >= plotBox.y0 - 2 && cy <= plotBox.y1 + 2;

    if (cy < plotBox.y0 + 1 && withinX) {
      groups.x.push({ coord: cx, value, cross: cy });
    } else if (cx < plotBox.x0 + 1 && withinY) {
      groups.left.push({ coord: cy, value, cross: cx });
    } else if (cx > plotBox.x1 - 1 && withinY) {
      groups.right.push({ coord: cy, value, cross: cx });
    }
  }
  return groups;
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

  const { x: xAnchors, left: leftAnchors, right: rightAnchors } = groupAxisAnchors(textItems, plotBox);

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

/** One axis printed on the page, recovered from its tick labels. */
export interface AxisCandidate {
  axis: 'x' | 'y';
  min: number;
  max: number;
  /** Axis title nearest the label band, when the page prints one. */
  unit?: string;
  /** Distinct tick labels that defined the range. */
  labelCount: number;
}

/** Max gap, in points, between tick labels of one column: right-aligned ticks shift a few points. */
const COLUMN_GAP = 12;
/** Max cost, in points, between a label column and the axis title that names it. */
const TITLE_MATCH_RADIUS = 60;

/** @returns The anchors split into label columns along their cross coordinate. */
function splitColumns(anchors: Anchor[]): Anchor[][] {
  const sorted = [...anchors].sort((a, b) => (a.cross ?? 0) - (b.cross ?? 0));
  const columns: Anchor[][] = [];
  let current: Anchor[] = [];
  let last = -Infinity;
  for (const anchor of sorted) {
    const cross = anchor.cross ?? 0;
    if (current.length > 0 && cross - last > COLUMN_GAP) {
      columns.push(current);
      current = [];
    }
    current.push(anchor);
    last = cross;
  }
  if (current.length > 0) columns.push(current);
  return columns;
}

/**
 * @returns The axis title naming one label column, when the page prints one.
 *   The title is the nearest letter-bearing text item on the same side of the plot;
 *   titles are weighted by how far they sit outside the plot, so a page stamp in the
 *   same column as a title loses. Only items with a letter count, so tick glyphs and
 *   spacer runs are ignored.
 */
function bandUnit(
  textItems: TextItemLike[],
  plotBox: BBox,
  side: 'below' | 'left' | 'right',
  columnCross: number,
): string | undefined {
  let best: { unit: string; cost: number } | undefined;
  for (const item of textItems) {
    const unit = item.str.trim();
    if (!/[A-Za-z]/.test(unit) || parseLeadingNumber(unit) !== null) continue;
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    let onSide: boolean;
    if (side === 'below') onSide = cy <= plotBox.y0 + 2;
    else if (side === 'left') onSide = cx <= plotBox.x0 + 2;
    else onSide = cx >= plotBox.x1 - 2;
    if (!onSide) continue;
    const alongGap = Math.max(0, plotBox.y0 - cy, cy - plotBox.y1);
    const cost = Math.abs(cx - columnCross) + 2 * alongGap;
    if (cost > TITLE_MATCH_RADIUS) continue;
    if (!best || cost < best.cost) best = { unit, cost };
  }
  return best?.unit;
}

/**
 * Lists the axes actually printed around the plot, one candidate per label band.
 *
 * A candidate needs ≥ 2 distinct numeric labels that step monotonically along one
 * axis. The unit is the nearest axis-title text on that edge, kept verbatim so the
 * caller can see what the page prints (e.g. `Amps`, `Watts Out`, `Eff.`).
 *
 * @param textItems Page text items (chart space).
 * @param plotBox Plot extent the labels are measured against.
 * @returns Candidates in x, left-y, right-y order; [] when the labels are unparseable.
 */
export function collectAxisCandidates(textItems: TextItemLike[], plotBox: BBox): AxisCandidate[] {
  const groups = groupAxisAnchors(textItems, plotBox);
  const candidates: AxisCandidate[] = [];

  const add = (axis: 'x' | 'y', anchors: Anchor[], side: 'below' | 'left' | 'right'): void => {
    // A multi-scale sheet prints several y scales side by side: one candidate per column.
    for (const column of splitColumns(anchors)) {
      const unique = dedupeByCoord(column);
      if (unique.length < 2) continue;
      const sorted = [...unique].sort((a, b) => a.coord - b.coord);
      const increasing = sorted.every((anchor, i) => i === 0 || anchor.value > sorted[i - 1].value);
      const decreasing = sorted.every((anchor, i) => i === 0 || anchor.value < sorted[i - 1].value);
      if (!increasing && !decreasing) continue;
      const values = sorted.map((anchor) => anchor.value);
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (!(max > min)) continue;
      // Title matching compares label x: the along coordinate for x bands, the cross for y bands.
      const columnX = mean(column.map((anchor) => (side === 'below' ? anchor.coord : anchor.cross ?? 0)));
      candidates.push({
        axis,
        min,
        max,
        unit: bandUnit(textItems, plotBox, side, columnX),
        labelCount: unique.length,
      });
    }
  };

  add('x', groups.x, 'below');
  add('y', groups.left, 'left');
  add('y', groups.right, 'right');
  return candidates;
}

/** @returns The data value at a page coordinate under an axis map. */
export function axisToValue(map: AxisMap, coord: number): number {
  const t = map.a * coord + map.b;
  return map.log ? 10 ** t : t;
}

// ---------------------------------------------------------------------------
// Stage 2b — declared calibration
// ---------------------------------------------------------------------------

/**
 * Builds one axis map from a declared range over a page-coordinate span.
 * @returns The map, or `{ error }` when the declaration is unusable.
 */
function declaredMap(
  axis: 'x' | 'y',
  decl: AxisDecl,
  coordMin: number,
  coordMax: number,
): { map?: AxisMap; error?: string } {
  if (!(decl.max > decl.min)) {
    return { error: `declared ${axis} axis range is empty: max (${decl.max}) must exceed min (${decl.min})` };
  }
  if (!(coordMax > coordMin)) {
    return { error: `plot box has no ${axis} extent to map the declared axis onto` };
  }
  if (decl.log && decl.min <= 0) {
    return { error: `declared ${axis} axis is logarithmic but min (${decl.min}) is not positive` };
  }
  const log = decl.log === true;
  const valueMin = log ? Math.log10(decl.min) : decl.min;
  const valueMax = log ? Math.log10(decl.max) : decl.max;
  const a = (valueMax - valueMin) / (coordMax - coordMin);
  const b = valueMin - a * coordMin;
  return {
    map: {
      axis,
      a,
      b,
      log,
      coordMin,
      coordMax,
      valueMin: decl.min,
      valueMax: decl.max,
      anchors: 2,
      unit: decl.unit,
    },
  };
}

/**
 * Stage 2b. Calibration from caller-declared axes; the automatic refusal rules
 * (anchor count, multi-scale ambiguity, monotonicity) are skipped.
 *
 * Declared min maps to the plot box's low coordinate and max to its high
 * coordinate, per axis. One y declaration serves every series; `seriesAxes`
 * only labels output columns.
 *
 * @param xDecl Declared x range.
 * @param yDecl Declared y range.
 * @param plotBox Plot extent in page space.
 * @returns `{ ok: true, declared: true, xAxis, yAxes }`, or a refusal naming the bad declaration.
 */
export function calibrateAxesDeclared(xDecl: AxisDecl, yDecl: AxisDecl, plotBox: BBox): AxisCalibration {
  const x = declaredMap('x', xDecl, plotBox.x0, plotBox.x1);
  if (!x.map) return { ok: false, reason: x.error ?? 'declared x axis unusable' };
  const y = declaredMap('y', yDecl, plotBox.y0, plotBox.y1);
  if (!y.map) return { ok: false, reason: y.error ?? 'declared y axis unusable' };
  const yMap: AxisMap = { ...y.map, side: 'left' };
  return { ok: true, declared: true, xAxis: x.map, yAxes: [yMap] };
}

/** A declared range matches a printed range within this fraction of the printed span. */
const AXIS_MATCH_TOLERANCE = 0.02;

/**
 * @returns True when a declared unit names the printed axis title: equal, or one is a
 *   prefix of the other (`Watts` / `Watts Out`), ignoring case and trailing punctuation.
 */
function unitsAgree(declared: string, printed: string): boolean {
  const normalise = (text: string): string => text.trim().toLowerCase().replace(/[.\s]+$/, '');
  const a = normalise(declared);
  const b = normalise(printed);
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * @returns `Amps 0–200, RPM 0–5000` — busiest bands first, one entry per range, capped at 6.
 *   One range can be printed on both axes; the entry carrying the unit is kept.
 */
function describeCandidates(candidates: AxisCandidate[]): string {
  const byRange = new Map<string, AxisCandidate>();
  for (const candidate of [...candidates].sort((a, b) => b.labelCount - a.labelCount)) {
    const key = `${candidate.min}|${candidate.max}`;
    const seen = byRange.get(key);
    if (!seen || (!seen.unit && candidate.unit)) byRange.set(key, candidate);
  }
  return [...byRange.values()]
    .slice(0, 6)
    .map((candidate) =>
      candidate.unit ? `${candidate.unit} ${candidate.min}–${candidate.max}` : `${candidate.min}–${candidate.max}`,
    )
    .join(', ');
}

/**
 * Stage 2b guard. A declared range must be one the page actually prints, else the
 * plot box is scaled to the wrong axis and every read value is wrong.
 *
 * @param axis Orientation being declared.
 * @param decl The caller's declared range (and optional unit).
 * @param candidates Axes recovered from the page labels.
 * @returns The refusal text, or null when the declaration matches (or nothing was derivable).
 */
function declaredAxisMismatch(axis: 'x' | 'y', decl: AxisDecl, candidates: AxisCandidate[]): string | null {
  const oriented = candidates.filter((candidate) => candidate.axis === axis);
  // No printable evidence for this orientation: the declaration stands, as before.
  if (oriented.length === 0) return null;

  const declaredUnit = decl.unit?.trim().toLowerCase();
  const matches = oriented.some((candidate) => {
    const span = candidate.max - candidate.min || Math.abs(decl.max - decl.min) || 1;
    const close =
      Math.abs(candidate.min - decl.min) <= AXIS_MATCH_TOLERANCE * span &&
      Math.abs(candidate.max - decl.max) <= AXIS_MATCH_TOLERANCE * span;
    const unitOk = !candidate.unit || !declaredUnit || unitsAgree(declaredUnit, candidate.unit);
    return close && unitOk;
  });
  if (matches) return null;
  return (
    `declared ${axis} ${decl.min}–${decl.max} matches no axis printed on this page. ` +
    `Found: ${describeCandidates(candidates)}. ` +
    'Declare the axis you actually want (use unit to disambiguate).'
  );
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
// Stage 3b — legend mapping
// ---------------------------------------------------------------------------

/** Swatch bbox limits from spec §6 stage 3b: vertical strips and horizontal dashes. */
const SWATCH_MAX_THICKNESS = 12;
const SWATCH_MIN_LENGTH = 20;
/** A key is short: without this cap a gridline or an axis rule reads as a swatch. */
const SWATCH_MAX_LENGTH = 60;
/** A row needs at least this many swatches to count as the legend band. */
const LEGEND_ROW_MIN_SWATCHES = 3;
/** Legend labels sit at most this far from their swatch row, in points. */
const LEGEND_LABEL_VERTICAL = 120;
/** Correct pairing is a left-to-right offset: label.x0 - swatch.x0 in (0, 20]. */
const LEGEND_LABEL_OFFSET = 20;

/** @returns The stroke colour key of a style, lowercased; 'none' when unset. */
function colourKey(style: PathStyle): string {
  return (style.stroke ?? 'none').toLowerCase();
}

/** @returns True when the stroke is painted and is not white. */
function hasVisibleStroke(style: PathStyle): boolean {
  const key = colourKey(style);
  if (key === 'none' || key === 'white') return false;
  return !/^#f{3}$|^#f{6}$/.test(key);
}

/** @returns True when a path is a legend swatch: a short vertical strip or a short horizontal dash. */
function isLegendSwatch(candidate: DrawingPath): boolean {
  const width = candidate.bbox.x1 - candidate.bbox.x0;
  const height = candidate.bbox.y1 - candidate.bbox.y0;
  const vertical =
    width <= SWATCH_MAX_THICKNESS && height >= SWATCH_MIN_LENGTH && height <= SWATCH_MAX_LENGTH;
  const horizontal =
    height <= SWATCH_MAX_THICKNESS && width >= SWATCH_MIN_LENGTH && width <= SWATCH_MAX_LENGTH;
  return (vertical || horizontal) && hasVisibleStroke(candidate.style);
}

/** The strip of page space that holds the legend keys: their extent along their long axis. */
export interface LegendBand {
  /** Long axis of the keys: 'x' for horizontal dashes, 'y' for vertical strips. */
  axis: 'x' | 'y';
  min: number;
  max: number;
}

/**
 * Finds the legend key row: the keys share one long-axis orientation, and the band
 * is their extent along it. Both orientations are covered, so the rule survives a
 * rotated page, where a row of strips becomes a column of dashes.
 *
 * @param paths Every path on the page.
 * @returns The band, or null when fewer than 3 keys share one orientation.
 */
export function legendBand(paths: DrawingPath[]): LegendBand | null {
  const swatches = paths.filter(isLegendSwatch);
  if (swatches.length < LEGEND_ROW_MIN_SWATCHES) return null;
  const wide = swatches.filter((s) => s.bbox.x1 - s.bbox.x0 >= s.bbox.y1 - s.bbox.y0);
  const tall = swatches.filter((s) => s.bbox.x1 - s.bbox.x0 < s.bbox.y1 - s.bbox.y0);
  const row = wide.length >= tall.length ? wide : tall;
  if (row.length < LEGEND_ROW_MIN_SWATCHES) return null;
  const axis: 'x' | 'y' = wide.length >= tall.length ? 'x' : 'y';
  const low = (s: DrawingPath): number => (axis === 'x' ? s.bbox.x0 : s.bbox.y0);
  const high = (s: DrawingPath): number => (axis === 'x' ? s.bbox.x1 : s.bbox.y1);
  return { axis, min: Math.min(...row.map(low)), max: Math.max(...row.map(high)) };
}

/** @returns The band as a full-page-thick box, so a page rotation maps it onto the other axis. */
function bandBox(band: LegendBand, pageBox: BBox): BBox {
  return band.axis === 'x'
    ? { x0: band.min, y0: pageBox.y0, x1: band.max, y1: pageBox.y1 }
    : { x0: pageBox.x0, y0: band.min, x1: pageBox.x1, y1: band.max };
}

/**
 * Drops the legend swatch row so its swatches can neither widen the plot box nor
 * join a series.
 *
 * @param paths Paths to filter, in the same space as `band`.
 * @param band Box around the legend swatch row, or null when the page has none.
 * @returns The paths whose bbox does not sit wholly inside the band.
 */
export function withoutLegendBand(paths: DrawingPath[], band: BBox | null): DrawingPath[] {
  if (!band) return paths;
  return paths.filter(
    (path) =>
      !(path.bbox.x0 >= band.x0 && path.bbox.x1 <= band.x1 && path.bbox.y0 >= band.y0 && path.bbox.y1 <= band.y1),
  );
}

/**
 * Pairs one swatch with its legend label.
 *
 * @param swatch One legend swatch.
 * @param textItems Page text items.
 * @param used Labels already given to another swatch.
 * @returns The label naming this swatch, or undefined when none is in range.
 */
function matchLegendLabel(
  swatch: DrawingPath,
  textItems: TextItemLike[],
  used: Set<TextItemLike>,
): TextItemLike | undefined {
  const centreX = (swatch.bbox.x0 + swatch.bbox.x1) / 2;
  const centreY = (swatch.bbox.y0 + swatch.bbox.y1) / 2;
  const candidates = textItems.filter((item) => {
    if (used.has(item)) return false;
    if (!/[A-Za-z]/.test(item.str)) return false;
    return Math.abs(item.y + item.height / 2 - centreY) <= LEGEND_LABEL_VERTICAL;
  });

  // Preferred: the label whose x0 sits just right of the swatch x0.
  let best: TextItemLike | undefined;
  let bestOffset = Infinity;
  for (const item of candidates) {
    const offset = item.x - swatch.bbox.x0;
    if (offset <= 0 || offset > LEGEND_LABEL_OFFSET) continue;
    if (offset < bestOffset) {
      bestOffset = offset;
      best = item;
    }
  }
  if (best) return best;

  // Fallback: nearest by centre distance, still within one swatch offset horizontally.
  let bestDistance = Infinity;
  for (const item of candidates) {
    if (Math.abs(item.x - swatch.bbox.x0) > LEGEND_LABEL_OFFSET) continue;
    const distance = Math.hypot(item.x + item.width / 2 - centreX, item.y + item.height / 2 - centreY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  return best;
}

/**
 * Stage 3b. Names clusters from legend swatches and their labels.
 *
 * A swatch is a short key with a non-white stroke: a vertical strip (width ≤ 12 pt,
 * 20 ≤ height ≤ 60 pt) or a horizontal dash (height ≤ 12 pt, 20 ≤ width ≤ 60 pt).
 * The length cap keeps gridlines and axis rules out of the swatch set. The legend
 * band is the extent of the keys along their long axis, when at least 3 keys share
 * one orientation.
 * Labels are matched left-to-right: the label whose x0 sits 0-20 pt right of the
 * swatch x0 wins (labels on the reference sheet sit ~72 pt above their swatch,
 * so a vertical-proximity rule cannot match), with the nearest label by centre
 * distance as fallback. A cluster takes the name of the swatch with the same
 * stroke colour; swatches inside the band win over same-colour swatches
 * elsewhere on the page.
 *
 * Best-effort: clusters with no swatch keep `series N` and are marked
 * `unnamed`. Never throws, never blocks extraction.
 *
 * @param paths Every path of the page (stage 0 output, all classes).
 * @param textItems Page text items.
 * @param clusters Clusters from stage 3, in extraction order.
 * @param pageBox Page extent. Unused since the band comes from the swatch row;
 *   kept so both call sites keep one signature.
 * @returns Copies of the clusters with `name` (and `unnamed` when unmatched) set.
 */
export function mapLegend(
  paths: DrawingPath[],
  textItems: TextItemLike[],
  clusters: SeriesCluster[],
  pageBox?: BBox,
): SeriesCluster[] {
  const swatches = paths.filter(isLegendSwatch);
  const band = legendBand(paths);
  const inRow = (swatch: DrawingPath): boolean => {
    if (!band) return false;
    const centre =
      band.axis === 'x' ? (swatch.bbox.x0 + swatch.bbox.x1) / 2 : (swatch.bbox.y0 + swatch.bbox.y1) / 2;
    return centre >= band.min && centre <= band.max;
  };

  // Each label names at most one swatch; band swatches claim labels first.
  const usedLabels = new Set<TextItemLike>();
  const byColour = new Map<string, string>();
  const assign = (group: DrawingPath[]): void => {
    for (const swatch of [...group].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
      const label = matchLegendLabel(swatch, textItems, usedLabels);
      if (!label) continue;
      usedLabels.add(label);
      const key = colourKey(swatch.style);
      if (!byColour.has(key)) byColour.set(key, label.str.trim());
    }
  };
  assign(swatches.filter(inRow));
  assign(swatches.filter((swatch) => !inRow(swatch)));

  return clusters.map((cluster, index) => {
    const name = byColour.get(colourKey(cluster.style));
    if (!name) return { ...cluster, name: `series ${index + 1}`, unnamed: true };
    return { ...cluster, name, unnamed: false };
  });
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

// ---------------------------------------------------------------------------
// Orchestrator — one page, all stages
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SAMPLES = 40;
const MAX_SAMPLES = 200;
/** Per-page extraction budget (spec §9). */
const PAGE_TIMEOUT_MS = 20000;

/** @returns `task` or rejects with a timeout error after `ms` milliseconds. */
function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Extracts one page of a PDF chart: collect → classify → calibrate → cluster →
 * map legend → sample.
 *
 * Automatic calibration refuses multi-scale pages; passing `opts.axes` bypasses
 * those refusal rules (spec §6 stage 2b). Failures are non-fatal: they land in
 * `refusals` and the call still resolves.
 *
 * @param filePath Absolute path to a PDF file.
 * @param opts Page (1-based, default 1), declared axes, series→axis labels, sample cap.
 * @returns The page's calibration, named series with samples, refusals and notes.
 * @throws Never: read, parse, timeout and calibration failures are reported in `refusals`.
 */
export async function extractChartData(
  filePath: string,
  opts: ChartExtractionOptions = {},
): Promise<ChartExtraction> {
  const file = path.basename(filePath);
  const page = Math.max(1, Math.round(opts.page ?? 1));
  const maxSamples = Math.min(MAX_SAMPLES, Math.max(1, Math.round(opts.maxSamples ?? DEFAULT_MAX_SAMPLES)));
  const refusals: string[] = [];
  const notes: string[] = [];

  const failed = (calibration: AxisCalibration, series: ChartSeries[] = []): ChartExtraction => ({
    file,
    page,
    calibration,
    series,
    refusals,
    notes,
  });

  try {
    const lib: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await lib.getDocument({ data }).promise;
    if (page > doc.numPages) {
      refusals.push(`page ${page} does not exist: the document has ${doc.numPages} page(s)`);
      return failed({ ok: false, reason: refusals[0] });
    }
    const pageProxy = await doc.getPage(page);
    const drawing = await withTimeout(collectDrawing(pageProxy), PAGE_TIMEOUT_MS, 'chart drawing collection');

    const frame = axisFrameBox(drawing.chartPaths, drawing.chartBox);
    const allBox = pathsBounds(drawing.chartPaths);
    if (!allBox) {
      refusals.push('no vector paths on this page — raster page; vision transcription applies');
      return failed({ ok: false, reason: refusals[0] });
    }
    const classes = classifyPaths(drawing.chartPaths, frame?.box ?? allBox);
    if (classes.data.length < 2) {
      refusals.push(
        `no vector chart found on this page (${drawing.chartPaths.length} paths, ${classes.data.length} data paths)` +
          ' — raster page; vision transcription applies',
      );
      return failed({ ok: false, reason: refusals[0] });
    }

    // Box provenance: axis frame → data paths without the legend band → all page paths.
    const dataPaths = withoutLegendBand(classes.data, drawing.chartLegendBand);
    const dataBox = pathsBounds(dataPaths);
    const plotBox = frame?.box ?? dataBox ?? allBox;
    const boxRange =
      `x ${plotBox.x0.toFixed(1)}–${plotBox.x1.toFixed(1)} pt, y ${plotBox.y0.toFixed(1)}–${plotBox.y1.toFixed(1)} pt`;
    notes.push(
      frame
        ? `plot box ${boxRange} from the axis frame; grid spacing ${frame.spacingX.toFixed(2)} × ${frame.spacingY.toFixed(2)} pt`
        : `plot box ${boxRange} from ${dataBox ? 'data paths' : 'all page paths'}: no axis frame found`,
    );

    let calibration: AxisCalibration;
    if (opts.axes) {
      const candidates = collectAxisCandidates(drawing.chartTextItems, plotBox);
      if (candidates.length === 0) notes.push('axis candidates not derivable from page labels');
      const mismatch =
        declaredAxisMismatch('x', opts.axes.x, candidates) ??
        declaredAxisMismatch('y', opts.axes.y, candidates);
      if (mismatch) {
        refusals.push(mismatch);
        return failed({ ok: false, reason: mismatch });
      }
      calibration = calibrateAxesDeclared(opts.axes.x, opts.axes.y, plotBox);
    } else {
      calibration = calibrateAxes(drawing.chartTextItems, classes.frame, classes.data);
    }
    if (!calibration.ok) {
      refusals.push(calibration.reason ?? 'axis calibration refused');
      // Without declared axes there is no scale: return the refusal and no series.
      // A table of empty columns would read as data; the caller must pass `axes`.
      return failed(calibration);
    }

    const clusters = clusterSeries(dataPaths, plotBox);
    const mapped = mapLegend(drawing.paths, drawing.textItems, clusters, drawing.pageBox);
    if (mapped.length === 0) refusals.push(`no series survived clustering (${dataPaths.length} data paths)`);

    if (mapped.some((cluster) => (cluster.style.dash?.length ?? 0) > 0)) {
      notes.push('dashed series: dash segments merged by x-continuity');
    }
    if (calibration.xAxis?.log || calibration.yAxes?.some((map) => map.log)) notes.push('log axis');
    const styleCounts = new Map<string, number>();
    for (const cluster of mapped) {
      const key = colourKey(cluster.style);
      styleCounts.set(key, (styleCounts.get(key) ?? 0) + 1);
    }
    for (const count of styleCounts.values()) {
      if (count > 1) notes.push(`${count} curves share a style; samples are the median`);
    }

    const ySide = calibration.yAxes?.[0]?.side === 'right' ? 'right' : 'left';
    const series: ChartSeries[] = mapped.map((cluster, index) => {
      const name = cluster.name ?? `series ${index + 1}`;
      const samples = sampleSeries([cluster], calibration, maxSamples)[0]?.samples ?? [];
      return {
        name,
        axis: opts.seriesAxes?.[name] ?? ySide,
        samples,
        style: cluster.style,
        unnamed: cluster.unnamed,
        pathIds: cluster.pathIds,
      };
    });

    return { file, page, calibration, series, refusals, notes };
  } catch (error: any) {
    refusals.push(`chart extraction failed: ${error?.message ?? String(error)}`);
    return failed({ ok: false, reason: refusals[refusals.length - 1] });
  }
}
