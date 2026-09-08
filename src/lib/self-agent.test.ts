import { describe, expect, it } from 'vitest';
import { detectSelfAgentId } from './self-agent';

describe('detectSelfAgentId', () => {
  it('reads a data attribute', () => {
    document.body.innerHTML = '<div data-current-user-id="17"></div>';
    expect(detectSelfAgentId(window, document)).toBe(17);
  });

  it('reads current_user on window', () => {
    document.body.innerHTML = '';
    const win = { current_user: { id: 4 } } as unknown as Window;
    expect(detectSelfAgentId(win, document)).toBe(4);
  });

  it('ignores missing ids', () => {
    document.body.innerHTML = '';
    expect(detectSelfAgentId(window, document)).toBeNull();
  });

  it('reads a header profile link', () => {
    document.body.innerHTML = '<header><a href="/users/88">me</a></header>';
    expect(detectSelfAgentId(window, document)).toBe(88);
  });

  it('reads current_user id from a bootstrap script', () => {
    document.body.innerHTML = '<script>window.boot={"current_user":{"id":21,"locale":"en"}}</script>';
    expect(detectSelfAgentId(window, document)).toBe(21);
  });
});
