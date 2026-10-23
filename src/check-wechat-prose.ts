import process from 'node:process';
import { runCli } from './utils/cli.js';
import { inspectHumanWritingDraft } from './wechat/human-writing-checker.js';
import { buildProsePatternReviewTemplate, collectProsePatternReviewErrors } from './wechat/prose-pattern-review.js';
import { formatProseFindings } from './wechat/prose-patterns.js';

runCli(async () => {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const markdownPath = args[0];
  if (args.length !== 1 || !markdownPath) throw new Error('用法：pnpm check-prose -- <主 Markdown 路径>');
  const inspection = await inspectHumanWritingDraft(markdownPath);
  console.log(inspection.stdout);
  if (inspection.proseFindings.length) {
    console.log(formatProseFindings(inspection.proseFindings));
    const errors = await collectProsePatternReviewErrors(markdownPath, inspection);
    if (errors.length) {
      console.log('未审模板（不会写入文件；pending 不能放行）：');
      console.log(JSON.stringify(buildProsePatternReviewTemplate(inspection), null, 2));
      throw new Error(errors.join('\n'));
    }
    console.log('表达提醒已与当前逐处复核记录核对。');
  }
  console.log('仅完成可检测形状检查；零命中不证明文风、事实或来源合格，上传仍执行完整门禁。');
});
