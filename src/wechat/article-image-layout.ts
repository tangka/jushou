import { load } from 'cheerio';

/** 独立配图使用块容器，微信补入的空白字符不能再撑出正文行高。 */
export function groupArticleImages(html: string): string {
  const $ = load(html, {}, false);
  $('.article > img').wrap('<section class="article-image"></section>');
  $('.article > p').each((_index, element) => {
    const paragraph = $(element);
    if (paragraph.text().trim() || paragraph.children().length !== 1 || !paragraph.children('img').length) return;
    paragraph.replaceWith(`<section class="article-image">${paragraph.html()}</section>`);
  });
  return $.html();
}

export function articleImageCss(border: string): string {
  return `
.article img {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  margin: 24px auto;
  border-radius: 8px;
  border: 1px solid ${border};
}
.article .article-image {
  margin: 18px 0;
  padding: 0;
  font-size: 0;
  line-height: 0;
}
.article .article-image img {
  margin: 0 auto;
}
.article .article-image + h2,
.article .article-image + h3 {
  margin-top: 0;
}
`;
}
