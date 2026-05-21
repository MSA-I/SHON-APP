// SOP: .tmp/test-harness-staging.json — three trivial passes that prove the
// harness wires up before #15 layers in real lib smoke tests.

import { describe, it, expect } from 'vitest';

describe('vitest sanity', () => {
  it('runs at all', () => {
    expect(1 + 1).toBe(2);
  });

  it('has fake-indexeddb installed', () => {
    expect(globalThis.indexedDB).toBeDefined();
    expect(typeof indexedDB.open).toBe('function');
  });

  it('happy-dom provides Blob + URL.createObjectURL', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    expect(blob.size).toBe(5);
    const url = URL.createObjectURL(blob);
    expect(url.startsWith('blob:')).toBe(true);
    URL.revokeObjectURL(url);
  });
});
