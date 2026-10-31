/**
 * Requirement-ID doc anchors (design §5.C + §9).
 * Extraction → doc-presence anchoring → block resolution → persistent highlight.
 * False positives (SHA-256, PDF-1.4) degrade to "no highlight" via
 * pickAnchorId, never a wrong scroll.
 */

const REQ_RE = /\b[A-Z]{2,6}(?:-[A-Z0-9]{1,4})?-\d{1,3}(?:\.[a-z0-9]{1,3})?\b/g;

/** Block-level elements eligible for highlighting (never the whole .doc-prose). */
const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,td,tr';

/** Static outline applied while data-studio-anchor is present (shape cue, not color alone). */
const RING_CLASSES = ['ring-2', 'ring-violet-400/70', 'ring-offset-2', 'ring-offset-slate-950'];

/** Extract requirement-looking ids in document order, deduped. */
export function extractRequirementIds(text: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const re = new RegExp(REQ_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (!seen.has(match[0])) {
      seen.add(match[0]);
      ids.push(match[0]);
    }
  }
  return ids;
}

/** First candidate actually present in the doc; null = safe no-match. */
export function pickAnchorId(ids: string[], docContent: string): string | null {
  if (ids.length === 0 || !docContent) return null;
  return ids.find(id => docContent.includes(id)) ?? null;
}

/** Find the block containing id, plus the nearest preceding heading line. */
export function findAnchorBlock(
  content: string,
  id: string,
): { blockText: string; headingText: string | null } | null {
  if (!content || !id) return null;
  const blocks = content.split(/\n\s*\n/);
  let lastHeading: string | null = null;
  for (const block of blocks) {
    const heading = block.match(/^#{1,6}\s+(.*)$/m);
    if (heading) lastHeading = heading[1].trim();
    if (block.includes(id)) {
      return { blockText: block.trim(), headingText: lastHeading };
    }
  }
  return null;
}

interface AnchorState {
  marker: HTMLSpanElement;
  addedClasses: string[];
}

const anchorStates = new WeakMap<HTMLElement, AnchorState>();

/**
 * Scroll to + mark the closest block-level element containing id. The marker
 * persists until clearAnchorHighlight/clearAnchorHighlights is called — callers
 * decide when the highlight dies (doc change, edit, panel close, new focus).
 * Returns the block, or null when nothing contains id.
 */
export function applyAnchorHighlight(root: HTMLElement, id: string): HTMLElement | null {
  if (!root || !id) return null;
  const block = findClosestBlock(root, id);
  if (!block) return null;

  const reduced =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  block.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });

  const addedClasses = ['animate-anchor-flash', ...RING_CLASSES];
  if (!block.classList.contains('relative')) addedClasses.push('relative');
  block.setAttribute('data-studio-anchor', '');
  addedClasses.forEach(c => block.classList.add(c));

  const marker = document.createElement('span');
  marker.setAttribute('data-studio-anchor-marker', '');
  marker.className =
    'absolute right-1 top-1 z-10 rounded bg-violet-950 px-1.5 py-0.5 font-mono text-[10px] leading-none text-violet-200 ring-1 ring-violet-500/40';
  marker.textContent = id;
  block.appendChild(marker);

  anchorStates.set(block, { marker, addedClasses });
  return block;
}

/** Remove the highlight from one element. */
export function clearAnchorHighlight(el: HTMLElement): void {
  const state = anchorStates.get(el);
  if (state) {
    state.marker.remove();
    anchorStates.delete(el);
  }
  el.removeAttribute('data-studio-anchor');
  const classesToRemove = state ? state.addedClasses : ['animate-anchor-flash', ...RING_CLASSES];
  classesToRemove.forEach(c => el.classList.remove(c));
}

/** Clear every active highlight under a container (unmount / doc-change safety). */
export function clearAnchorHighlights(container: HTMLElement): void {
  container.querySelectorAll('[data-studio-anchor]').forEach(el => clearAnchorHighlight(el as HTMLElement));
}

/** Deepest block element whose textContent contains id (never the root container). */
function findClosestBlock(root: HTMLElement, id: string): HTMLElement | null {
  const matches = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && (el.textContent ?? '').includes(id),
  );
  for (const el of matches) {
    // The closest match is the first one that does not contain another match.
    const containsOtherMatch = matches.some(other => other !== el && el.contains(other));
    if (!containsOtherMatch) return el;
  }
  return null;
}
