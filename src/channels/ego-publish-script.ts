export type EgoPublishPayload = {
  taskSpace: string;
  verifyText: string;
  account: string;
  channelLabel: string;
  collectionName: string;
  draftDir: string;
  videoPath: string;
  coverPath: string;
  qaDir: string;
  title: string;
  shortTitle: string;
  description: string;
  screenshotDir: string;
};

export function buildEgoBrowserPublishScript(payload: EgoPublishPayload): string {
  return `
const payload = ${JSON.stringify(payload, null, 2)};
const task = await useOrCreateTaskSpace(payload.taskSpace);
cliLog('[channels-publish] task space ' + task.id + ' ' + payload.taskSpace);

function refFromLine(line) {
  const match = line.match(/\\[ref=(\\d+)/);
  return match ? match[1] : '';
}

function findRefByLine(snapshot, matcher) {
  for (const line of snapshot.split('\\n')) {
    if (matcher.test(line)) {
      const ref = refFromLine(line);
      if (ref) return ref;
    }
  }
  return '';
}

function lineText(line) {
  const match = line.match(/text "([^"]*)"/);
  return match ? match[1] : line;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&');
}

function findRefByText(snapshot, matcher) {
  const lines = snapshot.split('\\n');
  for (let i = 0; i < lines.length; i++) {
    if (!matcher.test(lineText(lines[i]))) continue;
    for (let j = i; j >= 0 && i - j < 8; j--) {
      const ref = refFromLine(lines[j]);
      if (ref) return ref;
    }
  }
  return '';
}

function findButtonRefByText(snapshot, matcher) {
  const lines = snapshot.split('\\n');
  for (let i = 0; i < lines.length; i++) {
    const button = lines[i].match(/button \\[ref=(\\d+)/);
    if (!button) continue;
    const block = lines.slice(i, i + 8).map(lineText).join('\\n');
    if (matcher.test(block)) return button[1];
  }
  return '';
}

async function shot(name) {
  const safe = String(name).replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 80);
  const file = payload.screenshotDir + '/' + Date.now() + '-' + safe + '.png';
  await captureScreenshot(file).catch(error => cliLog('[channels-publish] screenshot failed: ' + error.message));
  return file;
}

async function fail(name, message) {
  const file = await shot(name);
  throw new Error(message + '; screenshot=' + file);
}

async function getState(stage) {
  const info = await pageInfo();
  const text = await snapshotText();
  const combined = info.url + '\\n' + text;
  if (/login\\.html|微信扫码登录|二维码已过期|需在手机上进行确认|扫码登录/.test(combined)) {
    await handOffTaskSpace(task.id).catch(() => {});
    await fail(stage + '-login', '视频号助手需要登录或手机确认');
  }
  if (payload.verifyText && !text.includes(payload.verifyText)) {
    await fail(stage + '-account', '页面账号校验失败,未看到: ' + payload.verifyText);
  }
  return { info, text };
}

async function openPublishPage() {
  await openOrReuseTab('https://channels.weixin.qq.com/platform', { wait: true, timeout: 60 }).catch(async () => {
    await gotoAndWait('https://channels.weixin.qq.com/platform', { timeout: 60, settle: 5 });
  });
  await wait(5);
  let state = await getState('platform');
  const publishRef = findRefByText(state.text, /^发表视频$/);
  if (publishRef) {
    await click('@' + publishRef, { label: '发表视频' });
  } else {
    await gotoAndWait('https://channels.weixin.qq.com/platform/post/create', { timeout: 60, settle: 5 }).catch(() => {});
  }
  await wait(5);
  await getState('post-create');
}

async function uploadVideo() {
  await cdp('Page.setInterceptFileChooserDialog', { enabled: true });
  let state = await getState('before-upload');
  const uploadRef = findRefByText(state.text, /上传|选择视频|添加视频/);
  if (uploadRef) {
    await click('@' + uploadRef, { label: '打开视频文件选择器' });
  } else {
    await click([Math.round(state.info.w * 0.37), Math.round(Math.min(330, state.info.h * 0.4))], {
      label: '打开视频文件选择器',
    });
  }
  await wait(2);
  let events = await drainEvents();
  let chooser = events.find(event => event.method === 'Page.fileChooserOpened');
  if (!chooser && uploadRef) {
    state = await getState('before-upload-coordinate-fallback');
    await click([Math.round(state.info.w * 0.37), Math.round(Math.min(330, state.info.h * 0.4))], {
      label: '打开视频文件选择器 fallback',
    });
    await wait(2);
    events = await drainEvents();
    chooser = events.find(event => event.method === 'Page.fileChooserOpened');
  }
  if (!chooser) await fail('video-file-chooser', '未捕获视频文件选择器');
  await cdp('DOM.setFileInputFiles', { backendNodeId: chooser.params.backendNodeId, files: [payload.videoPath] });
  await cdp('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  cliLog('[channels-publish] video uploaded: ' + payload.videoPath);

  let lastText = '';
  for (let i = 0; i < 72; i++) {
    await wait(5);
    lastText = (await getState('upload-processing')).text;
    if (/上传失败|处理失败|生成失败|文件错误|格式不支持/.test(lastText)) {
      await fail('video-upload-failed', '视频上传或处理失败');
    }
    if (/封面预览/.test(lastText) && /视频描述/.test(lastText) && /短标题/.test(lastText)) return lastText;
  }
  await fail('video-processing-timeout', '等待视频上传处理完成超时');
}

async function fillTextFields() {
  let state = await getState('fill-fields');
  const descRef = findRefByText(state.text, /^添加描述$/);
  if (!descRef) await fail('description-field', '未找到视频描述输入框');
  await fillInput('@' + descRef, payload.description);

  state = await getState('fill-short-title');
  const shortRef = findRefByLine(state.text, /placeholder="填写短标题有机会获得更多流量"/);
  if (!shortRef) await fail('short-title-field', '未找到短标题输入框');
  await fillInput('@' + shortRef, payload.shortTitle);
  await wait(2);
  cliLog('[channels-publish] description and short title filled');
}

async function verifyCoverPreview() {
  const state = await getState('cover-preview');
  if (!/封面预览/.test(state.text)) await fail('cover-preview', '未看到封面预览');
  cliLog('[channels-publish] cover preview visible; local cover=' + payload.coverPath);
}

async function setNoLocation() {
  let state = await getState('location-before');
  await click([Math.round(state.info.w * 0.86), Math.round(state.info.h * 0.82)], { label: '打开位置选择' });
  await wait(2);
  state = await getState('location-open');
  const noLocationRef = findRefByText(state.text, /不显示位置/);
  if (noLocationRef) {
    await click('@' + noLocationRef, { label: '不显示位置' });
  } else {
    await click([Math.round(state.info.w * 0.61), Math.round(state.info.h * 0.95)], { label: '不显示位置 fallback' });
  }
  await wait(2);
  state = await getState('location-after');
  if (/杭州市|北京市|上海市|广州市|深圳市/.test(state.text)) {
    await fail('location-not-hidden', '位置未改为不显示位置');
  }
  cliLog('[channels-publish] location hidden');
}

async function selectCollectionIfNeeded() {
  if (!payload.collectionName) return;
  let state = await getState('collection-before');
  const collectionControlRef = findRefByText(state.text, /选择合集|添加到合集/);
  if (collectionControlRef) {
    await click('@' + collectionControlRef, { label: '选择合集' });
  } else {
    await click([Math.round(state.info.w * 0.86), Math.round(state.info.h * 0.88)], { label: '选择合集 fallback' });
  }
  await wait(2);
  state = await getState('collection-open');
  const collectionRef = findRefByText(state.text, new RegExp(escapeRegExp(payload.collectionName)));
  if (!collectionRef) await fail('collection-not-found', '未找到目标合集: ' + payload.collectionName);
  await click('@' + collectionRef, { label: '选择目标合集 ' + payload.collectionName });
  await wait(2);
  state = await getState('collection-after');
  if (!state.text.includes(payload.collectionName)) await fail('collection-not-selected', '目标合集未选择成功: ' + payload.collectionName);
  cliLog('[channels-publish] collection selected: ' + payload.collectionName);
}

async function declareOriginal() {
  let state = await getState('original-before');
  if (/已声明原创/.test(state.text)) {
    cliLog('[channels-publish] original already declared');
    return;
  }
  await cdp('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round(state.info.w * 0.74),
    y: Math.round(state.info.h * 0.9),
    deltaX: 0,
    deltaY: 700,
  });
  await wait(1);
  state = await getState('original-visible');
  const originalRef = findRefByText(state.text, /声明原创|原创/);
  if (originalRef) {
    await click('@' + originalRef, { label: '声明原创' });
  } else {
    await click([Math.round(state.info.w * 0.57), Math.round(state.info.h * 0.66)], { label: '声明原创 fallback' });
  }
  await wait(2);
  state = await getState('original-modal');
  if (/原创声明|声明原创|同意/.test(state.text)) {
    const agreeRef = findRefByText(state.text, /我已阅读|同意/);
    if (agreeRef) {
      await click('@' + agreeRef, { label: '同意原创声明条款' });
    } else {
      await click([Math.round(state.info.w * 0.32), Math.round(state.info.h * 0.56)], { label: '同意原创声明条款 fallback' });
    }
    await wait(1);
    state = await getState('original-modal-confirm');
    const confirmRef =
      findButtonRefByText(state.text, /声明原创|确认|确定/) || findRefByText(state.text, /声明原创|确认|确定/);
    if (confirmRef) {
      await click('@' + confirmRef, { label: '确认声明原创' });
    } else {
      await click([Math.round(state.info.w * 0.64), Math.round(state.info.h * 0.65)], { label: '确认声明原创 fallback' });
    }
  }
  await wait(4);
  state = await getState('original-after');
  if (!/已声明原创|原创审核/.test(state.text)) await fail('original-not-declared', '原创声明未确认成功');
  cliLog('[channels-publish] original declared');
}

async function publishAndVerify() {
  let state = await getState('before-final-publish');
  if (!state.text.includes(payload.shortTitle)) await fail('short-title-verify', '最终发表前短标题不匹配');
  if (!/已声明原创|原创审核/.test(state.text)) await fail('original-verify', '最终发表前未看到原创声明');
  if (/杭州市|北京市|上海市|广州市|深圳市/.test(state.text)) await fail('location-verify', '最终发表前位置仍可见');

  const publishRef = findButtonRefByText(state.text, /^发表$/);
  if (publishRef) {
    await click('@' + publishRef, { label: '最终发表' });
  } else {
    await click([Math.round(state.info.w * 0.83), Math.round(state.info.h * 0.78)], { label: '最终发表 fallback' });
  }
  await wait(8);
  state = await getState('after-final-publish');
  if (/失败|错误|请稍后再试|未通过/.test(state.text)) await fail('publish-failed', '点击发表后页面返回失败');

  await gotoAndWait('https://channels.weixin.qq.com/platform/post/list', { timeout: 60, settle: 5 }).catch(() => {});
  await wait(8);
  state = await getState('post-list');
  const marker = payload.shortTitle || payload.title || payload.description.slice(0, 12);
  if (marker && !state.text.includes(marker) && !state.text.includes(payload.description.slice(0, 12))) {
    await fail('post-list-verify', '发布后列表未看到本次视频标题或描述');
  }
  if (!/原创审核中|审核中|已发表|视频 \\(/.test(state.text)) {
    await fail('post-list-status', '发布后列表未看到可接受状态');
  }
  cliLog('[channels-publish] published and verified in list');
}

await openPublishPage();
await uploadVideo();
await verifyCoverPreview();
await fillTextFields();
await setNoLocation();
await selectCollectionIfNeeded();
await declareOriginal();
await publishAndVerify();
`;
}
