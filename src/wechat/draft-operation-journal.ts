import fs from 'node:fs/promises';
import path from 'node:path';
import type { JournalStore, ReplacementJournal } from './draft-lifecycle.js';

export const DRAFT_OPERATION_FILE = '.wechat-draft-operation.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJournal(raw: string, journalPath: string): ReplacementJournal {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${DRAFT_OPERATION_FILE} 不是合法 JSON:${journalPath}`);
  }
  if (!isRecord(value) || value.version !== 1 || typeof value.operationId !== 'string' || !value.operationId) {
    throw new Error(`${DRAFT_OPERATION_FILE} 结构异常:${journalPath}`);
  }
  return value as ReplacementJournal;
}

export function createAtomicDraftJournalStore(draftDir: string): JournalStore {
  const journalPath = path.join(draftDir, DRAFT_OPERATION_FILE);
  return {
    load: async operationId => {
      const raw = await fs.readFile(journalPath, 'utf8').catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      });
      if (!raw) return undefined;
      const journal = parseJournal(raw, journalPath);
      return journal.operationId === operationId ? journal : undefined;
    },
    save: async journal => {
      await fs.mkdir(draftDir, { recursive: true });
      const temporaryPath = `${journalPath}.${process.pid}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporaryPath, journalPath);
    },
  };
}
