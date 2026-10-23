import assert from 'node:assert/strict';
import test from 'node:test';
import { REJECTED_PROSE_SAMPLE } from '../test-support/prose-fixture.js';
import { inspectProsePatterns } from './prose-patterns.js';

test('synthetic prose exposes performed emotion, precision and transition overload', () => {
  const markdown = REJECTED_PROSE_SAMPLE;
  const findings = inspectProsePatterns(markdown);
  assert.ok(findings.some(item => item.id === 'performed-emotion' && item.severity === 'block'));
  assert.ok(findings.some(item => item.id === 'precision-overload'));
  assert.ok(findings.some(item => item.id === 'transition-overload'));
  const performed = findings.find(item => item.id === 'performed-emotion');
  assert.deepEqual(
    performed?.evidence.map(item => item.excerpt),
    ['锅铲你拿着，额度我收下', '我允许自己嘚瑟一下']
  );
  for (const finding of findings) {
    for (const item of finding.evidence) {
      assert.ok(markdown.split('\n')[item.line - 1]?.includes(item.excerpt.split('\n')[0] ?? ''));
    }
  }
});

test('repeated reaction, explanation and conclusion gets a whole-paragraph review', () => {
  const markdown = [
    '# 产品变化',
    '真香，这下我高兴了。价格从每月十元降到五元，公告今天更新，原订阅到期也能续上。总之这回划算。',
    '离谱，这次真让我惊喜。软件支持把五份文档一起导出，原来需要逐份选择确认。这样用起来省心。',
    '好好好，这事让我满意。今天上线的批量功能支持十个任务，之前只能逐个提交。这个变化值得。',
    '太爽了，这下我服了。更新之后支持离线操作，原来的三个项目可以直接打开。看来终于可以了。',
  ].join('\n\n');
  const finding = inspectProsePatterns(markdown).find(item => item.id === 'paragraph-template');
  assert.equal(finding?.severity, 'review');
  assert.equal(finding?.evidence.length, 4);
  assert.match(finding?.message ?? '', /反应开场→解释\/事实→评价收尾/u);
});

test('equal paragraph lengths alone and concrete strong reactions are not banned', () => {
  const markdown = [
    '操，这模型怎么跟不要钱一样往外面扔啊。',
    '在我心里它就是神，最强的那一档，强得离谱。',
    '我等过发布，我等过更新，我等过它兑现承诺。',
    '模型太多太多太多太多了。',
    '价格从十元降到五元，智能可能像煤水电一样普及。那时候，可能就是真正的，大繁荣时代了。',
    '我看了账单，省下的钱刚好能印一套画册。原来卡住的那份设计这周可以交付。',
  ].join('\n\n');
  assert.deepEqual(inspectProsePatterns(markdown), []);
  assert.deepEqual(inspectProsePatterns('我是挺高兴的，今天真的到账了。\n\n锅铲你拿着，切好的菜我端过去。'), []);
});

test('one precise measurement, repeated same time, and ordinary chronology do not trigger overload', () => {
  for (const text of [
    '服务器14:32:11重启，五秒之后连接恢复。',
    '首次记录14:32:11，复核记录仍为14:32:11，最终确认14:32:11。',
    '上午打开工程，紧接着运行编译，等到下午才把成品交付。',
    '本轮记录14:19、14:32和14:33，先后顺序没有变。',
  ]) {
    assert.deepEqual(inspectProsePatterns(text), []);
  }
});

test('precise debugging chronology is reviewable rather than a hard ban', () => {
  const findings = inspectProsePatterns('14:32:11锁被释放，14:32:16任务重试，14:32:17写入失败。');
  assert.deepEqual(
    findings.map(item => [item.id, item.severity]),
    [['precision-overload', 'review']]
  );
});

test('new rules preserve quotes, real code and metadata but still inspect following author prose', () => {
  const quote = '我允许自己嘚瑟一下。锅铲你拿着，额度我收下。';
  const timestamps = '14:19:50、14:32:16、14:32:11';
  const wrappers = [
    `---\ndigest: ${quote}${timestamps}\n---\n\n正文没有这些句子。`,
    `> ${quote}\n> ${timestamps}\n\n原话的情绪属于原作者。`,
    `<blockquote>${quote}${timestamps}</blockquote>\n\n原话的情绪属于原作者。`,
    `\`\`\`python\nprint("${quote}${timestamps}")\n\`\`\`\n\n输出只用于调试。`,
    `原作者说：“${quote}”\n\n原文写作「${timestamps}」。`,
    `![${quote}${timestamps}](media/test.png)\n\n这里使用原图。`,
  ];
  for (const markdown of wrappers) {
    assert.deepEqual(inspectProsePatterns(markdown), []);
    assert.ok(inspectProsePatterns(`${markdown}\n\n${quote}`).some(item => item.id === 'performed-emotion'));
  }
  for (const language of ['', 'text']) {
    assert.ok(
      inspectProsePatterns(`\`\`\`${language}\n${quote}\n\`\`\``).some(item => item.id === 'performed-emotion')
    );
  }
});

test('headings, multiline HTML and miniprogram wrappers preserve source lines and adjacent prose', () => {
  const markdown = [
    '---',
    'title: 测试',
    '---',
    '',
    '# 测试',
    '',
    '<span',
    'style="color:red">',
    '我允许自己嘚瑟一下。',
    '</span>',
    '',
    '紧接着<a data-miniprogram-appid="wxexample" href="#">入口</a>，也就是说，这点我尤其满意。',
  ].join('\n');
  const findings = inspectProsePatterns(markdown);
  assert.deepEqual(findings.find(item => item.id === 'performed-emotion')?.evidence, [
    { line: 9, excerpt: '我允许自己嘚瑟一下' },
  ]);
  assert.deepEqual(
    findings.find(item => item.id === 'transition-overload')?.evidence.map(item => item.line),
    [12, 12, 12]
  );
});
