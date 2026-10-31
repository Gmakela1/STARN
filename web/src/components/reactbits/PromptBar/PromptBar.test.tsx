import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { renderWithUser } from '../../../test/render';
import PromptBar from './PromptBar';
import type { LibraryFileEntry } from '../../../types/api';

// STARN wiring tests: inject-directive rows, the 'Upload new document…'
// deep-link row and the 'Attach from repository…' submenu.
const REPO_DOCS: LibraryFileEntry[] = [
  { name: 'ground-truth.md', size: 120, modified: '2025-01-01' },
  { name: 'wiring-notes.md', size: 40, modified: '2025-01-02' }
];

function openPlusMenu(user: UserEvent) {
  return user.click(screen.getByRole('button', { name: 'Add files and sources' }));
}

describe('PromptBar — inject directive rows', () => {
  it('prepends the inject directive to the draft instead of an @-token', async () => {
    const { user } = renderWithUser(
      <PromptBar
        sources={[
          {
            key: 'repo:spec.md',
            name: 'spec.md',
            description: 'reference/ · repository doc',
            inject: 'Use reference/spec.md as the primary reference for this request.'
          }
        ]}
        commands={[]}
        models={[]}
        efforts={[]}
      />
    );

    await openPlusMenu(user);
    await user.click(screen.getByRole('option', { name: /spec\.md/ }));

    const textarea = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Use reference/spec.md as the primary reference for this request. ');
  });
});

describe('PromptBar — upload deep-link row', () => {
  it('__upload row calls onUploadNavigate and closes the menu', async () => {
    const onUploadNavigate = vi.fn();
    const { user } = renderWithUser(
      <PromptBar sources={[]} commands={[]} models={[]} efforts={[]} onUploadNavigate={onUploadNavigate} />
    );

    await openPlusMenu(user);
    await user.click(screen.getByRole('option', { name: /Upload new document…/ }));

    expect(onUploadNavigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('__upload row is absent without the callback', async () => {
    const { user } = renderWithUser(<PromptBar sources={[]} commands={[]} models={[]} efforts={[]} />);
    await openPlusMenu(user);
    expect(screen.queryByRole('option', { name: /Upload new document…/ })).not.toBeInTheDocument();
  });
});

describe('PromptBar — repository attach submenu', () => {
  it('__repo_attach row opens the submenu listing references with inject strings', async () => {
    const { user } = renderWithUser(
      <PromptBar sources={[]} repoDocs={REPO_DOCS} commands={[]} models={[]} efforts={[]} />
    );

    await openPlusMenu(user);
    await user.click(screen.getByRole('option', { name: /Attach from repository…/ }));

    const docRow = await screen.findByRole('option', { name: /ground-truth\.md/ });
    expect(docRow).toHaveTextContent('reference/ · repository doc');
    // Top-level special row is replaced by the submenu rows.
    expect(screen.queryByRole('option', { name: /Attach from repository…/ })).not.toBeInTheDocument();
  });

  it('picking a repository doc writes its directive into the draft', async () => {
    const { user } = renderWithUser(
      <PromptBar sources={[]} repoDocs={REPO_DOCS} commands={[]} models={[]} efforts={[]} />
    );

    await openPlusMenu(user);
    await user.click(screen.getByRole('option', { name: /Attach from repository…/ }));
    await user.click(await screen.findByRole('option', { name: /ground-truth\.md/ }));

    const textarea = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Use reference/ground-truth.md as the primary reference for this request. ');
  });

  it('special rows are absent when repoDocs is empty and no callback given', async () => {
    const { user } = renderWithUser(
      <PromptBar sources={[{ key: 'web', name: 'Web search' }]} commands={[]} models={[]} efforts={[]} />
    );
    await openPlusMenu(user);
    expect(screen.getByRole('option', { name: /Web search/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Attach from repository…/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Upload new document…/ })).not.toBeInTheDocument();
  });
});
