import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { PricingService } from '../../pricing/pricingService';
import { extractCodexToolCallDetail, parseCodexSession } from './parser';

test('Codex custom tool calls populate tool metrics and on-demand detail', async () => {
  const tempRoot = path.join(process.cwd(), '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, 'codex-parser-test-'));
  const filePath = path.join(tempDir, 'rollout.jsonl');
  const records = [
    { timestamp: '2026-07-22T18:02:26.000Z', type: 'session_meta', payload: { cwd: 'C:\\repo' } },
    {
      timestamp: '2026-07-22T18:02:26.100Z',
      type: 'event_msg',
      payload: { type: 'task_started', turn_id: 'turn-1', started_at: 1784743346.1, model_context_window: 200000 }
    },
    {
      timestamp: '2026-07-22T18:02:26.110Z',
      type: 'turn_context',
      payload: { turn_id: 'turn-1', model: 'gpt-test', cwd: 'C:\\repo' }
    },
    {
      timestamp: '2026-07-22T18:02:27.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        call_id: 'call-1',
        name: 'exec',
        input: JSON.stringify({ command: 'echo hi', workdir: 'C:\\repo' }),
        status: 'completed'
      }
    },
    {
      timestamp: '2026-07-22T18:02:27.250Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'call-1',
        output: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: 'world' }
        ]
      }
    },
    {
      timestamp: '2026-07-22T18:02:27.260Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10 } }
      }
    },
    {
      timestamp: '2026-07-22T18:02:28.000Z',
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'turn-1', completed_at: 1784743348, duration_ms: 1900 }
    }
  ];
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n'));

  try {
    const pricing = new PricingService(process.cwd());
    const conversation = await parseCodexSession(filePath, 'session-1', undefined, pricing);
    const request = conversation.requests[0];
    assert.equal(request.toolCallCount, 1);
    assert.equal(request.tools?.length, 1);
    assert.deepEqual(request.tools?.[0], {
      id: 'call-1',
      name: 'exec',
      startedAt: '2026-07-22T18:02:27.000Z',
      inputChars: JSON.stringify({ command: 'echo hi', workdir: 'C:\\repo' }).length,
      inputPreview: 'echo hi',
      outputChars: 11,
      durationMs: 250,
      durationSource: 'derived'
    });

    const detail = await extractCodexToolCallDetail(filePath, 'call-1');
    assert.deepEqual(detail.fields, [
      { key: 'command', value: 'echo hi' },
      { key: 'workdir', value: 'C:\\repo' }
    ]);
    assert.deepEqual(detail.resultExcerpt?.headLines, ['hello', 'world']);
    assert.equal(detail.resultExcerpt?.totalChars, 11);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
