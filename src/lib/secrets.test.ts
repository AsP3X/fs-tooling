import { describe, expect, it } from 'vitest';
import { maskApiKey } from './secrets';

describe('maskApiKey', () => {
  it('hides all but the last four characters', () => {
    expect(maskApiKey('abcdefghij1234567890')).toBe('••••7890');
  });

  it('returns empty for a blank key', () => {
    expect(maskApiKey('  ')).toBe('');
  });
});
