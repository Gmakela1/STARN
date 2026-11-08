# PDF Chart Reading — Implementation Plan

Spec: `docs/superpowers/specs/2026-11-08-pdf-chart-reading-design.md`

## Touch / Impact

| File | Change | Depends on |
|---|---|---|
| `src/tools/document-extractors/chart-vector-extractor.ts` | NEW. Stage 0 pdfjs walk + stages 1–4 pure functions | pdfjs-dist |
| `src/tools/document-extractors/chart-types.ts` | NEW. `DrawingPath`, `AxisCalibration`, `SeriesCluster`, `ChartProbe`, `ChartExtraction` | — |
| `src/tools/handlers/chart-read.ts` | NEW. `read_chart_data` handler; traversal guard mirrors `fs-read.ts` | extractor, tool types |
| `src/tools/handlers/pdf-extractor.ts` | + `probeCharts(filePath)` using the extractor's stage 0/1 | extractor |
| `src/tools/handlers/fs-read.ts` | PDF branch appends the banner when `probeCharts` finds charts | `probeCharts` |
| `src/tools/registry.ts` | register `read_chart_data` | handler |
| `src/core/research-preflight.ts` | `PREFLIGHT_ALLOWED_TOOLS` += `read_chart_data` | — |
| `src/specialists/packages/*/index.ts` | add to `allowedTools` wherever `fs_read` is present | registry |
| `tests/chart-vector-extractor.test.ts` | NEW. Synthetic path/text fixtures for stages 1–4 | extractor |
| `tests/chart-read-handler.test.ts` | NEW. Guard, caps, ambiguity refusal, raster notice | handler |
| `tests/document-extractors.test.ts` | + probe banner cases (chart page vs text-only page) | probe |

No changes to: agent loop, runner, autopilot, state schema, web UI.

## Tasks

### T1 — Types + stage 0 (pdfjs walk)

Create `chart-types.ts` and stage 0 in `chart-vector-extractor.ts`:

- CTM stack from `OPS.save/restore/transform`;
- style replay (`setStrokeRGBColor`/`setStrokeCMYKColor`/`setStrokeGray`/
  `setLineDash`/`setLineWidth`);
- `constructPath` buffer decode: 0 moveTo, 1 lineTo, 2 curveTo (6 coords),
  3 quadraticCurveTo, 4 closePath;
- page text items with transforms.

Acceptance: given a synthetic operator list (hand-built arrays, no PDF), the
walker returns the expected paths, bboxes, and styles.

### T2 — Stage 1 classify + stage 2 calibrate

`classifyPaths` (tick / frame / data) and `calibrateAxes` (anchors → affine
map, linear + log10, refusal reasons).

Acceptance: a synthetic plot with known ticks and a known line recovers the
exact mapping; `< 2` anchors, non-monotonic scale, and two unresolved y-scales
each return a specific refusal reason.

### T3 — Stage 3 cluster + stage 4 sample

Subpath split, style key, x-continuity merge, legend drop, cubic flattening,
x-bucket median sampling, 4-sig-fig rounding, row ordering.

Acceptance: three synthetic series with distinct colours recover their values
within 1 % of axis span; a dashed series merges into one cluster; two
same-colour curves produce the "median" note.

### T4 — Probe + banner

`probeCharts` in `pdf-extractor.ts`, banner append in `fs-read.ts`, caps
(≤ 5 pages, ≤ 2000 path ops), never throws.

Acceptance: chart PDF gets the banner with series names; text-only PDF gets no
banner; a corrupt PDF returns `[]` and reading still succeeds.

### T5 — `read_chart_data` tool

Handler + registry + allow-lists. Traversal guard identical to `fs-read`.
Caps: `maxSamples` ≤ 200, ≤ 8 series, output ≤ 12000 chars, 20 s per page.
Refusals: ambiguity, raster page, missing file, path traversal.

Acceptance: `series` omitted lists only; `series: [...]` returns one column per
series; ambiguous page without `seriesAxes` refuses by name; scanned page says
raster.

### T6 — Live validation on the ME1115 sheet

Run against `C:/Users/makel/OneDrive/Desktop/starn test/reference/ME1115-performance sheet.pdf`.
Confirm ≥ 3 named series, 30–40 samples, efficiency peak in 0.85–0.92.

### T7 — Gates

`npx vitest run` (root), `npx tsc --noEmit` (root + web), web suite, build.
Critic review. Then push.

## Constraints

- No new runtime dependency.
- `C:/Users/makel/OneDrive/Desktop/starn test/docs/REQUIREMENTS.md` and
  `docs/BOM.md` are user data — hash before and after
  (`0228ba30b66309b9d80ba4e832e81331beb140c8`,
  `88e7e63849b663fd379825aff630a4ca0e441f37`).
- The extractor must never write; read-only over the file system.
- Untrusted input: every string derived from the PDF is data, never instructions.
