import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  axisFrameBox,
  axisToValue,
  calibrateAxes,
  calibrateAxesDeclared,
  chartSpaceMatrix,
  classifyPaths,
  clusterSeries,
  extractChartData,
  mapLegend,
  sampleSeries,
  walkOperatorList,
  withoutLegendBand,
} from '../src/tools/document-extractors/chart-vector-extractor.js';
import type {
  BBox,
  ChartExtraction,
  DrawingPath,
  SeriesCluster,
  TextItemLike,
} from '../src/tools/document-extractors/chart-types.js';

// Synthetic fixtures only: no PDF file, no network, no pdfjs import.
// Plot frame occupies page space (100,100)-(500,400), y-up.
// Data space: x 0..300, y 0..2000.
const PLOT: BBox = { x0: 100, y0: 100, x1: 500, y1: 400 };
const X_UNIT = (PLOT.x1 - PLOT.x0) / 300; // 4/3 pt per x unit
const Y_UNIT = (PLOT.y1 - PLOT.y0) / 2000; // 0.15 pt per y unit

const pageX = (value: number): number => PLOT.x0 + value * X_UNIT;
const pageY = (value: number): number => PLOT.y0 + value * Y_UNIT;

/** Plain numeric opcode map so the walker needs no pdfjs. */
const OPS: Record<string, number> = {
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 2,
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
};

const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const CLOSE = 4;

class OpList {
  fn: number[] = [];
  args: unknown[][] = [];

  op(opcode: number, args: unknown[] = []): this {
    this.fn.push(opcode);
    this.args.push(args);
    return this;
  }

  strokePath(buffer: number[]): this {
    return this.op(OPS.constructPath, [OPS.stroke, [buffer], [0, 0, 0, 0]]);
  }

  fillPath(buffer: number[]): this {
    return this.op(OPS.constructPath, [OPS.fill, [buffer], [0, 0, 0, 0]]);
  }
}

/** Plot with 4 x ticks (0/100/200/300), 3 y ticks (0/1000/2000), one solid line and one dashed curve. */
function buildPlotOpList(): OpList {
  const list = new OpList();
  list.op(OPS.setStrokeRGBColor, ['#000000']).op(OPS.setLineWidth, [1]);

  // Frame: two axis-aligned segments spanning the plot.
  list.strokePath([MOVE, PLOT.x0, PLOT.y0, LINE, PLOT.x1, PLOT.y0]);
  list.strokePath([MOVE, PLOT.x0, PLOT.y0, LINE, PLOT.x0, PLOT.y1]);

  // x ticks: 5 pt vertical marks below the frame.
  for (const value of [0, 100, 200, 300]) {
    list.strokePath([MOVE, pageX(value), PLOT.y0 - 5, LINE, pageX(value), PLOT.y0]);
  }
  // y ticks: 5 pt horizontal marks left of the frame.
  for (const value of [0, 1000, 2000]) {
    list.strokePath([MOVE, PLOT.x0 - 5, pageY(value), LINE, PLOT.x0, pageY(value)]);
  }

  // Solid red line through (0,0) and (300,1500), drawn as a 4-point polyline.
  list.op(OPS.setStrokeRGBColor, ['#ff0000']).op(OPS.setLineWidth, [2]);
  list.strokePath([
    MOVE, pageX(0), pageY(0),
    LINE, pageX(100), pageY(500),
    LINE, pageX(200), pageY(1000),
    LINE, pageX(300), pageY(1500),
  ]);

  // Dashed blue curve, split into two subpaths with a 6.67 pt x gap (< 2 % of plot width).
  list.op(OPS.setStrokeRGBColor, ['#0000ff']).op(OPS.setLineDash, [[3, 3], 0]).op(OPS.setLineWidth, [1]);
  list.strokePath([MOVE, 100, 380, CURVE, 150, 390, 200, 395, 300, 400]);
  list.strokePath([MOVE, 306.6667, 400, LINE, 400, 398, LINE, 500, 396]);

  return list;
}

function xLabel(value: number): TextItemLike {
  return { str: String(value), x: pageX(value) - 6, y: 81, width: 12, height: 8 };
}

function yLabelLeft(value: number): TextItemLike {
  return { str: String(value), x: 80, y: pageY(value) - 4, width: 18, height: 8 };
}

function yLabelRight(value: number, at: number): TextItemLike {
  return { str: String(value), x: 505, y: at - 4, width: 10, height: 8 };
}

const X_LABELS: TextItemLike[] = [0, 100, 200, 300].map(xLabel);
const Y_LABELS_LEFT: TextItemLike[] = [0, 1000, 2000].map(yLabelLeft);
const LABELS: TextItemLike[] = [...X_LABELS, ...Y_LABELS_LEFT];

function walkPlot(): DrawingPath[] {
  const list = buildPlotOpList();
  return walkOperatorList(list.fn, list.args, [], OPS);
}

function classifyPlot(): { paths: DrawingPath[]; classes: ReturnType<typeof classifyPaths> } {
  const paths = walkPlot();
  return { paths, classes: classifyPaths(paths, PLOT) };
}

function findPath(paths: DrawingPath[], stroke: string, dash: string): DrawingPath | undefined {
  return paths.find((p) => p.style.stroke === stroke && (p.style.dash?.join(',') ?? '') === dash);
}

describe('stage 0 — walkOperatorList', () => {
  it('decodes stroke paths into page-space points, bboxes and styles', () => {
    const paths = walkPlot();

    // 2 frame + 7 ticks + 1 solid + 2 dashed subpaths
    expect(paths).toHaveLength(12);

    const solid = findPath(paths, '#ff0000', '');
    expect(solid).toBeDefined();
    expect(solid!.points[0]).toEqual({ x: PLOT.x0, y: PLOT.y0 });
    expect(solid!.points[solid!.points.length - 1]).toEqual({ x: 500, y: 325 });
    expect(solid!.bbox).toEqual({ x0: 100, y0: 100, x1: 500, y1: 325 });
    expect(solid!.closed).toBe(false);
    expect(solid!.style.lineWidth).toBe(2);

    const dashed = findPath(paths, '#0000ff', '3,3');
    expect(dashed).toBeDefined();
    expect(dashed!.style.lineWidth).toBe(1);
    // moveTo + 10 flattened cubic steps
    expect(dashed!.points).toHaveLength(11);
    expect(dashed!.bbox).toEqual({ x0: 100, y0: 380, x1: 300, y1: 400 });
  });

  it('applies save/transform/restore to the CTM and skips fill-only paint ops', () => {
    const list = new OpList();
    list.op(OPS.transform, [2, 0, 0, 2, 10, 10]);
    list.strokePath([MOVE, 0, 0, LINE, 10, 20]);
    list.op(OPS.save).op(OPS.transform, [1, 0, 0, 1, 5, 5]);
    list.strokePath([MOVE, 5, 5, LINE, 5, 10]);
    list.op(OPS.restore);
    list.strokePath([MOVE, 0, 0, LINE, 1, 1]);
    list.fillPath([MOVE, 0, 0, LINE, 9, 9]);

    const paths = walkOperatorList(list.fn, list.args, [], OPS);
    expect(paths).toHaveLength(3);
    expect(paths[0].points).toEqual([{ x: 10, y: 10 }, { x: 30, y: 50 }]);
    expect(paths[1].points).toEqual([{ x: 25, y: 25 }, { x: 25, y: 35 }]);
    expect(paths[2].points).toEqual([{ x: 10, y: 10 }, { x: 12, y: 12 }]);
  });

  it('marks closed subpaths', () => {
    const list = new OpList();
    list.strokePath([MOVE, 0, 0, LINE, 10, 0, CLOSE]);
    const paths = walkOperatorList(list.fn, list.args, [], OPS);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(true);
  });
});

describe('stage 1 — classifyPaths', () => {
  it('separates ticks, frame and data', () => {
    const { classes } = classifyPlot();
    expect(classes.ticks).toHaveLength(7);
    expect(classes.frame).toHaveLength(2);
    expect(classes.data).toHaveLength(3);
    expect(classes.frame.every((p) => p.style.stroke === '#000000')).toBe(true);
    expect(classes.data.every((p) => p.style.stroke !== '#000000')).toBe(true);
  });
});

describe('stage 2 — calibrateAxes', () => {
  it('recovers the affine map from the tick labels', () => {
    const { classes } = classifyPlot();
    const calibration = calibrateAxes(LABELS, classes.frame, classes.data);

    expect(calibration.ok).toBe(true);
    expect(calibration.reason).toBeUndefined();
    expect(calibration.xAxis).toBeDefined();
    expect(calibration.yAxes).toHaveLength(1);
    expect(calibration.xAxis!.log).toBe(false);
    expect(calibration.xAxis!.anchors).toBe(4);
    expect(calibration.yAxes![0].anchors).toBe(3);
    expect(calibration.yAxes![0].side).toBe('left');

    // Line endpoints: (0,0) and (300,1500) within 1 % of axis span.
    const xSpan = calibration.xAxis!.valueMax - calibration.xAxis!.valueMin;
    const ySpan = calibration.yAxes![0].valueMax - calibration.yAxes![0].valueMin;
    expect(Math.abs(axisToValue(calibration.xAxis!, 100) - 0)).toBeLessThanOrEqual(0.01 * xSpan);
    expect(Math.abs(axisToValue(calibration.xAxis!, 500) - 300)).toBeLessThanOrEqual(0.01 * xSpan);
    expect(Math.abs(axisToValue(calibration.yAxes![0], 100) - 0)).toBeLessThanOrEqual(0.01 * ySpan);
    expect(Math.abs(axisToValue(calibration.yAxes![0], 325) - 1500)).toBeLessThanOrEqual(0.01 * ySpan);
  });

  it('refuses with fewer than 2 anchors', () => {
    const { classes } = classifyPlot();
    const calibration = calibrateAxes([xLabel(0), ...Y_LABELS_LEFT], classes.frame, classes.data);
    expect(calibration.ok).toBe(false);
    expect(calibration.reason).toMatch(/fewer than 2 anchors on the x axis/);
  });

  it('refuses a non-monotonic y scale', () => {
    const { classes } = classifyPlot();
    const shuffled: TextItemLike[] = [
      ...X_LABELS,
      { str: '0', x: 80, y: PLOT.y0 - 4, width: 18, height: 8 },
      { str: '2000', x: 80, y: 246, width: 18, height: 8 },
      { str: '1000', x: 80, y: PLOT.y1 - 4, width: 18, height: 8 },
    ];
    const calibration = calibrateAxes(shuffled, classes.frame, classes.data);
    expect(calibration.ok).toBe(false);
    expect(calibration.reason).toMatch(/non-monotonic/);
  });

  it('refuses two y scales that cannot be disambiguated', () => {
    const { classes } = classifyPlot();
    const calibration = calibrateAxes(
      [...LABELS, yLabelRight(0, PLOT.y0), yLabelRight(1, PLOT.y1)],
      classes.frame,
      classes.data,
    );
    expect(calibration.ok).toBe(false);
    expect(calibration.reason).toMatch(/ambiguous y-axes/);
  });
});

describe('stage 3 — clusterSeries', () => {
  it('merges the dashed subpaths into one cluster', () => {
    const { classes } = classifyPlot();
    const clusters = clusterSeries(classes.data, PLOT);

    expect(clusters).toHaveLength(2);
    const dashed = clusters.filter((c) => c.style.dash?.join(',') === '3,3');
    expect(dashed).toHaveLength(1);
    expect(dashed[0].pathIds).toHaveLength(2);
    expect(dashed[0].points.length).toBe(14); // 11 + 3
    expect(dashed[0].points[0].x).toBe(100);
    expect(dashed[0].points[dashed[0].points.length - 1].x).toBe(500);

    const solid = clusters.filter((c) => c.style.stroke === '#ff0000');
    expect(solid).toHaveLength(1);
    expect(solid[0].pathIds).toHaveLength(1);
  });

  it('drops legend swatches', () => {
    const { classes } = classifyPlot();
    const swatch: DrawingPath = {
      points: [{ x: 60, y: 60 }, { x: 90, y: 60 }, { x: 90, y: 62 }],
      closed: false,
      style: { stroke: '#00aa00', dash: [], lineWidth: 1 },
      bbox: { x0: 60, y0: 60, x1: 90, y1: 62 },
    };
    const clusters: SeriesCluster[] = clusterSeries([...classes.data, swatch], PLOT);
    expect(clusters.some((c) => c.style.stroke === '#00aa00')).toBe(false);
  });
});

describe('stage 4 — sampleSeries', () => {
  it('returns 40 ascending samples with the correct midpoint', () => {
    const { classes } = classifyPlot();
    const calibration = calibrateAxes(LABELS, classes.frame, classes.data);
    const clusters = clusterSeries(classes.data, PLOT);
    const sampled = sampleSeries(clusters, calibration, 40);

    const solidCluster = clusters.find((c) => c.style.stroke === '#ff0000')!;
    const solid = sampled.find((s) => s.series === solidCluster.key)!;
    expect(solid).toBeDefined();
    expect(solid.axis).toBe('left');
    expect(solid.samples).toHaveLength(40);

    for (let i = 1; i < solid.samples.length; i++) {
      expect(solid.samples[i].x).toBeGreaterThan(solid.samples[i - 1].x);
    }
    // Line is y = 5x in data space; y span is 2000, so 1 % = 20.
    for (const sample of solid.samples) {
      expect(Math.abs(sample.y - 5 * sample.x)).toBeLessThanOrEqual(20);
    }
    const midpoint = solid.samples.reduce((best, s) =>
      Math.abs(s.x - 150) < Math.abs(best.x - 150) ? s : best,
    );
    expect(Math.abs(midpoint.y - 5 * midpoint.x)).toBeLessThanOrEqual(20);
    expect(midpoint.y).toBeGreaterThan(600);
    expect(midpoint.y).toBeLessThan(900);
  });

  it('returns nothing when the calibration is refused', () => {
    const { classes } = classifyPlot();
    const calibration = calibrateAxes([xLabel(0)], classes.frame, classes.data);
    expect(sampleSeries(clusterSeries(classes.data, PLOT), calibration)).toEqual([]);
  });
});

// --- stage 3b fixtures: the legend measured on the reference sheet ----------
// Swatches are vertical strips 6 pt wide x 50 pt tall, bbox y 718-768.
// Labels sit at page y 646.7, i.e. ~72 pt ABOVE the swatch band.
const PAGE_BOX: BBox = { x0: 0, y0: 0, x1: 612, y1: 792 };
const SWATCH_Y0 = 718;
const LABEL_Y = 646.7;

/** One legend row entry with its measured swatch and label x0. */
interface LegendEntry {
  stroke: string;
  swatchX0: number;
  label: string;
  labelX0: number;
}

const MEASURED_LEGEND: LegendEntry[] = [
  { stroke: '#000000', swatchX0: 128, label: 'RPM', labelX0: 138 },
  { stroke: '#ff0000', swatchX0: 149, label: 'Amps', labelX0: 157 },
  { stroke: '#006500', swatchX0: 170, label: 'Volts', labelX0: 176 },
  { stroke: '#00ffff', swatchX0: 191, label: 'Watts Out', labelX0: 195 },
  { stroke: '#0000ff', swatchX0: 212, label: 'Eff.', labelX0: 214 },
];

/** Vertical legend strip: 6 pt wide, 50 pt tall. */
function stripSwatch(x0: number, stroke: string, y0 = SWATCH_Y0): DrawingPath {
  return {
    points: [{ x: x0, y: y0 }, { x: x0, y: y0 + 50 }],
    closed: false,
    style: { stroke, dash: [], lineWidth: 1 },
    bbox: { x0, y0, x1: x0 + 6, y1: y0 + 50 },
  };
}

/** Legend label in the measured row, ~72 pt above the swatch band. */
function legendLabel(str: string, x: number, y = LABEL_Y): TextItemLike {
  return { str, x, y, width: str.length * 4, height: 8 };
}

/** @returns The swatch paths and text items of a legend row. */
function legendRow(entries: LegendEntry[] = MEASURED_LEGEND): { paths: DrawingPath[]; textItems: TextItemLike[] } {
  return {
    paths: entries.map((entry) => stripSwatch(entry.swatchX0, entry.stroke)),
    textItems: entries.map((entry) => legendLabel(entry.label, entry.labelX0)),
  };
}

function curveCluster(stroke: string, x0 = 100): SeriesCluster {
  return {
    key: `${stroke}|solid|2`,
    points: [{ x: x0, y: 100 }, { x: 300, y: 250 }, { x: 500, y: 400 }],
    style: { stroke, dash: [], lineWidth: 2 },
    pathIds: [0],
  };
}

describe('stage 3b — mapLegend', () => {
  it('names the measured legend left-to-right by swatch/label offset', () => {
    const { paths, textItems } = legendRow();
    const clusters = MEASURED_LEGEND.map((entry) => curveCluster(entry.stroke));

    const mapped = mapLegend(paths, textItems, clusters, PAGE_BOX);

    expect(mapped.map((cluster) => cluster.name)).toEqual(['RPM', 'Amps', 'Volts', 'Watts Out', 'Eff.']);
    expect(mapped.every((cluster) => cluster.unnamed === false)).toBe(true);
  });

  it('pairs a two-swatch row and flags the unmatched cluster', () => {
    const { paths, textItems } = legendRow([MEASURED_LEGEND[1], MEASURED_LEGEND[4]]);
    const clusters: SeriesCluster[] = [curveCluster('#ff0000'), curveCluster('#0000ff'), curveCluster('#00aa00')];

    const mapped = mapLegend(paths, textItems, clusters, PAGE_BOX);

    expect(mapped).toHaveLength(3);
    expect(mapped[0].name).toBe('Amps');
    expect(mapped[0].unnamed).toBe(false);
    expect(mapped[1].name).toBe('Eff.');
    expect(mapped[1].unnamed).toBe(false);
    expect(mapped[2].name).toBe('series 3');
    expect(mapped[2].unnamed).toBe(true);
    expect(mapped[2].style.stroke).toBe('#00aa00');
  });

  it('does not take a left-hand axis title for the first legend label', () => {
    // Measured layout: axis title RPM at x138, swatch #ff0000 at x149, label Amps at x157.
    const paths: DrawingPath[] = [stripSwatch(149, '#ff0000'), stripSwatch(170, '#006500')];
    const textItems: TextItemLike[] = [legendLabel('RPM', 138), legendLabel('Amps', 157), legendLabel('Volts', 176)];
    const mapped = mapLegend(paths, textItems, [curveCluster('#ff0000'), curveCluster('#006500')], PAGE_BOX);
    expect(mapped.map((cluster) => cluster.name)).toEqual(['Amps', 'Volts']);
  });

  it('leaves a swatch with no label in range unnamed', () => {
    const { paths, textItems } = legendRow();
    // Sixth strip in the same row: its only label is 30 pt to the right (> 20 pt).
    paths.push(stripSwatch(400, '#00aa00'));
    textItems.push(legendLabel('Far', 430));
    const clusters = [...MEASURED_LEGEND.map((entry) => curveCluster(entry.stroke)), curveCluster('#00aa00')];

    const mapped = mapLegend(paths, textItems, clusters, PAGE_BOX);

    const stray = mapped[mapped.length - 1];
    expect(stray.style.stroke).toBe('#00aa00');
    expect(stray.name).toBe('series 6');
    expect(stray.unnamed).toBe(true);
  });

  it('prefers the legend-band swatch when one colour appears twice', () => {
    const { paths, textItems } = legendRow();
    // A same-colour strip far above the legend row, with its own nearby label.
    paths.push(stripSwatch(300, '#ff0000', 100));
    textItems.push(legendLabel('Stray', 305, 121));

    const mapped = mapLegend(paths, textItems, [curveCluster('#ff0000')], PAGE_BOX);

    expect(mapped[0].name).toBe('Amps');
    expect(mapped[0].unnamed).toBe(false);
  });
});

// --- auto-refusal path: a page with curves but no tick labels ----------------
const VECTOR_CONTENT = [
  '0 0 0 RG 1 w',
  '100 100 m 500 100 l S',
  '100 100 m 100 400 l S',
  '1 0 0 RG 2 w',
  '100 120 m 200 200 l 300 280 l 400 340 l S',
  '0 0 1 RG 2 w',
  '100 140 m 200 220 l 300 300 l 400 380 l S',
].join('\n');

/** @returns A one-page PDF whose content stream is `content`, with no text items. */
function vectorPdf(content: string, rotate = 0): Buffer {
  const rotation = rotate === 0 ? '' : `/Rotate ${rotate}`;
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]${rotation}/Resources<<>>/Contents 4 0 R>>`,
    `<</Length ${content.length}>>stream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj${body}endobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

describe('extractChartData — refused calibration', () => {
  it('returns no series, only the refusal, when automatic calibration fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-chart-legend-'));
    const file = path.join(dir, 'chart.pdf');
    fs.writeFileSync(file, vectorPdf(VECTOR_CONTENT));

    const refused = await extractChartData(file);
    expect(refused.calibration.ok).toBe(false);
    expect(refused.series).toEqual([]);
    expect(refused.refusals.join(' ')).toMatch(/fewer than 2 anchors on the x axis/);

    const declared = await extractChartData(file, { axes: { x: { min: 0, max: 300 }, y: { min: 0, max: 2000 } } });
    expect(declared.calibration.ok).toBe(true);
    expect(declared.series).toHaveLength(2);
    expect(declared.series.every((entry) => entry.samples.length > 0)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('stage 2b — declared axes', () => {
  it('bypasses the automatic multi-scale refusal', () => {
    const { classes } = classifyPlot();
    const ambiguous: TextItemLike[] = [...LABELS, yLabelRight(0, PLOT.y0), yLabelRight(1, PLOT.y1)];
    expect(calibrateAxes(ambiguous, classes.frame, classes.data).ok).toBe(false);

    const declared = calibrateAxesDeclared({ min: 0, max: 300 }, { min: 0, max: 2000, unit: 'rpm' }, PLOT);
    expect(declared.ok).toBe(true);
    expect(declared.declared).toBe(true);
    expect(declared.reason).toBeUndefined();
    expect(declared.xAxis!.anchors).toBe(2);
    expect(declared.yAxes![0].unit).toBe('rpm');
    expect(axisToValue(declared.xAxis!, PLOT.x0)).toBe(0);
    expect(axisToValue(declared.xAxis!, PLOT.x1)).toBe(300);
    expect(axisToValue(declared.yAxes![0], PLOT.y0)).toBe(0);
    expect(axisToValue(declared.yAxes![0], PLOT.y1)).toBeCloseTo(2000, 6);

    const sampled = sampleSeries(clusterSeries(classes.data, PLOT), declared, 40);
    expect(sampled).toHaveLength(2);
    expect(sampled.find((entry) => entry.series.includes('#ff0000'))!.samples).toHaveLength(40);
  });

  it('refuses an empty declared range', () => {
    const declared = calibrateAxesDeclared({ min: 5, max: 5 }, { min: 0, max: 1 }, PLOT);
    expect(declared.ok).toBe(false);
    expect(declared.reason).toMatch(/declared x axis range is empty/);
  });
});

// --- plot box fixtures: a chart whose plot rectangle is known in chart space --
// The frame is implied by four/six interior gridlines, one spacing inside it, as
// on the measured sheet. Chart space is x right, y up (stage 0 output).
const CHART: BBox = { x0: 100, y0: 100, x1: 500, y1: 400 };
const CHART_GRID_X = [160, 220, 280, 340, 400, 440];
const CHART_GRID_Y = [160, 220, 280, 340];
const CHART_SPACING = 60;
const CHART_PEAK_Y = 376; // 0.92 of the 100..400 y span
const MEDIA_WIDTH = 612;

/** One colour's polylines, in chart space. */
interface StrokeSpec {
  colour: string;
  polylines: [number, number][][];
}

/** @returns `#rrggbb` as PDF `RG` operands. */
function rgbOperands(colour: string): string {
  const hex = colour.slice(1);
  return [0, 2, 4].map((index) => (parseInt(hex.slice(index, index + 2), 16) / 255).toFixed(3)).join(' ');
}

/**
 * @param strokes Polylines in chart space.
 * @param rotate Emit for a `/Rotate 90` page: chart x becomes page y, chart y becomes `MEDIA_WIDTH - page x`.
 * @returns A PDF content stream that draws the strokes.
 */
function chartStream(strokes: StrokeSpec[], rotate = false): string {
  const toPage = (x: number, y: number): [number, number] => (rotate ? [MEDIA_WIDTH - y, x] : [x, y]);
  const lines: string[] = [];
  for (const stroke of strokes) {
    lines.push(`${rgbOperands(stroke.colour)} RG 1 w`);
    for (const polyline of stroke.polylines) {
      const ops = polyline.map(([x, y], index) => {
        const [px, py] = toPage(x, y);
        return `${px} ${py} ${index === 0 ? 'm' : 'l'}`;
      });
      lines.push(`${ops.join(' ')} S`);
    }
  }
  return lines.join('\n');
}

/** Interior gridlines, a title block far above the plot, a legend row and one 0.92 curve. */
function plotChartStrokes(): StrokeSpec[] {
  const gridlines: [number, number][][] = [
    ...CHART_GRID_Y.map((y): [number, number][] => [[CHART.x0, y], [CHART.x1, y]]),
    ...CHART_GRID_X.map((x): [number, number][] => [[x, CHART.y0], [x, CHART.y1]]),
  ];
  // Title block corner, 120 pt across and 60 pt tall: short on both axes.
  const titleBlock: [number, number][][] = [[[100, 640], [220, 640], [220, 700]]];
  // Legend row: 50 pt zigzag strips (no axis-aligned segment, so they classify as data).
  const legendColours = ['#000000', '#ff0000', '#006500', '#00ffff', '#0000ff'];
  const legend = legendColours.map((_, index): StrokeSpec => {
    const x = 120 + index * 21;
    return {
      colour: legendColours[index],
      polylines: [[[x, 560], [x + 6, 570], [x, 580], [x + 6, 590], [x, 600], [x + 6, 610]]],
    };
  });
  // No axis-aligned segment, so the curve classifies as data, not as frame.
  const curve: StrokeSpec = {
    colour: '#0000ff',
    polylines: [[[CHART.x0, 127], [200, 300], [300, CHART_PEAK_Y], [400, 375], [CHART.x1, 374]]],
  };
  return [
    { colour: '#000000', polylines: gridlines },
    { colour: '#000000', polylines: titleBlock },
    ...legend,
    curve,
  ];
}

/** @returns `extractChartData` on the plot fixture with a declared 0-400 x and 0-1 y axis. */
async function extractPlotChart(rotate = false): Promise<ChartExtraction> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starn-chart-box-'));
  const file = path.join(dir, 'plot.pdf');
  fs.writeFileSync(file, vectorPdf(chartStream(plotChartStrokes(), rotate), rotate ? 90 : 0));
  try {
    return await extractChartData(file, { axes: { x: { min: 0, max: 400 }, y: { min: 0, max: 1 } } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** @returns A 2-point path spanning the given bbox. */
function segment(x0: number, y0: number, x1: number, y1: number): DrawingPath {
  return {
    points: [{ x: x0, y: y0 }, { x: x1, y: y1 }],
    closed: false,
    style: { stroke: '#000000', dash: [], lineWidth: 0.06 },
    bbox: { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) },
  };
}

describe('plot box — the axis frame, not the page paths', () => {
  it('measures the frame one gridline spacing outside the gridlines', () => {
    // Measured sheet: 9 horizontals (y 294-601, 279 pt wide) and 9 verticals (x 153-376, 382 pt tall).
    const horizontals = [294.35, 332.39, 371.45, 409.49, 447.53, 485.57, 523.61, 562.61, 600.65];
    const verticals = [152.94, 180.96, 208.98, 236.94, 264.96, 291.96, 319.98, 347.94, 375.96];
    const paths = [
      ...horizontals.map((y) => segment(124.98, y, 403.98, y)),
      ...verticals.map((x) => segment(x, 256.31, x, 638.75)),
      ...horizontals.map((y) => segment(124.98, y, 403.98, y)), // each gridline is painted twice
    ];

    const frame = axisFrameBox(paths, { x0: 0, y0: 0, x1: 595, y1: 842 });

    expect(frame).not.toBeNull();
    expect(frame!.box.x0).toBeCloseTo(124.98, 0);
    expect(frame!.box.x1).toBeCloseTo(403.98, 0);
    expect(frame!.box.y0).toBeCloseTo(256.31, 0);
    expect(frame!.box.y1).toBeCloseTo(638.75, 0);
    expect(frame!.spacingX).toBeCloseTo(28.02, 1);
    expect(frame!.spacingY).toBeCloseTo(38.04, 1);
  });

  it('returns null when the page has no long lines', () => {
    expect(axisFrameBox([segment(0, 0, 10, 0)], { x0: 0, y0: 0, x1: 612, y1: 792 })).toBeNull();
  });

  it('keeps the plot rectangle when a title block sits far above the plot', async () => {
    const result = await extractPlotChart();

    expect(result.calibration.ok).toBe(true);
    expect(result.calibration.yAxes![0].coordMin).toBe(CHART.y0);
    expect(result.calibration.yAxes![0].coordMax).toBe(CHART.y1);
    // Only the curve survives: gridlines and title block are frame, legend strips are excluded.
    expect(result.series).toHaveLength(1);
    const ys = result.series[0].samples.map((sample) => sample.y);
    expect(Math.max(...ys)).toBeCloseTo(0.92, 2);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0.08);
    expect(result.notes.join(' ')).toMatch(/axis frame/);
    expect(result.notes.join(' ')).toMatch(/grid spacing/);
  });

  it('applies the page rotation before measuring the frame', async () => {
    const result = await extractPlotChart(true);

    expect(result.calibration.yAxes![0].coordMin).toBe(CHART.y0);
    expect(result.calibration.yAxes![0].coordMax).toBe(CHART.y1);
    expect(result.series).toHaveLength(1);
    expect(Math.max(...result.series[0].samples.map((sample) => sample.y))).toBeCloseTo(0.92, 2);
  });
});

describe('chart space — page rotation', () => {
  it('turns a /Rotate 90 page into x right, y up', () => {
    // Measured on the reference sheet: viewport transform [0,1,1,0,0,0], height 595.
    const matrix = chartSpaceMatrix([0, 1, 1, 0, 0, 0], 595);
    const toChart = (x: number, y: number): { x: number; y: number } => ({
      x: matrix[0] * x + matrix[2] * y + matrix[4],
      y: matrix[1] * x + matrix[3] * y + matrix[5],
    });

    expect(toChart(404, 300)).toEqual({ x: 300, y: 191 });
    expect(toChart(125, 256)).toEqual({ x: 256, y: 470 });
    // An unrotated page keeps page space as it is.
    expect(chartSpaceMatrix([1, 0, 0, -1, 0, 792], 792)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('legend band exclusion', () => {
  it('drops the swatch row and keeps the curves', () => {
    const { paths } = legendRow();
    const curve = segment(100, 100, 500, 400);
    const band: BBox = { x0: 0, y0: SWATCH_Y0 - 5, x1: 612, y1: SWATCH_Y0 + 55 };

    const kept = withoutLegendBand([...paths, curve], band);

    expect(kept).toEqual([curve]);
    expect(withoutLegendBand([...paths, curve], null)).toHaveLength(6);
  });
});
