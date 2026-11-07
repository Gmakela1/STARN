import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Markdown from './Markdown';

// Regression lock for the 5465782 security fix: the inline-link regex accepts
// any scheme but the href only becomes a real anchor for the allowlist
// (https/http/mailto). javascript: and data: payloads must render as inert
// text — the visible link text stays, but no <a> is emitted.
describe('Markdown link scheme allowlist', () => {
  it('renders https:// links as anchors', () => {
    render(<Markdown content="[Example](https://example.com)" />);
    const link = screen.getByRole('link', { name: 'Example' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders http:// links as anchors', () => {
    render(<Markdown content="[HTTP](http://example.com)" />);
    const link = screen.getByRole('link', { name: 'HTTP' });
    expect(link).toHaveAttribute('href', 'http://example.com');
  });

  it('renders mailto: links as anchors', () => {
    render(<Markdown content="[Email](mailto:test@example.com)" />);
    const link = screen.getByRole('link', { name: 'Email' });
    expect(link).toHaveAttribute('href', 'mailto:test@example.com');
  });

  it('renders javascript: links as inert text — no anchor, label preserved', () => {
    render(<Markdown content="[click](javascript:alert(1))" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('click')).toBeInTheDocument();
  });

  it('renders data: links as inert text — no anchor, label preserved', () => {
    render(<Markdown content="[payload](data:text/html,<script>alert(1)</script>)" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('payload')).toBeInTheDocument();
  });

  it('mixes allowed and disallowed links in one paragraph', () => {
    render(<Markdown content="See [docs](https://example.com) or [help](javascript:void(0))" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.com');
    expect(screen.getByText('help')).toBeInTheDocument();
  });
});

// Containment contract: wide tables must scroll horizontally inside the doc
// pane, never expand it (the doc measure is min(100%, 88ch) on `.doc-flow` per
// design §3d.2 — tables keep the full measure width — so this wrapper is what
// stops a table's intrinsic width from resizing the pane split).
describe('Markdown table containment', () => {
  it('wraps rendered tables in an overflow-x-auto scroll container', () => {
    render(<Markdown content={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />);

    const table = screen.getByRole('table');
    const wrapper = table.parentElement as HTMLElement;
    expect(wrapper.className).toContain('overflow-x-auto');
  });
});

// Document presentation v2 (design brief applied): special-section callouts,
// requirement-ID chips, table recipe wrapper, blockquote panel, and the size
// variant prop shared by the doc pane and question panels.
describe('Markdown document presentation v2', () => {
  it('wraps the "Open Questions" H2 section in the amber callout class', () => {
    const { container } = render(<Markdown content={'## Open Questions\n\nAwaiting answers.'} />);
    const callout = container.querySelector('.sf-callout-open-questions');
    expect(callout).not.toBeNull();
    expect(callout!.textContent).toContain('Awaiting answers.');
  });

  it('wraps the "User Answers (Pending Incorporation)" H2 section in the violet callout class', () => {
    const { container } = render(
      <Markdown content={'## User Answers (Pending Incorporation)\n\nSS-3 pending.'} />
    );
    const callout = container.querySelector('.sf-callout-user-answers');
    expect(callout).not.toBeNull();
    expect(callout!.querySelectorAll('.sf-req-chip')).toHaveLength(1);
  });

  it('does not card-wrap non-special H2 sections in panel variant', () => {
    const { container } = render(<Markdown content={'## Normal Section\n\nBody.'} />);
    expect(container.querySelector('.sf-h2-section')).toBeNull();
  });

  it('renders requirement-ID chips for standalone tokens only, never mid-word', () => {
    const { container } = render(
      <Markdown content={'Refs SS-3, BOM-12 and ICD-2.a — but never midword like CLASS3.'} />
    );
    const chips = Array.from(container.querySelectorAll('.sf-req-chip')).map(c => c.textContent);
    expect(chips).toEqual(['SS-3', 'BOM-12', 'ICD-2.a']);
  });

  it('marks a "**BLUF:**" bold-lead paragraph as the recommendation callout (brass, Target icon, label)', () => {
    const { container } = render(<Markdown content={'**BLUF:** Use the 50/50 glycol loop.'} />);
    const callout = container.querySelector('.sf-bluf-callout');
    expect(callout).not.toBeNull();
    // Brief §4.5: lucide Target icon + "Bottom Line Up Front" label above lead.
    expect(callout!.querySelector('.sf-bluf-label svg')).not.toBeNull();
    expect(callout!.querySelector('.sf-bluf-label')!.textContent).toContain('Bottom Line Up Front');
    expect(callout!.querySelector('p')!.textContent).toContain('Use the 50/50 glycol loop.');
  });

  it('renders blockquotes as left-rule obsidian panels', () => {
    const { container } = render(<Markdown content={'> Quoted guidance.'} />);
    expect(container.querySelector('blockquote.sf-quote')).not.toBeNull();
  });

  it('keeps the sf-table-wrap recipe class on the scroll container', () => {
    const { container } = render(<Markdown content={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />);
    const wrapper = container.querySelector('.doc-table-scroll') as HTMLElement;
    expect(wrapper).not.toBeNull();
    // Region semantics + keyboard focus per the brief (§5).
    expect(wrapper.getAttribute('role')).toBe('region');
    expect(wrapper.getAttribute('aria-label')).toBe('Data table — scrolls horizontally');
    expect(wrapper.getAttribute('tabindex')).toBe('0');
  });

  it('does not use position:sticky on table headers (dead through the overflow-x wrapper)', () => {
    const { container } = render(<Markdown content={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />);
    const th = container.querySelector('th') as HTMLElement;
    // Regression lock (critic aa83f169): sticky positioning fails against an
    // overflow-x container, so the thead must not claim it (inline style or
    // class-based). Visual weight comes from CSS bg/border instead.
    expect(th.style.position).not.toBe('sticky');
    expect(th.className).not.toContain('sticky');
    expect(getComputedStyle(th).position).not.toBe('sticky');
  });

  it('renders requirement chips as keyboard-activatable jump buttons', () => {
    render(<Markdown content={'Refs SS-3 in the doc.'} />);
    const chip = screen.getByRole('button', { name: 'Jump to requirement SS-3' });
    expect(chip).toHaveAttribute('tabindex', '0');
    // Enter and Space synthesize a click event (delegated handler jumps).
    const clicks: Event[] = [];
    chip.addEventListener('click', e => clicks.push(e));
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(clicks).toHaveLength(1);
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(clicks).toHaveLength(2);
    // Other keys do not activate.
    chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(clicks).toHaveLength(2);
  });

  it('callout header: icon, label H2 with anchor id, and an item count chip', () => {
    const { container } = render(
      <Markdown content={'## Open Questions\n\n- Q5 contactor rating?\n- Q6 harness gauge?\n\nAwaiting answers.'} />
    );
    const callout = container.querySelector('.sf-callout-open-questions') as HTMLElement;
    const head = callout.querySelector('.sf-callout-head');
    expect(head).not.toBeNull();
    expect(head!.querySelector('svg')).not.toBeNull();
    // H2 keeps the mini-TOC anchor id (slug of the section title).
    const h2 = callout.querySelector('h2');
    expect(h2!.id).toBe('open-questions');
    expect(callout.querySelector('.sf-callout-count')!.textContent).toBe('2');
  });

  it('document variant wraps non-special H2 sections in cards carrying the anchor id', () => {
    const { container } = render(
      <Markdown content={'## System Overview\n\nBody text.'} variant="document" />
    );
    const card = container.querySelector('.sf-h2-section') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.querySelector('h2')!.id).toBe('system-overview');
    expect(card.textContent).toContain('Body text.');
  });

  it('exposes the size variant on the root container (document vs panel)', () => {
    const doc = render(<Markdown content="x" variant="document" />).container.firstChild as HTMLElement;
    expect(doc.className).toContain('doc-prose-document');
    const panel = render(<Markdown content="x" />).container.firstChild as HTMLElement;
    expect(panel.className).toContain('doc-prose-panel');
  });
});