#!/usr/bin/env node
// 代码质量硬限制:单个源文件不得超过 MAX 行。被 .githooks/pre-commit 调用,超限即拒绝提交。
// 范围:git 跟踪的 src/ 与 web/src/ 下 .ts/.tsx(不含 node_modules/dist)。
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MAX = 500;
const files = execSync(
  'git ls-files "src/*.ts" "src/**/*.ts" "web/src/*.ts" "web/src/*.tsx" "web/src/**/*.ts" "web/src/**/*.tsx"',
  {
    encoding: 'utf8',
  }
)
  .split('\n')
  .map(s => s.trim())
  .filter(Boolean);

const bad = [];
for (const f of files) {
  let n = 0;
  try {
    n = readFileSync(f, 'utf8').split('\n').length;
  } catch {
    continue;
  }
  if (n > MAX) bad.push([n, f]);
}

if (bad.length) {
  console.error(`\n✗ 单文件行数超限(上限 ${MAX} 行):`);
  for (const [n, f] of bad.sort((a, b) => b[0] - a[0])) console.error(`   ${n}  ${f}`);
  console.error('\n拆分到 500 行以内再提交(职责拆分,别硬截断)。\n');
  process.exit(1);
}
console.log(`✓ 行数检查通过(${files.length} 个源文件,均 ≤ ${MAX} 行)`);
