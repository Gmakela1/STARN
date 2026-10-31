import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DocDiff from './DocDiff';

// The revised-doc diff view: GitHub-style red/green rows, aria + summary line.
describe('DocDiff', () => {
  it('labels the diff region and summarizes added/removed counts', () => {
    render(<DocDiff approved={'a\nb\nc'} current={'a\nb2\nc\nd'} />);
    expect(screen.getByLabelText('Document diff')).toBeInTheDocument();
    expect(screen.getByText('2 lines added, 1 lines removed')).toBeInTheDocument();
  });

  it('renders removed lines with the red row class and +/− markers', () => {
    const { container } = render(<DocDiff approved={'old'} current={'new'} />);
    const removedRow = container.querySelector('.bg-\\[\\#7f1d1d\\]\\/40');
    expect(removedRow).toBeInTheDocument();
    expect(removedRow!.textContent).toContain('−old');
    const addedRow = container.querySelector('.bg-\\[\\#14532d\\]\\/40');
    expect(addedRow).toBeInTheDocument();
    expect(addedRow!.textContent).toContain('+new');
  });

  it('renders identical content with no red/green rows', () => {
    const { container } = render(<DocDiff approved={'same'} current={'same'} />);
    expect(container.querySelector('.bg-\\[\\#7f1d1d\\]\\/40')).toBeNull();
    expect(container.querySelector('.bg-\\[\\#14532d\\]\\/40')).toBeNull();
    expect(screen.getByText('0 lines added, 0 lines removed')).toBeInTheDocument();
  });
});
