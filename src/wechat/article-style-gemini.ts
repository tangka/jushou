export function geminiFluidOverrides(): string {
  return `
.article {
  padding: 24px 8px 38px;
  border-top: 1px solid #d9e2f2;
  background: #ffffff;
  color: inherit;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
  font-size: 17px;
  line-height: 1.9;
  letter-spacing: 0.006em;
}
.article h1 {
  margin: 0 0 34px;
  padding: 38px 24px 40px;
  border: 0;
  border-radius: 28px;
  background-color: #1a73e8;
  background-image: radial-gradient(circle at 8% 10%, rgba(72, 133, 237, 0.98) 0%, rgba(72, 133, 237, 0) 38%), radial-gradient(circle at 88% 14%, rgba(196, 111, 224, 0.95) 0%, rgba(196, 111, 224, 0) 40%), radial-gradient(circle at 82% 92%, rgba(234, 67, 53, 0.72) 0%, rgba(234, 67, 53, 0) 40%), linear-gradient(135deg, #0b57d0 0%, #5f6eea 46%, #b060d4 72%, #e56b73 100%);
  box-shadow: inset 0 0 48px rgba(255, 255, 255, 0.14), 0 14px 34px rgba(70, 95, 170, 0.16);
  color: #ffffff;
  font-size: 30px;
  line-height: 1.28;
  font-weight: 760;
  letter-spacing: -0.035em;
  text-align: left;
  text-shadow: 0 2px 16px rgba(25, 38, 87, 0.2);
}
.article > p:first-of-type {
  margin-bottom: 25px;
  color: inherit;
  font-size: 19px;
  line-height: 1.82;
  font-weight: 520;
}
.article h2 {
  margin: 42px 0 20px;
  padding: 16px 18px;
  border: 0;
  border-radius: 18px;
  background-color: #eef3ff;
  background-image: linear-gradient(100deg, rgba(66, 133, 244, 0.13) 0%, rgba(156, 96, 217, 0.11) 52%, rgba(234, 67, 53, 0.08) 100%);
  color: inherit;
  font-size: 22px;
  line-height: 1.42;
  font-weight: 720;
  letter-spacing: -0.018em;
}
.article h3 {
  color: inherit;
  font-size: 17px;
  font-weight: 730;
}
.article p,
.article li {
  color: inherit;
}
.article strong {
  color: inherit;
  font-weight: 760;
  text-decoration-color: #8ab4f8;
  text-decoration-thickness: 0.15em;
  text-underline-offset: 0.13em;
}
.article blockquote {
  padding: 19px 20px;
  border: 1px solid #d5e1f7;
  border-left: 5px solid #4285f4;
  border-radius: 18px;
  background: #eef3ff;
  color: inherit;
  box-shadow: 0 8px 24px rgba(60, 90, 150, 0.08);
}
.article code {
  border-color: #d2def2;
  border-radius: 8px;
  background: #edf3fc;
  color: inherit;
  font-weight: 630;
}
.article pre {
  border: 0;
  border-radius: 18px;
  background: #171a2d;
  box-shadow: 0 12px 28px rgba(31, 44, 90, 0.13);
}
.article pre code {
  color: #e8eeff;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.article img {
  margin: 28px auto;
  border: 1px solid #e0e6f1;
  border-radius: 24px;
  background: transparent;
  box-shadow: 0 12px 32px rgba(60, 90, 150, 0.11);
}
.article hr {
  width: 92px;
  height: 5px;
  margin: 38px 0;
  border-radius: 999px;
  background: linear-gradient(90deg, #4285f4 0%, #a96bdb 38%, #ea4335 68%, #fbbc04 84%, #34a853 100%);
}
.article th {
  border-color: #d1ddf1;
  background: #e8f0fe;
  color: inherit;
}
.article td {
  border-color: #dbe4f3;
  background: #ffffff;
  color: inherit;
}
.article a {
  border-bottom-color: currentColor;
  color: inherit;
}
.article a.weapp_text_link {
  display: inline-block;
  padding: 10px 17px;
  border: 0;
  border-radius: 999px;
  background: #0b57d0;
  color: #ffffff;
  font-weight: 720;
}
`;
}
