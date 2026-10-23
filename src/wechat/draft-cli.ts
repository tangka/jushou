import process from 'node:process';

export type UploadDraftCliOptions = {
  draft: string | undefined;
  dryRun: boolean;
  force: boolean;
  ensureDraft: boolean;
  ensurePublishedProof: 'absent' | 'exact' | undefined;
  updateMediaId: string | undefined;
  replaceTitleFrom: string | undefined;
};

export function parseUploadDraftCli(argv: readonly string[]): UploadDraftCliOptions {
  const options: UploadDraftCliOptions = {
    draft: undefined,
    dryRun: false,
    force: false,
    ensureDraft: false,
    ensurePublishedProof: undefined,
    updateMediaId: undefined,
    replaceTitleFrom: undefined,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--ensure-draft') {
      options.ensureDraft = true;
    } else if (arg === '--ensure-published-proof') {
      const value = argv[index + 1]?.trim();
      if (value !== 'absent' && value !== 'exact') {
        throw new Error('--ensure-published-proof 只接受 absent 或 exact');
      }
      options.ensurePublishedProof = value;
      index++;
    } else if (arg === '--update-media-id') {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error('--update-media-id 需要传现有微信草稿 media_id');
      options.updateMediaId = value;
      index++;
    } else if (arg === '--replace-title-from') {
      const value = argv[index + 1]?.trim();
      if (!value) throw new Error('--replace-title-from 需要传当前微信草稿完整标题');
      options.replaceTitleFrom = value;
      index++;
    } else if (arg === '--draft') {
      const value = argv[index + 1];
      if (!value) throw new Error('--draft 需要传草稿目录名或绝对路径');
      options.draft = value;
      index++;
    } else if (arg === '-h' || arg === '--help') {
      printUploadDraftHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数:${arg}`);
    }
  }
  if (options.force && options.updateMediaId) throw new Error('--force 与 --update-media-id 互斥');
  if (options.ensureDraft && (options.force || options.updateMediaId)) {
    throw new Error('--ensure-draft 与 --force/--update-media-id 互斥');
  }
  if (options.ensureDraft && !options.draft) {
    throw new Error('--ensure-draft 为避免误操作,必须同时显式传 --draft');
  }
  if (options.ensurePublishedProof && !options.ensureDraft) {
    throw new Error('--ensure-published-proof 必须配合 --ensure-draft');
  }
  if (options.updateMediaId && !options.draft) {
    throw new Error('--update-media-id 为避免误更新,必须同时显式传 --draft');
  }
  if (options.replaceTitleFrom && !options.updateMediaId) {
    throw new Error('--replace-title-from 必须配合 --update-media-id');
  }
  return options;
}

function printUploadDraftHelp(): void {
  console.log(`用法:
  pnpm upload-draft [-- --draft <草稿目录名或路径>] [--dry-run] [--ensure-draft|--force|--update-media-id <media_id>] [--replace-title-from <旧标题>]

说明:
  - 不传 --draft 时,自动选择当前账号待发布目录里今天最新的非视频公众号草稿。
  - 只操作微信后台草稿箱草稿,不发布、不群发。
  - --update-media-id 必须配合 --draft,原位更新该 media_id,不会创建重复草稿。
  - --ensure-draft 必须配合 --draft；会核对草稿箱和已发表记录后幂等创建、更新或跳过。
  - 换题时额外传 --replace-title-from <旧标题>;只有本地元数据和远端草稿都精确匹配旧标题才允许改标题。
  - 更新时会校验 .wechat-draft.json 中的 media_id 与账号一致。
  - --force 明确创建重复草稿,与 --update-media-id 互斥。
  - 普通 Markdown 草稿上传为图文消息;frontmatter post_type=贴图 上传为图片消息。
  - 需要当前账号 env 里配置 WECHAT_APPID + WECHAT_APPSECRET。
  - 图文正文图片会上传到微信图文图片接口并替换为微信 CDN URL。`);
}
