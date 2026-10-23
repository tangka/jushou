import process from 'node:process';
import { config } from './config/index.js';
import {
  buildRows,
  readDetailEntries,
  writeArticleJsons,
  writeCsv,
  writeDbSnapshots,
  writeOverview,
} from './report.js';

// 离线从各篇 raw.json 重建索引(不抓数据)。带 stats 则含互动数据列 + 回填 SQLite 基线快照。
async function main(): Promise<void> {
  const entries = await readDetailEntries();
  const withStats = entries.some(e => e.stats);
  await writeArticleJsons(entries);

  const snapshots = writeDbSnapshots(entries, Math.floor(Date.now() / 1000));

  const rows = buildRows(entries);
  await writeOverview(rows, withStats);
  await writeCsv(rows, withStats);

  console.log(`INDEX ${config.paths.overview}`);
  console.log(`CSV ${config.paths.richCsv}`);
  console.log(`DB ${config.dbPath} (+${snapshots} 快照)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
