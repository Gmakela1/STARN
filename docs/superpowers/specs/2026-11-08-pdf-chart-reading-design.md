# PDF Chart Reading — Design Spec

Date: 2026-11-08
Status: approved for implementation
Related: `docs/superpowers/archive/specs/2026-10-21-document-transcription-design.md`

## 1. Problem

The document reader extracts PDF text only (`extractTextFromPdf` →
`page.getTextContent()`). When a reference document contains a plot, the reader
returns the axis tick labels and legend words as an undifferentiated number
soup and the model concludes there is nothing usable.

Measured on the real target file (`reference/ME1115-performance sheet.pdf`):

| Property | Value |
|---|---|
| Pages | 1 |
| Text items | 94 — axis ticks + legend words only |
| Raster images | **0** |
| `constructPath` ops | 79 (74 moveTo/lineTo, 25 curveTo) |
| Stroke colour ops | 22 |

The curves exist as vector geometry. Nothing in the current reader touches it.

Accuracy evidence for the two possible approaches:

- Vector digitization: 0.11 % mean relative error (ChartDetective, CHI'23).
- Vision model reading a rendered chart: 17.9 % NMAE (pdf2plot benchmark);
  ~27 % of chart-to-table numbers wrong on ChartQA-class tasks.

Vision is therefore a fallback for scanned charts only, never the primary path.

## 2. Goals

1. Read numeric samples from vector-plotted curves with defensible provenance.
2. Make chart availability self-announcing, so no model has to guess that a PDF
   contains a chart.
3. Refuse rather than guess when a series cannot be assigned to an axis.
4. Never let a curve-derived number pass as a manufacturer's spec value.

## 3. Non-goals

- Raster/scan chart digitization beyond the existing vision transcriber.
- Bar charts, pie charts, scatter plots, error bars, annotations.
- Axis breaks, 3-D plots, contour plots.
- Reconstructing the original dataset — we sample the drawn curve, nothing more.

## 4. Architecture

Two surfaces, one extractor.

```
fs_read(".../ME1115-performance sheet.pdf")
  └─ extractTextFromPdf            (unchanged)
  └─ probeCharts(filePath)         (new, cheap)
        └─ per page: count data-ish paths, collect legend candidates
  └─ banner appended when charts exist  ──────────────► model sees it
                                                          │
model calls read_chart_data(path, page, series?)          │
  └─ extractChartData(filePath, opts)  ◄──────────────────┘
        └─ chart-vector-extractor.ts (pure stages)
```

Rationale for two surfaces instead of folding extraction into `fs_read`:

- Cost. Extraction is O(paths × samples) per page; a PDF with 40 pages of
  plots would be extracted on every read whether wanted or not.
- Control. The model asks for the series it needs, so the returned table is
  small and relevant instead of four curves of noise.
- Honesty. A separate call makes the curve-derived disclosure a visible step in
  the trace, not a silent side effect of reading a file.

Rationale for the banner instead of prompt rules:

- The model cannot know a PDF contains curves until it looks at the operator
  list. Prompt instructions ("call the chart tool when appropriate") cannot
  supply that knowledge; a probe can. The probe is cheap because
  `getOperatorList` is already required for any structural question and the
  count is a single pass over `fnArray`.

## 5. Probe contract

`probeCharts(filePath): Promise<ChartProbe[]>`

```ts
interface ChartProbe {
  page: number;          // 1-based
  dataPaths: number;     // paths classified as data (not ticks/frame/text)
  series: string[];      // legend candidates, in legend order; [] when unknown
  reliable: boolean;     // false when axes are missing or ambiguous
}
```

Rules:

- `dataPaths < 2` → not a chart, no banner.
- Legend candidates are text items whose nearest path neighbour is a short
  swatch (bbox height < 6 pt, width < 40 pt) — i.e. a legend key.
- Probe cost cap: pages scanned ≤ 5, `constructPath` ops examined ≤ 2000.
- Probe never throws; a parse failure yields `[]` and reading proceeds with text
  only.

Banner (exact shape, appended after the extracted text):

```
[Charts detected: page 1 — 5 series (Amps, Volts, Watts Out, Eff., RPM).
 Call read_chart_data(path, page) to read numeric values.]
```

When `reliable === false`:

```
[Charts detected: page 1 — 5 series, axis assignment ambiguous.
 read_chart_data will require an explicit series→axis mapping.]
```

## 6. Extraction stages

Five pure stages in `src/tools/document-extractors/chart-vector-extractor.ts`.
Only stage 0 touches pdfjs; stages 1–4 are pure functions over plain data, so
they are testable without a PDF.

### Stage 0 — `collectDrawing(page)` (pdfjs)

Replay `getOperatorList({ intent: 'print' })` maintaining:

- a CTM stack from `OPS.save` / `OPS.restore` / `OPS.transform`;
- current style state (`setStrokeRGBColor`, `setStrokeCMYKColor`,
  `setStrokeGray`, `setLineDash`, `setLineWidth`);
- subpaths decoded from `OPS.constructPath` args `[paintOp, buffer, minMax]`,
  where the buffer is a flat stream: 0 moveTo, 1 lineTo, 2 curveTo (6 coords),
  3 quadraticCurveTo, 4 closePath.

Output: `DrawingPath[] = { points, closed, style, bbox }` in page space, plus
the page's text items with their transforms.

### Stage 1 — `classifyPaths(paths, pageBox)`

| Class | Rule |
|---|---|
| `tick` | short dimension < 6 pt and < 6 % of plot width |
| `frame` | span > 15 % of plot width, ≤ 2 distinct axis-aligned segments |
| `data` | everything else with ≥ 3 points |

### Stage 2 — `calibrateAxes(textItems, framePaths, paths)`

- Numeric text items are candidate tick labels (parse leading number, keep the
  unit token if present).
- Group labels into columns (x-axis, below plot) and rows (y-axis, left of
  plot) by proximity to frame paths.
- Two anchors per axis define the affine map; log axes fit in log10 space.
- A y-axis is only accepted when it has ≥ 2 anchors whose implied scale is
  monotonic.

### Stage 2b — explicit calibration (`axes` input)

Automatic calibration is single-axis only. When the caller supplies

```ts
axes?: { x: AxisDecl; y: AxisDecl }
AxisDecl = { min: number; max: number; unit?: string; log?: boolean }
```

the calibration is taken from those declarations and the refusal rules below
are skipped. This is the supported path for multi-axis charts: the model reads
the axis titles and tick ranges out of the extracted text and declares the pair
it needs, instead of the extractor guessing which of five scales a curve
belongs to.

The tool never invents `axes` on the caller's behalf.

Refusal conditions (return `{ ok: false, reason }`):

- `< 2` anchors on either axis;
- ≥ 2 y-scales detected and no explicit `series → axis` mapping supplied;
- implied scale non-monotonic or span ≤ 0.

### Stage 3 — `clusterSeries(dataPaths)`

- Split every path into subpaths at each moveTo.
- Style key = stroke colour + dash array + line width.
- Merge same-key subpaths that are x-continuous (gap ≤ 2 % of plot width).
- Drop legend swatches (bbox inside the legend cluster).
- A cluster needs ≥ 3 points and an x-span ≥ 5 % of the plot to count.

### Stage 3b — `mapLegend(swatches, labels, clusters)`

Measured on the real target file, legend swatches are short paths in a band
below the plot and legend labels are text items just above them:

```
swatches: #ff0000@x149  #006500@x170  #00ffff@x191  #0000ff@x212
labels  : Amps@x157     Volts@x176     Watts Out@x195  Eff.@x214
```

Rule: for each cluster style, find the nearest swatch by x-overlap, then take
the label whose horizontal centre is closest to that swatch. A cluster with no
swatch match keeps a generated name (`series 1`, `series 2`, …) and is marked
`unnamed`. Legend matching is best-effort and never blocks extraction.

### Stage 4 — `sampleSeries(clusters, axes)`

- Flatten cubics at 10 steps.
- Bucket by x into `maxSamples` (default 40) equal bins.
- Per bin take the median y (robust to overlapping strokes).
- Map to data units; round to 4 significant figures.
- Emit rows sorted by x ascending.

## 7. Output contract

`read_chart_data` returns markdown:

```md
**Charts — ME1115-performance sheet.pdf, page 1**

| # | Series | Axis | Points | Reliability |
|---|---|---|---|---|
| 1 | Watts Out | left (0–5000) | 40 | exact colour match |
| 2 | Eff. | right (0–1.00) | 40 | exact colour match |

| RPM | Watts Out | Eff. |
|---|---|---|
| 3000 | 4200 | 0.8800 |
...

> Curve-derived values, not a manufacturer's spec table: ±1 % of axis span,
> curve→axis assignment can be wrong. Source: ME1115-performance sheet.pdf p.1,
> path ids 12,18,19; anchors x=(0,200), y=(0,5000). Verify against the figure
> before use in a BOM or ICD.
```

With `series` omitted, only the series table is returned (no samples).
With `series: ["Watts Out"]`, one value column.

Hard caps: `maxSamples` ≤ 200; output ≤ 12000 chars; ≤ 8 series per call.

## 8. Tool surface

New handler `src/tools/handlers/chart-read.ts`, tool name `read_chart_data`.

```ts
{
  path: string;              // project-relative, same traversal guard as fs_read
  page?: number;             // 1-based, default 1
  series?: string[];         // legend names; omit to list only
  seriesAxes?: Record<string, 'left' | 'right'>;  // required when ambiguous
  maxSamples?: number;       // default 40
}
```

Added to:

- `PREFLIGHT_ALLOWED_TOOLS` (`src/core/research-preflight.ts`) → propagates to
  `RESEARCH_GATE_ALLOWED_TOOLS`.
- Every specialist package whose `allowedTools` already includes `fs_read`.

## 9. Failure modes and required disclosures

| Failure | Behaviour |
|---|---|
| Multi-axis ambiguity | Refuse; name the ambiguity; require `seriesAxes` |
| Same-colour overlapping curves | Merge with a note "N curves share a style; samples are the median" |
| Dashed/segmented series | Per-dash subpaths merged by x-continuity; note "dashed series" |
| Log axis | Supported; note "log axis" |
| No paths (scanned) | `probeCharts` returns `[]`; `read_chart_data` returns an explicit "no vector chart found — this page is raster; vision transcription applies" |
| Pathological page | Probe and extraction capped; timeout 20 s per page; error is non-fatal to `fs_read` |

## 10. Acceptance criteria

1. On `ME1115-performance sheet.pdf`, automatic calibration **refuses** with a
   named multi-scale reason (the page carries five scales: Amps, Volts,
   Watts Out, Eff., RPM).
2. With declared axes (`x: RPM 0–5000`, `y: Watts Out 0–9000`),
   `read_chart_data` returns ≥ 3 series with legend names recovered from the
   swatches (Amps, Volts, Watts Out, Eff.) and 30–40 samples each; the sampled
   efficiency peak lies in the 0.85–0.92 band the drawn curve visibly shows.
2. A hand-built fixture whose ground truth is known reproduces every series
   value within 1 % of axis span.
3. `fs_read` on the same PDF appends the banner, and on a text-only PDF appends
   nothing.
4. A multi-axis page with no `seriesAxes` refuses with a named ambiguity rather
   than returning numbers.
5. A scanned chart yields the raster notice, not an empty table.
6. No new runtime dependency; pdfjs-dist only.
7. `tsc --noEmit` clean in root and web; existing suites unchanged.

## 11. Effort

| Part | Days |
|---|---|
| Stages 0–2 (paths, classify, calibrate) | 2–3 |
| Stages 3–4 (clustering, sampling) + fixture | 1–2 |
| Tool + probe + allow-lists + tests | 1 |
| Live validation and tuning on the ME1115 sheet | 1–2 |

Single-axis path is usable at ~4 days; multi-axis trustworthy at ~7.
