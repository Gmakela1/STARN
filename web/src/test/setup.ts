import '@testing-library/jest-dom/vitest';

/**
 * jsdom lacks IntersectionObserver/ResizeObserver and real canvas contexts.
 * The React Bits effects (web/src/components/reactbits) rely on both for
 * offscreen pausing and rendering. Stub them so the components mount without
 * crashing; context stubs return null, exercising the no-WebGL fallback path
 * (components render their static/blank state and never throw).
 */
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class StubIntersectionObserver {
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as Record<string, unknown>).ResizeObserver = StubResizeObserver;
}
if (typeof globalThis.IntersectionObserver === 'undefined') {
  (globalThis as Record<string, unknown>).IntersectionObserver = StubIntersectionObserver;
}

// jsdom lacks matchMedia; motion's useReducedMotion and view-level
// prefers-reduced-motion checks both rely on it.
if (typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  });
}

// jsdom's getContext emits "Not implemented" console noise and only returns a
// real context with the optional `canvas` package; force null (same as a
// browser without WebGL2) so tests cover the guard-fallback path.
HTMLCanvasElement.prototype.getContext = () => null;

// jsdom lacks Element.scrollIntoView (chat auto-scroll, tooltips).
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
