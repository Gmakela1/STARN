import { describe, it, expect } from 'vitest';
import { buildProjectChoices } from '../src/cli/model-settings.js';
import { ProjectRecord } from '../src/workspace/types.js';

describe('buildProjectChoices', () => {
  it('formats project choices with [Active] marker and adds Browse and Cancel options', () => {
    const projects: ProjectRecord[] = [
      { id: 'p1', name: 'Alpha', path: '/path/to/alpha', createdAt: '', lastActiveAt: '' },
      { id: 'p2', name: 'Beta', path: '/path/to/beta', createdAt: '', lastActiveAt: '' }
    ];

    const choices = buildProjectChoices(projects, 'p1');
    expect(choices.length).toBe(4);
    expect(choices[0].name).toContain('Alpha');
    expect(choices[0].name).toContain('[Active]');
    expect(choices[0].value).toBe('p1');

    expect(choices[1].name).toContain('Beta');
    expect(choices[1].name).not.toContain('[Active]');
    expect(choices[1].value).toBe('p2');

    expect(choices[2].value).toBe('BROWSE');
    expect(choices[3].value).toBe('CANCEL');
  });
});
