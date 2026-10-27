import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

/**
 * Shared render helper for web component tests.
 * Returns the RTL render result plus a `user` instance wired to the same
 * document, so tests don't have to call `userEvent.setup()` per interaction.
 */
export function renderWithUser(ui: ReactElement) {
  const user = userEvent.setup();
  return { user, ...render(ui) };
}

export { cleanup };