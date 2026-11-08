/**
 * chart-types.ts — Plain data contracts shared by the PDF chart-vector stages.
 *
 * Purpose: types for spec §6 stages 0-4. No pdfjs import here, so stages 1-4 stay
 * pure and testable with hand-built fixtures.
 */

/** A point in page space (PDF units, y-up). */
export interface Point {
  x: number;
  y: number;
}

/** Stroke state at the moment a path was painted. */
export interface PathStyle {
  /** Stroke colour as reported by pdfjs, e.g. '#ff0000'. Undefined = never set. */
  stroke?: string;
  /** Dash pattern in page units; empty array means solid. */
  dash?: number[];
  lineWidth?: number;
}

/** Axis-aligned bounding box in page space. */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * One painted subpath. Stage 0 splits at every moveTo and flattens curves, so
 * `points` is always a polyline in page space.
 */
export interface DrawingPath {
  points: Point[];
  closed: boolean;
  style: PathStyle;
  bbox: BBox;
}

/** Text item reduced to what axis calibration needs. */
export interface TextItemLike {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Affine (or log) map between a page coordinate and a data value. */
export interface AxisMap {
  axis: 'x' | 'y';
  /** Set for y axes; treated as 'left' when undefined. */
  side?: 'left' | 'right';
  /** value = a * coord + b (linear), or 10^(a * coord + b) when `log`. */
  a: number;
  b: number;
  log: boolean;
  /** Page-space coordinate range covered by the anchors. */
  coordMin: number;
  coordMax: number;
  /** Data value range at those coordinates. */
  valueMin: number;
  valueMax: number;
  /** Number of tick-label anchors used for the fit. */
  anchors: number;
}

/** Result of stage 2. `ok: false` carries a specific reason; values are never guessed. */
export interface AxisCalibration {
  ok: boolean;
  reason?: string;
  xAxis?: AxisMap;
  yAxes?: AxisMap[];
}

/** One series recovered by stage 3. */
export interface SeriesCluster {
  /** Style key: stroke colour + dash + line width. */
  key: string;
  points: Point[];
  style: PathStyle;
  /** Indices into the dataPaths array handed to clusterSeries. */
  pathIds: number[];
}

/** Sampled rows for one series (stage 4). */
export interface SeriesSamples {
  series: string;
  axis: 'left' | 'right';
  samples: { x: number; y: number }[];
}

/** Spec §5 probe result for one page. */
export interface ChartProbe {
  /** 1-based page number. */
  page: number;
  /** Paths classified as data (not ticks/frame). */
  dataPaths: number;
  /** Legend candidates, in legend order; [] when unknown. */
  series: string[];
  /** False when axes are missing or ambiguous. */
  reliable: boolean;
}

/** Everything a chart read produces for one page. */
export interface ChartExtraction {
  page: number;
  calibration: AxisCalibration;
  series: SeriesCluster[];
  samples: SeriesSamples[];
  /** Disclosures, e.g. "dashed series", "N curves share a style; samples are the median". */
  notes: string[];
}
