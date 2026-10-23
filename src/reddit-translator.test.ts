import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import {
  buildRedditTranslationPrompt,
  DEFAULT_REDDIT_TRANSLATION_MODEL,
  redditTranslationOutputSchema,
  translateRedditSegments,
} from './reddit-translator.js';

test('Reddit translation defaults to GPT-5.6 Luna in a locked-down Codex thread', async () => {
  const calls: Array<{ type: string; value: unknown }> = [];
  const codex = {
    startThread(options: Record<string, unknown>) {
      calls.push({ type: 'thread', value: options });
      return {
        async run(prompt: string, options: { outputSchema: unknown; signal: AbortSignal }) {
          calls.push({ type: 'turn', value: { prompt, options } });
          return { finalResponse: JSON.stringify({ translations: ['第一段', '第二段'] }) };
        },
      };
    },
  };

  const translated = await translateRedditSegments(['First', 'Second'], {
    codex,
    timeoutMs: 1_000,
    workingDirectory: '/tmp',
  });

  assert.deepEqual(translated, ['第一段', '第二段']);
  assert.deepEqual(calls[0], {
    type: 'thread',
    value: {
      workingDirectory: '/tmp',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
      modelReasoningEffort: 'low',
      model: DEFAULT_REDDIT_TRANSLATION_MODEL,
    },
  });
  const turn = calls[1]?.value as {
    prompt: string;
    options: { outputSchema: unknown; signal: AbortSignal };
  };
  assert.match(turn.prompt, /Translate every Reddit material segment into natural Simplified Chinese/);
  assert.deepEqual(turn.options.outputSchema, redditTranslationOutputSchema(2));
  assert.equal(turn.options.signal.aborted, false);
});

test('Reddit translation allows an explicit model override', async () => {
  let selectedModel: unknown;
  const codex = {
    startThread(options: Record<string, unknown>) {
      selectedModel = options.model;
      return {
        async run() {
          return { finalResponse: JSON.stringify({ translations: ['完成'] }) };
        },
      };
    },
  };

  assert.deepEqual(await translateRedditSegments(['Done'], { codex, model: 'custom-model', timeoutMs: 1_000 }), [
    '完成',
  ]);
  assert.equal(selectedModel, 'custom-model');
});

test('Reddit translation selects the configured CLI and restores the default when removed', async t => {
  const previous = process.env.REDDIT_CODEX_CLI_PATH;
  const commands: string[] = [];
  const mock = t.mock.method(childProcess, 'spawn', (command: string) => {
    commands.push(command);
    throw new Error('offline CLI selection probe');
  });
  syncBuiltinESMExports();
  t.after(() => {
    mock.mock.restore();
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.REDDIT_CODEX_CLI_PATH;
    else process.env.REDDIT_CODEX_CLI_PATH = previous;
  });
  for (const value of [undefined, '  /fixtures/current-codex  ', '', undefined]) {
    if (value === undefined) delete process.env.REDDIT_CODEX_CLI_PATH;
    else process.env.REDDIT_CODEX_CLI_PATH = value;
    await assert.rejects(translateRedditSegments(['First'], { timeoutMs: 1_000 }), /offline CLI selection probe/);
    assert.equal(commands.at(-1), value?.trim() || commands[0]);
  }
  assert.notEqual(commands[0], '/fixtures/current-codex');
});

test('Reddit translation rejects incomplete or invalid structured output', async () => {
  const fakeCodex = (finalResponse: string) => ({
    startThread() {
      return {
        async run() {
          return { finalResponse };
        },
      };
    },
  });

  await assert.rejects(
    translateRedditSegments(['First', 'Second'], {
      codex: fakeCodex(JSON.stringify({ translations: ['第一段'] })),
      timeoutMs: 1_000,
    }),
    /Codex Reddit 翻译段数不匹配: 1\/2/
  );
  await assert.rejects(
    translateRedditSegments(['First'], { codex: fakeCodex('not-json'), timeoutMs: 1_000 }),
    /Codex Reddit 翻译返回了无效 JSON/
  );
  assert.match(buildRedditTranslationPrompt(['Codex token']), /Codex token/);
});
