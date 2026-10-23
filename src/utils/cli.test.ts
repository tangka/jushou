import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import { isMain } from './cli.js';

test('bundled remote entry suppresses imported CLI auto-starts', () => {
  const previous = process.env.WOA_BUNDLED_ENTRY;
  process.env.WOA_BUNDLED_ENTRY = '1';
  try {
    assert.equal(isMain(new URL(import.meta.url).href), false);
  } finally {
    if (previous === undefined) delete process.env.WOA_BUNDLED_ENTRY;
    else process.env.WOA_BUNDLED_ENTRY = previous;
  }
});
