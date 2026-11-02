import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoFetchPage } from '../demo/demo-fetch-page.js';
import { criarFetchPage } from './criar-fetch-page.js';
import { fetchPage } from './fetch-page.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('criarFetchPage', () => {
  it('usa o fetchPage real quando DEMO não está definida', () => {
    vi.stubEnv('DEMO', '');
    expect(criarFetchPage()).toBe(fetchPage);
  });

  it('usa as fixtures quando DEMO=true', () => {
    vi.stubEnv('DEMO', 'true');
    expect(criarFetchPage()).toBe(demoFetchPage);
  });

  it('só liga com o valor exato "true"', () => {
    vi.stubEnv('DEMO', '1');
    expect(criarFetchPage()).toBe(fetchPage);
  });
});
