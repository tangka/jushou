export function logDraftUploadPlan(input: {
  account: string;
  draftDir: string;
  postType: string | undefined;
  title: string;
  ensureDraft: boolean;
  update: boolean;
  coverPath: string;
  stickerImageCount: number;
  bodyImageCount: number;
  stickerTextLength: number;
  articleHtmlLength: number;
  credentialsConfigured: boolean;
}): void {
  const isSticker = input.postType === '贴图';
  console.log(`账号:${input.account}`);
  console.log(`草稿:${input.draftDir}`);
  console.log(`模式:${isSticker ? '贴图(newspic)' : '图文(news)'}`);
  console.log(`标题:${input.title}`);
  console.log(`操作:${input.ensureDraft ? '幂等确保草稿' : input.update ? '原位更新现有草稿' : '创建新草稿'}`);
  console.log(`封面:${input.coverPath}`);
  console.log(isSticker ? `贴图图片:${input.stickerImageCount} 张` : `正文图片:${input.bodyImageCount} 张`);
  if (!isSticker && input.bodyImageCount === 0) {
    console.log('提示:正文没有引用图片。cover 只作为微信封面,不会自动插入正文。');
  }
  console.log(isSticker ? `正文文本:${input.stickerTextLength} 字符` : `HTML 长度:${input.articleHtmlLength} 字符`);
  console.log(`凭证:${input.credentialsConfigured ? '已配置' : '缺失'}`);
}
