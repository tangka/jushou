import assert from 'node:assert/strict';
import test from 'node:test';
import { draftEnsureInternals } from './draft-ensure.js';

const target = { title: '标题', fingerprint: 'fingerprint', postType: 'news' as const };

test('published export proof only replaces a failed API with its explicit state', () => {
  const failure = new Error('freepublish -1');
  assert.deepEqual(draftEnsureInternals.publishedProofFallback('exact', target, failure), [target]);
  assert.deepEqual(draftEnsureInternals.publishedProofFallback('absent', target, failure), []);
  assert.throws(() => draftEnsureInternals.publishedProofFallback(undefined, target, failure), /freepublish -1/);
});
