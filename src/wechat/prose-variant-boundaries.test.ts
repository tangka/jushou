import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectProsePatterns } from './prose-patterns.js';

test('generalizing the rules does not soften either explicitly rejected sentence on its own', () => {
  for (const text of ['我允许自己嘚瑟一下。', '锅铲你拿着，额度我收下。', '锅铲你拿着 额度我收下。']) {
    assert.ok(
      inspectProsePatterns(text).some(item => item.id === 'performed-emotion' && item.severity === 'block'),
      text
    );
  }
});

test('unfamiliar producers and benefits survive role order and punctuation changes', () => {
  for (const producer of ['Northstar', 'FableLab', '蓝鲸团队']) {
    for (const benefit of ['额外福利', '免费的算力', '到手的甜头']) {
      for (const text of [
        `${producer}负责继续折腾，我只管把${benefit}收进来。`,
        `活交给${producer}，${benefit}留给我。`,
        `${producer}继续推新。${benefit}我就先领走了。`,
      ]) {
        assert.ok(
          inspectProsePatterns(text).some(item => item.id === 'performed-emotion'),
          text
        );
      }
    }
  }
});

test('the same producer and benefit nouns do not turn administrative work into a slogan', () => {
  for (const producer of ['Northstar', 'FableLab', '蓝鲸团队']) {
    for (const benefit of ['额外福利', '免费的算力', '到手的甜头']) {
      const text = `${producer}负责修改权限，我负责核对${benefit}的领取条件。`;
      assert.deepEqual(inspectProsePatterns(text), [], text);
    }
  }
});

test('third-person and negated self-permission are not narrator stage directions', () => {
  for (const text of [
    '他终于允许自己得意一会儿，随后又继续训练。',
    '她让自己膨胀了一下，很快就收起了笑容。',
    '我不允许自己得意，失败记录还没有清理。',
    '我并不想先给自己鼓个掌，还有很多工作没做完。',
    '作者先给自己点个赞，然后开始介绍实现过程。',
  ]) {
    assert.deepEqual(inspectProsePatterns(text), [], text);
  }
});

test('new pattern evidence keeps its line across emphasis, HTML and a wrapped clause', () => {
  const prose = '# 场景\n\nNorthstar负责继续折腾，\n我只管把**免费的算力**收进来。';
  const findings = inspectProsePatterns(prose);
  const finding = findings.find(item => item.id === 'performed-emotion');
  assert.equal(finding?.evidence[0]?.line, 3);
  assert.match(finding?.evidence[0]?.excerpt ?? '', /免费的算力/u);
  assert.ok(
    inspectProsePatterns('请准<span>我</span>小小地**膨胀**三秒钟。').some(item => item.id === 'performed-emotion')
  );
  assert.deepEqual(inspectProsePatterns(`> ${prose.replaceAll('\n', '\n> ')}`), []);
});

test('padded Chinese clocks are normalized, invalid clocks and one repeated instant are not counted', () => {
  assert.ok(
    inspectProsePatterns('九点零六分十二秒，九点零六分十八秒，九点零六分二十三秒。').some(
      item => item.id === 'precision-overload'
    )
  );
  assert.deepEqual(inspectProsePatterns('09:06:12.100，０９：０６：１２．１，九点零六分十二秒。'), []);
  assert.deepEqual(inspectProsePatterns('29:06:12，09:66:18，09:06:63。'), []);
});

test('a single real question, explanation and reaction is not a repeated paragraph formula', () => {
  const text = '这还需要重传？新版只接受3MB以下的图片，我刚传的那张超了。怪不得卡在这里。';
  assert.deepEqual(inspectProsePatterns(text), []);
});
