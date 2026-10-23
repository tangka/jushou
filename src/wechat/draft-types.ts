export type DraftImageRef = {
  src: string;
  filePath: string;
};

export type DraftUploadSource = {
  postType: string | undefined;
  title: string;
  author: string;
  digest: string;
  contentSourceUrl: string | undefined;
  coverPath: string;
  stickerContent: string;
  stickerImages: DraftImageRef[];
  articleHtml: string;
  miniProgramEntryRequired?: boolean;
};

export type WechatDraftResult = {
  mediaId: string;
  uploadedBodyImages: Record<string, string>;
  thumbMediaId?: string;
  uploadedStickerImages?: string[];
};
