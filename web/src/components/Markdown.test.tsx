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
// pane, never expand it (DevelopmentView keeps max-w-[72ch] only for table-free
// docs, so this wrapper is what stops a table's intrinsic width from
// resizing the pane split).
describe('Markdown table containment', () => {
  it('wraps rendered tables in an overflow-x-auto scroll container', () => {
    render(<Markdown content={'| A | B |\n| --- | --- |\n| 1 | 2 |'} />);

    const table = screen.getByRole('table');
    const wrapper = table.parentElement as HTMLElement;
    expect(wrapper.className).toContain('overflow-x-auto');
  });
});