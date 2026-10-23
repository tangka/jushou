import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  countEditorialSubstantiveUnits,
  type EditorialBrief,
  NEWS_SUBSTANTIVE_MAX,
  NEWS_SUBSTANTIVE_MIN,
  validateAutomatedDraftEditorialQuality,
  validateEditorialBriefPlan,
  validateEditorialQuality,
  validateWechatArticleLength,
} from './editorial-quality.js';

const accounts = ['ExampleNews', 'ExampleDev', '示例AI'] as const;
const newsClasses = ['brief', 'analysis', 'tutorial', 'review'] as const;
const boundaryUnits = [799, 800, 1000, 1001, 9999, 10000, 10001] as const;
const sourceIds = ['source-1', 'source-2', 'source-3'];
const factTerms = ['事实一', '事实二', '事实三', '事实四', '事实五'];

function newsBrief(account: string, contentClass: (typeof newsClasses)[number]): EditorialBrief {
  return {
    version: 1,
    account,
    date: '2026-08-28',
    selectionMode: 'user_locked',
    userDirective: '三个号文章统一按 800 到 10000 核查。',
    contentClass,
    topic: '三个账号统一文章篇幅',
    primarySignal: '用户明确要求三个公众号采用同一个文章篇幅核查口径。',
    whyNow: '现有文档、生成提示和上传门禁存在三套互相冲突的长度标准。',
    readerPromise: '统一核查后，所有文章都会在相同有效正文范围内生成和上传。',
    titleTerms: [{ anyOf: ['统一'] }],
    sources: sourceIds.map((id, index) => ({
      id,
      label: `来源${index + 1}`,
      path: `素材库/source-${index + 1}.md`,
      evidence: `证明统一口径的事实${index + 1}`,
    })),
    candidates: [
      {
        topic: '三个账号统一文章篇幅',
        selected: true,
        reason: '用户直接锁定三个账号采用同一核查口径',
        sourceIds,
      },
    ],
    requirements: factTerms.map((term, index) => ({
      id: `fact-${index + 1}`,
      description: `正文必须包含${term}`,
      scope: 'body' as const,
      allOf: [{ anyOf: [term] }],
      sourceIds: [sourceIds[index % sourceIds.length] ?? 'source-1'],
    })),
    forbiddenClaims: [],
  };
}

function bodyAt(target: number, title = '统一文章篇幅'): string {
  const base = `统一口径包含${factTerms.join('、')}。\n\n![一](media/1.png)\n![二](media/2.png)\n![三](media/3.png)`;
  const current = countEditorialSubstantiveUnits(base, title);
  assert.ok(current <= target, `测试正文基础内容 ${current} 超过目标 ${target}`);
  return `${base}\n\n${'补'.repeat(target - current)}`;
}

function validateBoundary(account: string, contentClass: (typeof newsClasses)[number], units: number): void {
  validateEditorialQuality(newsBrief(account, contentClass), {
    draftDir: `/vault/${account}/待发布/2026-08-28-统一篇幅__codex`,
    markdown: '',
    title: '统一文章篇幅',
    body: bodyAt(units),
    postType: '图文',
    accountExact: account,
  });
}

test('three accounts and every news class share the 800 to 10000 hard range', () => {
  assert.equal(NEWS_SUBSTANTIVE_MIN, 800);
  assert.equal(NEWS_SUBSTANTIVE_MAX, 10000);
  for (const account of accounts) {
    for (const contentClass of newsClasses) {
      for (const units of boundaryUnits) {
        if (units < 800 || units > 10000) {
          assert.throws(() => validateBoundary(account, contentClass, units), /800~10000/u);
        } else {
          assert.doesNotThrow(() => validateBoundary(account, contentClass, units));
        }
      }
    }
  }
});

test('editorial plans cannot tighten the shared article floor', () => {
  const brief = newsBrief('ExampleNews', 'analysis');
  assert.doesNotThrow(() =>
    validateEditorialBriefPlan(
      { ...brief, minimums: { substantiveUnits: NEWS_SUBSTANTIVE_MIN } },
      {
        accountExact: 'ExampleNews',
        date: '2026-08-28',
      }
    )
  );
  for (const invalid of [1, NEWS_SUBSTANTIVE_MIN - 1, NEWS_SUBSTANTIVE_MIN + 1]) {
    assert.throws(
      () =>
        validateEditorialBriefPlan(
          { ...brief, minimums: { substantiveUnits: invalid } },
          {
            accountExact: 'ExampleNews',
            date: '2026-08-28',
          }
        ),
      /只能填 0 或 800/u
    );
  }
});

test('manual news drafts use the same range for all three accounts', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-manual-length-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const account of accounts) {
    const input = (units: number) => ({
      draftDir: path.join(root, `${account}-manual`),
      markdown: `---\ntitle: 统一文章篇幅\n---\n\n${bodyAt(units)}`,
      title: '统一文章篇幅',
      body: bodyAt(units),
      postType: '图文',
      accountExact: account,
    });
    for (const units of boundaryUnits) {
      if (units < 800 || units > 10000) {
        await assert.rejects(() => validateAutomatedDraftEditorialQuality(input(units)), /800~10000/u);
      } else {
        await assert.doesNotReject(() => validateAutomatedDraftEditorialQuality(input(units)));
      }
    }
  }
});

test('both automated engines use the shared range for every account', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-automated-length-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const account of accounts) {
    for (const engine of ['codex', 'claude']) {
      const draftDir = path.join(root, `${account}-article__${engine}`);
      await fs.mkdir(draftDir);
      await fs.writeFile(path.join(draftDir, 'editorial-brief.json'), JSON.stringify(newsBrief(account, 'analysis')));
      for (const units of boundaryUnits) {
        const input = {
          draftDir,
          markdown: '',
          title: '统一文章篇幅',
          body: bodyAt(units),
          postType: '图文',
          accountExact: account,
        };
        if (units < 800 || units > 10000) {
          await assert.rejects(() => validateAutomatedDraftEditorialQuality(input), /800~10000/u);
        } else {
          await assert.doesNotReject(() => validateAutomatedDraftEditorialQuality(input));
        }
      }
    }
  }
});

test('weekly news uses the same bounded range with or without weekly markers', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-weekly-length-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const weeklyMarkdown = (units: number, includeColumn = true, includeTag = true) =>
    [
      '---',
      'title: 周刊篇幅',
      ...(includeColumn ? ['栏目: 周刊'] : []),
      `tags: [${includeTag ? '周刊' : '日常'}]`,
      '---',
      '',
      bodyAt(units, '周刊篇幅'),
    ].join('\n');
  const input = (account: string, units: number, includeColumn = true, includeTag = true) => ({
    draftDir: path.join(root, `${account}-weekly`),
    markdown: weeklyMarkdown(units, includeColumn, includeTag),
    title: '周刊篇幅',
    body: bodyAt(units, '周刊篇幅'),
    postType: '图文',
    accountExact: account,
  });

  for (const account of accounts) {
    for (const units of boundaryUnits) {
      if (units < 800 || units > 10000) {
        await assert.rejects(() => validateAutomatedDraftEditorialQuality(input(account, units)), /800~10000/u);
      } else {
        await assert.doesNotReject(() => validateAutomatedDraftEditorialQuality(input(account, units)));
      }
      for (const contentClass of newsClasses) {
        const validate = () =>
          validateEditorialQuality(
            { ...newsBrief(account, contentClass), titleTerms: [{ anyOf: ['周刊'] }] },
            { ...input(account, units), draftDir: `/vault/${account}/待发布/2026-08-28-周刊__claude` }
          );
        if (units < 800 || units > 10000) assert.throws(validate, /800~10000/u);
        else assert.doesNotThrow(validate);
      }
    }
    for (const [includeColumn, includeTag] of [
      [false, true],
      [true, false],
      [false, false],
    ]) {
      await assert.doesNotReject(() =>
        validateAutomatedDraftEditorialQuality(input(account, 1001, includeColumn, includeTag))
      );
      await assert.rejects(
        () => validateAutomatedDraftEditorialQuality(input(account, 10001, includeColumn, includeTag)),
        /800~10000/u
      );
    }
  }
});

test('old user-locked long-form permissions cannot bypass the shared range', () => {
  const oldDirectives = ['这篇允许文字超过1500', '这篇文章可超过2000字', '这篇文章可超过1w字', '这篇正文可超过1万字'];
  for (const account of accounts) {
    for (const userDirective of oldDirectives) {
      for (const units of [799, 1600, 10000, 10001]) {
        const validate = () =>
          validateEditorialQuality(
            { ...newsBrief(account, 'brief'), userDirective },
            {
              draftDir: `/vault/${account}/待发布/2026-08-28-用户明确长文__codex`,
              markdown: '',
              title: '统一文章篇幅',
              body: bodyAt(units),
              postType: '图文',
              accountExact: account,
            }
          );
        if (units < 800 || units > 10000) assert.throws(validate, /800~10000/u);
        else assert.doesNotThrow(validate);
      }
    }
  }
});

test('sticker and video drafts remain outside the article length range', () => {
  const brief = { ...newsBrief('示例AI', 'brief'), contentClass: 'sticker' as const };
  assert.doesNotThrow(() =>
    validateEditorialQuality(brief, {
      draftDir: '/vault/示例AI/待发布/2026-08-28-统一篇幅__codex',
      markdown: '',
      title: '统一文章篇幅',
      body: bodyAt(NEWS_SUBSTANTIVE_MAX + 1),
      postType: '贴图',
      accountExact: '示例AI',
    })
  );
  for (const postType of ['贴图', '视频号', '视频']) {
    assert.doesNotThrow(() =>
      validateWechatArticleLength({ markdown: '', title: '非文章不套下限', body: '简短正文', postType })
    );
  }
  assert.doesNotThrow(() =>
    validateWechatArticleLength({
      markdown: '',
      title: '视频不套文章字数',
      body: bodyAt(NEWS_SUBSTANTIVE_MAX + 1),
      postType: '视频号',
    })
  );
  assert.doesNotThrow(() =>
    validateWechatArticleLength({
      markdown: '',
      title: '历史视频别名不套文章字数',
      body: bodyAt(NEWS_SUBSTANTIVE_MAX + 1),
      postType: '视频',
    })
  );
});

test('effective units exclude duplicate title, image, fixed entry and link URL', () => {
  const body = [
    '# 统一文章篇幅',
    '正文[上一篇](https://mp.weixin.qq.com/s/example)',
    '<a class="weapp_text_link" data-miniprogram-appid="wx123">打开示例工具</a>',
    '![图片](media/1.png)',
  ].join('\n\n');
  assert.equal(countEditorialSubstantiveUnits(body, '统一文章篇幅'), 5);
});

test('bare URLs stop before Chinese prose and fenced language labels stay invisible', () => {
  assert.equal(
    countEditorialSubstantiveUnits('正文链接https://mp.weixin.qq.com/s/example，后文仍然可见。', '别的标题'),
    10
  );
  assert.equal(countEditorialSubstantiveUnits('```json\n{"ok": true}\n```', '别的标题'), 2);
});
