import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_USAGE, PromptRequest } from '../../domain/types';
import { copilotContextStatus } from './parser';

function request(inputTokens: number, modelContextWindow?: number): PromptRequest {
  return {
    id: 'request',
    index: 0,
    startedAt: '2026-07-20T00:00:00.000Z',
    model: 'gpt-test',
    usage: { ...EMPTY_USAGE, inputTokens },
    cost: { usd: 0.001, source: 'estimated' },
    toolCallCount: 0,
    modelContextWindow
  };
}

test('copilotContextStatus derives the last recorded request occupancy', () => {
  const status = copilotContextStatus([request(10), request(32_000, 128_000)], 'C:\\work');
  assert.deepEqual(status?.context, {
    workspacePath: 'C:\\work',
    model: 'gpt-test',
    modelContextWindow: 128_000,
    contextUsedTokens: 32_000,
    contextAvailableTokens: 96_000,
    contextFillPercent: 25
  });
});

test('copilotContextStatus leaves unavailable values absent', () => {
  assert.equal(copilotContextStatus([], 'C:\\work'), undefined);
  const status = copilotContextStatus([request(0)], 'C:\\work');
  assert.equal(status?.context?.contextUsedTokens, undefined);
  assert.equal(status?.context?.contextFillPercent, undefined);
});
