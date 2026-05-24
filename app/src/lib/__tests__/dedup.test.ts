// Smoke tests for lib/dedup.ts. Exercises:
//   • normalizeName — copy-suffix stripping
//   • hammingDistance — XOR popcount on 8-byte arrays
//   • findDuplicates — Pass 1 (name+size) and the merge step.
//
// We do NOT exercise the perceptual hash here because computeDHash needs
// createImageBitmap, which happy-dom does not implement. Instead we hand
// findDuplicates a `getThumbBlob` that always resolves null — Pass 2 then
// returns no flags and the result is driven entirely by Pass 1.

import { describe, it, expect } from 'vitest';
import {
  findDuplicates,
  hammingDistance,
  normalizeName,
} from '../dedup';
import type { ImageMetadata } from '../../types';

function makeImage(over: Partial<ImageMetadata>): ImageMetadata {
  return {
    path: over.path ?? 'cat/foo.jpg',
    name: over.name ?? 'foo',
    category: over.category ?? 'מפות מפיות',
    kind: over.kind ?? 'image',
    fileType: over.fileType ?? 'jpg',
    sizeBytes: over.sizeBytes ?? 1000,
    modifiedAt: over.modifiedAt ?? 0,
  };
}

describe('normalizeName', () => {
  it('strips trailing copy markers', () => {
    expect(normalizeName('foo (1).jpg')).toBe(normalizeName('foo.jpg'));
    expect(normalizeName('foo - העתק.jpg')).toBe(normalizeName('foo.jpg'));
    expect(normalizeName('foo - copy (2).jpg')).toBe(normalizeName('foo.jpg'));
  });

  it('is NFC + lowercase', () => {
    expect(normalizeName('FOO.JPG')).toBe(normalizeName('foo.jpg'));
  });

  it('does not collapse genuinely different names', () => {
    expect(normalizeName('שולחן זהב')).not.toBe(normalizeName('שולחן כסף'));
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(hammingDistance(a, b)).toBe(0);
  });

  it('counts set bits in the XOR', () => {
    const a = new Uint8Array([0b11110000, 0, 0, 0, 0, 0, 0, 0]);
    const b = new Uint8Array([0b00001111, 0, 0, 0, 0, 0, 0, 0]);
    expect(hammingDistance(a, b)).toBe(8);
  });

  it('returns Infinity on size mismatch', () => {
    expect(hammingDistance(new Uint8Array(7), new Uint8Array(8))).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('findDuplicates (Pass 1 only — no thumbnails)', () => {
  it('groups 3 images sharing a normalized name + size', async () => {
    const a = makeImage({
      path: 'מפות מפיות/שולחן.jpg',
      name: 'שולחן',
      sizeBytes: 1234,
      modifiedAt: 100,
    });
    const b = makeImage({
      path: 'מפות מפיות/שולחן (1).jpg',
      name: 'שולחן (1)',
      sizeBytes: 1234,
      modifiedAt: 200,
    });
    const c = makeImage({
      path: 'מפות מפיות/שולחן - העתק.jpg',
      name: 'שולחן - העתק',
      sizeBytes: 1234,
      modifiedAt: 300,
    });
    const d = makeImage({
      path: 'מפות מפיות/אחר.jpg',
      name: 'אחר',
      sizeBytes: 9999,
      modifiedAt: 400,
    });
    const e = makeImage({
      path: 'מפות מפיות/יחיד.jpg',
      name: 'יחיד',
      sizeBytes: 5555,
      modifiedAt: 500,
    });

    const clusters = await findDuplicates(
      [a, b, c, d, e],
      async () => null, // no thumbnails — Pass 2 contributes nothing
    );

    expect(clusters).toHaveLength(1);
    const cluster = clusters[0]!;
    expect(cluster.reason).toBe('name');
    expect(cluster.canonical.path).toBe(a.path); // earliest modifiedAt
    expect(cluster.duplicates).toHaveLength(2);
    expect(cluster.duplicates.map((x) => x.path).sort()).toEqual(
      [b.path, c.path].sort(),
    );
  });

  it('returns no clusters when there are no duplicates', async () => {
    const items = [
      makeImage({ path: 'a/one.jpg', name: 'one', sizeBytes: 100 }),
      makeImage({ path: 'a/two.jpg', name: 'two', sizeBytes: 200 }),
    ];
    const clusters = await findDuplicates(items, async () => null);
    expect(clusters).toEqual([]);
  });

  it('does NOT cluster on name when sizes differ (different files)', async () => {
    // Same normalized name but different byte sizes — almost certainly
    // different files (e.g. re-export with different quality).
    const a = makeImage({
      path: 'a/foo.jpg',
      name: 'foo',
      sizeBytes: 1000,
      modifiedAt: 1,
    });
    const b = makeImage({
      path: 'b/foo (1).jpg',
      name: 'foo (1)',
      sizeBytes: 2000,
      modifiedAt: 2,
    });
    const clusters = await findDuplicates([a, b], async () => null);
    expect(clusters).toEqual([]);
  });

  it('reports two separate clusters for two independent groups', async () => {
    const items = [
      makeImage({ path: 'g1/a.jpg', name: 'a', sizeBytes: 100, modifiedAt: 1 }),
      makeImage({ path: 'g1/a (1).jpg', name: 'a (1)', sizeBytes: 100, modifiedAt: 2 }),
      makeImage({ path: 'g2/b.jpg', name: 'b', sizeBytes: 200, modifiedAt: 3 }),
      makeImage({ path: 'g2/b - copy.jpg', name: 'b - copy', sizeBytes: 200, modifiedAt: 4 }),
      makeImage({ path: 'unique/c.jpg', name: 'c', sizeBytes: 300, modifiedAt: 5 }),
    ];
    const clusters = await findDuplicates(items, async () => null);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.reason === 'name')).toBe(true);
  });

  it('fires onProgress for every input image', async () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeImage({ path: `x/${i}.jpg`, name: `n${i}`, sizeBytes: 100 + i }),
    );
    const ticks: Array<[number, number]> = [];
    await findDuplicates(items, async () => null, {
      onProgress: (done, total) => {
        ticks.push([done, total]);
      },
    });
    expect(ticks).toHaveLength(items.length);
    expect(ticks[ticks.length - 1]).toEqual([items.length, items.length]);
  });
});
