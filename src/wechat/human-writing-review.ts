import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { readFrontmatterField } from '../utils/frontmatter.js';
import { EDITORIAL_BRIEF_FILE, type EditorialBrief, parseEditorialBrief } from './editorial-quality.js';
import {
  type HumanWritingCheckerOptions,
  type HumanWritingInspection,
  humanWritingSha256,
  inspectHumanWritingDraft,
} from './human-writing-checker.js';

export const HUMAN_WRITING_REVIEW_FILE = 'human-writing-review.json';
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceHashSchema = z.object({ id: z.string().min(1), sourcePath: z.string().min(1), sha256: sha256Schema });
const sourceAuditSchema = z.strictObject({ path: z.string().trim().min(1), sha256: sha256Schema });
export const humanWritingReviewSchema = z.strictObject({
  version: z.literal(1),
  reviewRunId: z.uuid(),
  articleSha256: sha256Schema,
  checkerSha256: sha256Schema,
  briefSha256: sha256Schema,
  sourceHashes: z.array(sourceHashSchema).min(1),
  sourceAudit: sourceAuditSchema.nullable(),
  warnings: z
    .array(
      z.strictObject({
        warning: z.string().min(1),
        decision: z.enum(['retain', 'revise']),
        reason: z
          .string()
          .trim()
          .min(1)
          .refine(reason => !/^(?:已核对|已确认|无问题|没有问题|通过|保留|已检查|已复核)[。！.!]*$/u.test(reason)),
      })
    )
    .min(1),
  issues: z.array(z.string().trim().min(1)),
});

// 只承接当前检查器明确的作者文风类别；引用保真及未来未知类别不在此门禁内。
const AUTHOR_STYLE_WARNING =
  /^- (?:提示性冒号|修辞性破折号或连接号|有 \d+ 处词语需要结合语境判断|对比句式复核|疑似翻案腔变形|三连以上同构排比|模型偏爱的抒情词|名词化句式|连词密度偏高|「」括起的短语|全文 \d+ 个句子长度接近|洞察路标|长前置成分|有 \d+ 个长句包含四个以上的“的”|可识别段落中有|从第 \d+ 行起连续出现|段落开场重复|八百字内出现)/u;

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** 审计路径随草稿搬运，记录相对合同路径；缺失或逃逸必须阻断，不能降为无审计。 */
async function readSourceAudit(draftDir: string, configuredPath: string | undefined) {
  if (!configuredPath) return null;
  const filePath = path.resolve(draftDir, configuredPath);
  if (!inside(draftDir, filePath)) throw new Error('来源审计不能通过路径或符号链接离开当前草稿目录');
  try {
    if (!inside(draftDir, await fs.realpath(filePath))) {
      throw new Error('来源审计不能通过路径或符号链接离开当前草稿目录');
    }
    return {
      filePath,
      record: {
        path: path.relative(draftDir, filePath).split(path.sep).join('/'),
        sha256: humanWritingSha256(await fs.readFile(filePath)),
      },
    };
  } catch (error) {
    throw new Error(`来源审计文件缺失、无法读取或不合法，不能跳过复核：${configuredPath}`, { cause: error });
  }
}

async function loadAutomaticBrief(markdownPath: string) {
  const draftDir = await fs.realpath(path.dirname(markdownPath));
  const markdown = await fs.readFile(markdownPath, 'utf8');
  if (
    !/^(1|true|yes|确认|已确认)$/iu.test(readFrontmatterField(markdown, 'auto_quality_gate')?.trim() ?? '') ||
    readFrontmatterField(markdown, 'editorial_brief') !== EDITORIAL_BRIEF_FILE
  ) {
    throw new Error('独立文风复核只适用于已封装锁任务的非翻译自动稿');
  }
  const briefPath = path.join(draftDir, EDITORIAL_BRIEF_FILE);
  if (!inside(draftDir, await fs.realpath(briefPath))) throw new Error('编辑任务不能通过符号链接离开草稿目录');
  const briefBytes = await fs.readFile(briefPath);
  const brief = parseEditorialBrief(briefBytes.toString('utf8'));
  if (brief.version !== 2 || brief.contentClass === 'translation')
    throw new Error('独立文风复核不适用于翻译或旧版任务');
  return { draftDir, briefPath, briefBytes, brief };
}

/** 只核对记录与本次实际检查一致；字段完整不代表模型真的做过语义判断。 */
export async function collectHumanWritingReviewErrors(
  markdownPath: string,
  inspection: HumanWritingInspection,
  expectedRunId?: string
): Promise<string[]> {
  try {
    if (!inspection.warnings.length || !inspection.warnings.every(item => AUTHOR_STYLE_WARNING.test(item))) {
      return ['独立文风记录只能承接完整作者文风提醒，不能承接引用/译文保真或未知提醒'];
    }
    const { draftDir, briefBytes, brief } = await loadAutomaticBrief(markdownPath);
    const reviewPath = path.join(draftDir, HUMAN_WRITING_REVIEW_FILE);
    if (!inside(draftDir, await fs.realpath(reviewPath))) return ['文风审稿记录不能通过符号链接离开草稿目录'];
    const parsed = humanWritingReviewSchema.safeParse(JSON.parse(await fs.readFile(reviewPath, 'utf8')));
    if (!parsed.success) return ['独立文风审稿记录格式不完整，需要完整提醒和逐项理由'];
    const review = parsed.data;
    const errors = review.issues.map(issue => `独立文风审稿待修复：${issue}`);
    if (expectedRunId && review.reviewRunId !== expectedRunId) errors.push('独立文风审稿没有生成本轮新记录');
    if (review.articleSha256 !== inspection.articleSha256) errors.push('正文已变更，需要重新进行文风复核');
    if (review.checkerSha256 !== inspection.checkerSha256) errors.push('检查器版本已变更，需要重新进行文风复核');
    if (review.briefSha256 !== humanWritingSha256(briefBytes)) errors.push('编辑任务已变更，需要重新进行文风复核');
    const audit = await readSourceAudit(draftDir, brief.sourceAudit);
    if (JSON.stringify(review.sourceAudit) !== JSON.stringify(audit?.record ?? null)) {
      errors.push('来源审计路径或字节已变更，需要重新进行文风复核');
    }
    if (JSON.stringify(review.warnings.map(item => item.warning)) !== JSON.stringify(inspection.warnings)) {
      errors.push('文风审稿提醒集合与实际检查器不一致，不能缺项、增项、额外重复、重排或自拟空集合');
    }
    for (const item of review.warnings) {
      if (item.decision !== 'retain') errors.push(`文风审稿要求修改：${item.warning}；${item.reason}`);
    }
    if (
      JSON.stringify(review.sourceHashes.map(item => ({ id: item.id, path: item.sourcePath }))) !==
      JSON.stringify(brief.sources.map(item => ({ id: item.id, path: item.path })))
    ) {
      errors.push('文风审稿来源集合与锁定任务不一致');
    }
    for (const source of review.sourceHashes) {
      // 远端白名单机器没有 Mac 的绝对来源路径；本机有来源时仍核对当前字节。
      if ((await fs.stat(source.sourcePath).catch(() => undefined))?.isFile()) {
        if (humanWritingSha256(await fs.readFile(source.sourcePath)) !== source.sha256) {
          errors.push(`文风审稿来源已变更：${source.id}`);
        }
      }
    }
    return errors;
  } catch (error) {
    return [`独立文风审稿记录无法核对：${error instanceof Error ? error.message : String(error)}`];
  }
}

type ReviewInputs = Pick<HumanWritingInspection, 'articleSha256' | 'checkerSha256' | 'warnings'> & {
  reviewRunId: string;
  briefSha256: string;
  sourceHashes: z.infer<typeof sourceHashSchema>[];
  sourceAudit: z.infer<typeof sourceAuditSchema> | null;
};

export function buildHumanWritingReviewPrompt(markdownPath: string, planPath: string, input: ReviewInputs): string {
  const draftDir = path.dirname(markdownPath);
  return [
    '你是独立文风审稿人，不是作者或包装员。本轮只审查当前非翻译自动稿，不选题、不润色、不改正文。',
    `必须完整读取：正文 ${markdownPath}；锁定任务 ${planPath}；草稿任务 ${path.join(draftDir, EDITORIAL_BRIEF_FILE)}；任务中的相关来源与 sourceAudit。`,
    '读取已安装 humanizer-zh/SKILL.md，按 Humanizer-zh 通读全文并核对含义与本号作者声音；本轮仅审阅，不改正文。',
    '再逐项审查下列实际提醒：有效表达写 retain 并说明具体作用；有问题写 revise 并加入 issues。全文其他待修问题也写入 issues，不能只为命中句找保留理由或统一写“已核对”。',
    '硬事实必须有来源，作者基于它的当下反应与判断不需要伪装成来源原话；不能新增作者经历。引用/译文保真不在本轮范围，不能用本记录豁免。',
    '禁止修改正文、frontmatter、原任务、草稿任务、来源、检查器或 sourceAudit；不设置 human_writing_reviewed 或 editorial_quality_reviewed。审稿程序已固定这些文件的字节，改后重新计算哈希也会失败。',
    `唯一可写文件：${path.join(draftDir, HUMAN_WRITING_REVIEW_FILE)}。只写 JSON，无 Markdown 围栏。`,
    '以下哈希、运行 id、sourceAudit 路径或 null 与完整提醒原文必须逐字保留；每条必须有非空具体理由。保留检查器原始顺序及重复次数，不缺项、不增项、不自行去重或额外添加；issues 如有任何需改问题不能留空。',
    JSON.stringify(
      {
        version: 1,
        reviewRunId: input.reviewRunId,
        articleSha256: input.articleSha256,
        checkerSha256: input.checkerSha256,
        briefSha256: input.briefSha256,
        sourceHashes: input.sourceHashes,
        sourceAudit: input.sourceAudit,
        warnings: input.warnings.map(warning => ({ warning, decision: 'retain|revise', reason: '逐句复核的具体理由' })),
        issues: [],
      },
      null,
      2
    ),
  ].join('\n\n');
}

/** 独立回调只能产生审稿 JSON；锁定文件在回调前后逐字比对，不能改后自证。 */
export async function reviewHumanWritingWarnings(input: {
  markdownPath: string;
  planPath: string;
  brief: EditorialBrief;
  runIndependent: (prompt: string) => Promise<void>;
  checkerOptions?: HumanWritingCheckerOptions;
}): Promise<void> {
  if (input.brief.contentClass === 'translation') return;
  const inspection = await inspectHumanWritingDraft(input.markdownPath, input.checkerOptions);
  if (!inspection.warnings.length) return;
  if (!inspection.warnings.every(item => AUTHOR_STYLE_WARNING.test(item))) {
    throw new Error('引用/译文保真或未知提醒需原独立翻译流程或显式人工复核，不能由文风审稿放行');
  }
  const automatic = await loadAutomaticBrief(input.markdownPath);
  for (const briefPath of [automatic.briefPath, input.planPath]) {
    if (JSON.stringify(parseEditorialBrief(await fs.readFile(briefPath, 'utf8'))) !== JSON.stringify(input.brief)) {
      throw new Error('文风审稿前编辑任务已偏离锁定版本');
    }
  }
  const audit = await readSourceAudit(automatic.draftDir, input.brief.sourceAudit);
  const protectedPaths = [
    ...new Set([
      input.markdownPath,
      input.planPath,
      automatic.briefPath,
      inspection.checkerPath,
      ...(audit ? [audit.filePath] : []),
      ...input.brief.sources.map(source => source.path),
    ]),
  ];
  const protectedFiles = await Promise.all(
    protectedPaths.map(async filePath => ({
      filePath,
      realPath: await fs.realpath(filePath),
      bytes: await fs.readFile(filePath),
    }))
  );
  const reviewRunId = randomUUID();
  const sourceHashes = await Promise.all(
    input.brief.sources.map(async source => ({
      id: source.id,
      sourcePath: source.path,
      sha256: humanWritingSha256(await fs.readFile(source.path)),
    }))
  );
  await input.runIndependent(
    buildHumanWritingReviewPrompt(input.markdownPath, input.planPath, {
      ...inspection,
      reviewRunId,
      briefSha256: humanWritingSha256(automatic.briefBytes),
      sourceHashes,
      sourceAudit: audit?.record ?? null,
    })
  );
  for (const file of protectedFiles) {
    if (
      (await fs.realpath(file.filePath)) !== file.realPath ||
      !(await fs.readFile(file.filePath)).equals(file.bytes)
    ) {
      throw new Error(`独立文风审稿擅自修改了锁定文件：${file.filePath}`);
    }
  }
  const finalInspection = await inspectHumanWritingDraft(input.markdownPath, input.checkerOptions);
  if (JSON.stringify(finalInspection.warnings) !== JSON.stringify(inspection.warnings)) {
    throw new Error('独立文风审稿前后检查器提醒集合不一致，需重新复核');
  }
  const errors = await collectHumanWritingReviewErrors(input.markdownPath, finalInspection, reviewRunId);
  if (errors.length) throw new Error(`独立文风审稿未通过：\n- ${errors.join('\n- ')}`);
}
