import path from 'node:path';

export type ArticlePaths = {
  dir: string;
  md: string;
  rawJson: string;
  mediaDir: string;
  comment: string;
};

/** 单篇产物路径:`<账号目录>/<base>/{<base>.md, raw.json, media/}`(一篇一文件夹)。 */
export function createArticlePaths(accountDir: string, base: string): ArticlePaths {
  const dir = path.join(accountDir, base);
  return {
    dir,
    md: path.join(dir, `${base}.md`),
    rawJson: path.join(dir, 'raw.json'),
    mediaDir: path.join(dir, 'media'),
    comment: path.join(dir, 'comment.md'),
  };
}
