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
  /** Unit token when the axis was declared explicitly (spec §6 stage 2b). */
  unit?: string;
}

/** Result of stage 2. `ok: false` carries a specific reason; values are never guessed. */
export interface AxisCalibration {
  ok: boolean;
  reason?: string;
  xAxis?: AxisMap;
  yAxes?: AxisMap[];
  /** True when the calibration came from caller-declared axes, not the tick labels. */
  declared?: boolean;
}

/** Caller-declared axis range, used to bypass automatic calibration (spec §6 stage 2b). */
export interface AxisDecl {
  min: number;
  max: number;
  unit?: string;
  log?: boolean;
}

/** One series recovered by stage 3. */
export interface SeriesCluster {
  /** Style key: stroke colour + dash + line width. */
  key: string;
  points: Point[];
  style: PathStyle;
  /** Indices into the dataPaths array handed to clusterSeries. */
  pathIds: number[];
  /** Legend name from stage 3b; absent until `mapLegend` runs. */
  name?: string;
  /** True when stage 3b could not match the cluster to a legend key. */
  unnamed?: boolean;
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

/** One named, sampled series as returned by `extractChartData`. */
export interface ChartSeries {
  name: string;
  axis: 'left' | 'right';
  samples: { x: number; y: number }[];
  style: PathStyle;
  unnamed?: boolean;
  /** Indices of the data paths this series came from (provenance). */
  pathIds: number[];
}

/** Everything a chart read produces for one page. */
export interface ChartExtraction {
  /** Base name of the source file. */
  file: string;
  page: number;
  calibration: AxisCalibration;
  series: ChartSeries[];
  /** Non-fatal failures, e.g. a refused calibration or a raster page. */
  refusals: string[];
  /** Disclosures, e.g. "dashed series", "N curves share a style; samples are the median". */
  notes: string[];
}

/** Options accepted by `extractChartData`. */
export interface ChartExtractionOptions {
  /** 1-based page number; defaults to 1. */
  page?: number;
  /** Explicit calibration that bypasses the automatic refusal rules. */
  axes?: { x: AxisDecl; y: AxisDecl };
  /** Output-side series→axis labels; does not change the numerical map. */
  seriesAxes?: Record<string, 'left' | 'right'>;
  /** Sample count per series, clamped to 1..200; defaults to 40. */
  maxSamples?: number;
}
