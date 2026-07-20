import assert from 'node:assert/strict';
import test from 'node:test';
import { formatUsd } from './format';

test('formatUsd keeps ordinary dollar values at two decimals', () => {
  assert.equal(formatUsd(undefined), 'n/a');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(1.234), '$1.23');
  assert.equal(formatUsd(0.01), '$0.01');
});

test('formatUsd does not display a positive sub-cent estimate as zero', () => {
  assert.equal(formatUsd(0.0042), '$0.0042');
  assert.equal(formatUsd(0.00042), '$0.00042');
  assert.equal(formatUsd(0.000042), '$0.000042');
  assert.equal(formatUsd(0.0000042), '$0.000004');
  assert.equal(formatUsd(0.0000002), '<$0.000001');
});
