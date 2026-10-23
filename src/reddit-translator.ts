import { Codex } from '@openai/codex-sdk';

type TranslationThread = {
  run(input: string, options: { outputSchema: unknown; signal: AbortSignal }): Promise<{ finalResponse: string }>;
};

type TranslationCodex = {
  startThread(options: Record<string, unknown>): TranslationThread;
};

export interface RedditTranslationOptions {
  codex?: TranslationCodex;
  model?: string;
  timeoutMs?: number;
  workingDirectory?: string;
}

export const DEFAULT_REDDIT_TRANSLATION_MODEL = 'gpt-5.6-luna';
export const DEFAULT_REDDIT_TRANSLATION_TIMEOUT_MS = 120_000;

export function redditTranslationOutputSchema(segmentCount: number): unknown {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['translations'],
    properties: {
      translations: {
        type: 'array',
        minItems: segmentCount,
        maxItems: segmentCount,
        items: { type: 'string', minLength: 1 },
      },
    },
  };
}

export function buildRedditTranslationPrompt(segments: string[]): string {
  return [
    'Translate every Reddit material segment into natural Simplified Chinese.',
    'Return one translation for each input segment in the same order.',
    'Preserve meaning, URLs, usernames, product names, model names, code, numbers, and segment boundaries.',
    'Leave established technical terms such as Codex, ChatGPT, token, API, and model names unchanged when appropriate.',
    'Do not summarize, omit text, add commentary, or use tools.',
    'Input segments:',
    JSON.stringify(segments),
  ].join('\n');
}

function validateTranslations(value: unknown, expectedCount: number): string[] {
  const translations = (value as { translations?: unknown })?.translations;
  if (!Array.isArray(translations) || translations.length !== expectedCount) {
    const actual = Array.isArray(translations) ? translations.length : 0;
    throw new Error(`Codex Reddit 翻译段数不匹配: ${actual}/${expectedCount}`);
  }
  if (!translations.every(item => typeof item === 'string' && item.trim().length > 0)) {
    throw new Error('Codex Reddit 翻译包含空段落');
  }
  return translations.map(item => item.trim());
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function translateRedditSegments(
  segments: string[],
  options: RedditTranslationOptions = {}
): Promise<string[]> {
  if (segments.length === 0) return [];
  if (!segments.every(segment => typeof segment === 'string' && segment.trim().length > 0)) {
    throw new Error('Codex Reddit 翻译输入包含空段落');
  }

  const codex =
    options.codex ??
    new Codex({
      codexPathOverride: process.env.REDDIT_CODEX_CLI_PATH?.trim() || undefined,
    });
  const model = options.model?.trim() || DEFAULT_REDDIT_TRANSLATION_MODEL;
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_REDDIT_TRANSLATION_TIMEOUT_MS);
  const abortController = new AbortController();
  const timeoutError = new Error(`Codex Reddit 翻译超时 (${timeoutMs}ms)`);
  const timeout = setTimeout(() => abortController.abort(timeoutError), timeoutMs);
  timeout.unref();

  try {
    const turn = await codex
      .startThread({
        workingDirectory: options.workingDirectory ?? process.cwd(),
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        networkAccessEnabled: false,
        webSearchMode: 'disabled',
        skipGitRepoCheck: true,
        modelReasoningEffort: 'low',
        model,
      })
      .run(buildRedditTranslationPrompt(segments), {
        outputSchema: redditTranslationOutputSchema(segments.length),
        signal: abortController.signal,
      });
    return validateTranslations(JSON.parse(turn.finalResponse), segments.length);
  } catch (error) {
    if (abortController.signal.aborted) throw timeoutError;
    if (error instanceof SyntaxError) throw new Error('Codex Reddit 翻译返回了无效 JSON');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
