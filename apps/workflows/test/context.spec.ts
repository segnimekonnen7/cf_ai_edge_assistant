import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../src/index';

describe('buildPrompt', () => {
  it('injects system prompts and history', () => {
    const prompt = buildPrompt(
      {
        summary: 'User wants to optimise edge performance.',
        turns: [
          { role: 'user', content: 'How do I set up caching?', ts: 1 },
          { role: 'assistant', content: 'Use Cache API with custom TTL.', ts: 2 },
        ],
      },
      'Any tips for KV design?',
    );

    expect(prompt[0].role).toBe('system');
    expect(prompt.some((item) => item.content.includes('Cloudflare'))).toBe(true);
    expect(prompt.at(-1)?.content).toContain('Any tips');
    expect(prompt.filter((item) => item.role === 'user').length).toBeGreaterThan(0);
  });
});

