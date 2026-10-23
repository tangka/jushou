/** Grok 正文随微信主题继承前景与底色；固定深色对话块保留配套浅字。 */
export function grokEditorialOverrides(): string {
  return `
.article {
  padding: 26px 8px 40px;
  border-top: 1px solid #cfd7e2;
  background: transparent;
  background-image: none;
  color: inherit;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  font-size: 17px;
  line-height: 1.92;
  letter-spacing: 0.006em;
}
.article h1 {
  margin: 0 0 34px;
  padding: 38px 24px 34px;
  border: 1px solid #cbd5e1;
  border-top: 7px solid #11141a;
  border-radius: 3px;
  background: transparent;
  background-image: none;
  color: inherit;
  font-size: 31px;
  line-height: 1.28;
  font-weight: 820;
  letter-spacing: -0.035em;
  text-align: left;
}
.article > p:first-of-type {
  margin-bottom: 26px;
  color: inherit;
  font-size: 19px;
  line-height: 1.82;
  font-weight: 540;
}
.article h2 {
  margin: 44px 0 20px;
  padding: 15px 0 13px 15px;
  border-top: 1px solid #cfd7e2;
  border-right: 0;
  border-bottom: 1px solid #cfd7e2;
  border-left: 5px solid #4189f4;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-size: 23px;
  line-height: 1.42;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.article h3 {
  margin-top: 32px;
  color: inherit;
  font-size: 17px;
  font-weight: 780;
  letter-spacing: 0.035em;
  text-decoration: underline;
  text-decoration-color: #64b98a;
  text-decoration-thickness: 0.13em;
  text-underline-offset: 0.18em;
}
.article p,
.article li {
  color: inherit;
}
.article strong {
  color: inherit;
  font-weight: 800;
  text-decoration-color: #7668dc;
  text-decoration-thickness: 0.13em;
  text-underline-offset: 0.15em;
}
.article blockquote {
  margin: 26px 0;
  padding: 19px 20px;
  border: 1px solid #080a0d;
  border-left: 5px solid #4189f4;
  border-radius: 5px;
  background: #11141a;
  color: #f7f9fc;
  box-shadow: none;
  font-size: 16px;
  line-height: 1.8;
}
.article blockquote p,
.article blockquote strong,
.article blockquote a {
  color: #f7f9fc;
}
.article code {
  border-color: #c6d0dc;
  background: #edf3f8;
  color: inherit;
  font-weight: 650;
}
.article pre {
  border: 1px solid #080a0d;
  border-radius: 5px;
  background: #11141a;
  box-shadow: none;
}
.article pre code {
  color: #f7f9fc;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.article img {
  margin: 28px auto;
  border: 1px solid #cbd5df;
  border-radius: 4px;
  background: #fbfdff;
  box-shadow: 0 8px 22px rgba(45, 72, 101, 0.08);
}
.article hr {
  width: 7px;
  height: 7px;
  margin: 38px 0 38px 2px;
  border-radius: 999px;
  background: #4189f4;
  box-shadow: 14px 0 0 #7668dc, 28px 0 0 #64b98a;
}
.article th {
  border-color: #c8d1dc;
  background: transparent;
  color: inherit;
}
.article td {
  border-color: #cfd7e2;
  background: transparent;
  color: inherit;
}
.article a {
  border-bottom-color: currentColor;
  color: inherit;
}
.article a.weapp_text_link {
  display: inline-block;
  padding: 10px 16px;
  border: 1px solid #11141a;
  border-radius: 4px;
  background: #11141a;
  color: #ffffff;
  font-weight: 750;
}
`;
}
