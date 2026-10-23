export function claudeLabOverrides(): string {
  return `
.article {
  padding: 26px 8px 38px;
  border-top: 8px solid #22d3ee;
  background-color: #08121a;
  background-image: radial-gradient(circle at 105% -4%, rgba(34, 211, 238, 0.13) 0%, rgba(34, 211, 238, 0) 34%), linear-gradient(180deg, #08121a 0%, #071018 100%);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.9;
  letter-spacing: 0.012em;
}
.article h1 {
  margin: 0 0 32px;
  padding: 26px 22px 28px;
  border: 1px solid #294854;
  border-radius: 10px;
  background: #050c11;
  color: #f8fafc;
  box-shadow: inset 0 0 28px rgba(34, 211, 238, 0.06);
  font-family: "SFMono-Regular", Menlo, Consolas, "PingFang SC", monospace;
  font-size: 28px;
  line-height: 1.35;
  font-weight: 760;
  letter-spacing: -0.025em;
  word-break: keep-all;
}
.article > p:first-of-type {
  color: #c8d8df;
  font-size: 18px;
  line-height: 1.8;
}
.article h2 {
  margin: 42px 0 18px;
  padding: 14px 16px;
  border-top: 1px solid #29414d;
  border-right: 1px solid #29414d;
  border-bottom: 1px solid #29414d;
  border-left: 5px solid #22d3ee;
  border-radius: 6px;
  background: #0b1820;
  color: #f8fafc;
  font-family: "SFMono-Regular", Menlo, Consolas, "PingFang SC", monospace;
  font-size: 21px;
  line-height: 1.48;
  font-weight: 740;
}
.article h3 {
  color: #67e8f9;
  font-family: "SFMono-Regular", Menlo, Consolas, "PingFang SC", monospace;
  font-size: 16px;
  font-weight: 720;
  letter-spacing: 0.065em;
}
.article p,
.article li {
  color: #d7e3e9;
}
.article strong {
  color: #ffffff;
  font-weight: 780;
  text-decoration-color: #22d3ee;
  text-decoration-thickness: 0.12em;
}
.article blockquote {
  padding: 18px 18px;
  border: 1px solid #29414d;
  border-left: 5px solid #86efac;
  border-radius: 7px;
  background: #03090d;
  color: #bcecf4;
  font-family: "SFMono-Regular", Menlo, Consolas, "PingFang SC", monospace;
  font-size: 14px;
  line-height: 1.78;
}
.article blockquote p,
.article blockquote strong {
  color: #dff8ff;
}
.article code {
  border-color: #24505d;
  background: #03090d;
  color: #86efac;
  font-weight: 650;
}
.article pre {
  border: 1px solid #29414d;
  border-radius: 7px;
  background: #03090d;
  box-shadow: inset 0 0 24px rgba(34, 211, 238, 0.04);
}
.article pre code {
  color: #dff8ff;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.article img {
  border: 1px solid #29414d;
  border-radius: 8px;
  background: #f8fafc;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
}
.article hr {
  height: 2px;
  background: linear-gradient(90deg, #22d3ee 0%, #86efac 100%);
}
.article th {
  border-color: #31515f;
  background: #10242e;
  color: #f8fafc;
}
.article td {
  border-color: #29414d;
  background: #09151d;
  color: #d7e3e9;
}
.article a.weapp_text_link {
  display: inline-block;
  padding: 9px 15px;
  border: 1px solid #67e8f9;
  border-radius: 6px;
  background: #22d3ee;
  color: #061017;
  font-family: "SFMono-Regular", Menlo, Consolas, "PingFang SC", monospace;
  font-weight: 760;
}
`;
}

export function claudeEngineeringOverrides(): string {
  return `
.article {
  padding: 28px 8px 38px;
  border-top: 12px solid currentColor;
  background: #f3f0e8;
  color: inherit;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 17px;
  line-height: 1.9;
  letter-spacing: 0.008em;
}
.article h1 {
  margin: 0 0 34px;
  padding: 0 0 26px;
  border-bottom: 3px solid currentColor;
  color: inherit;
  font-size: 31px;
  line-height: 1.25;
  font-weight: 850;
  letter-spacing: -0.045em;
}
.article > p:first-of-type {
  margin-bottom: 26px;
  color: inherit;
  font-family: "Songti SC", "STSong", Georgia, serif;
  font-size: 19px;
  line-height: 1.85;
}
.article h2 {
  margin: 44px 0 20px;
  padding: 16px 0 13px;
  border-top: 3px solid currentColor;
  border-bottom: 1px solid currentColor;
  border-left: 0;
  color: inherit;
  font-size: 23px;
  line-height: 1.4;
  font-weight: 830;
  letter-spacing: -0.025em;
}
.article h3 {
  color: inherit;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.article p,
.article li {
  color: inherit;
}
.article strong {
  color: inherit;
  font-weight: 830;
  text-decoration-color: #7c8961;
  text-decoration-thickness: 0.16em;
  text-underline-offset: 0.12em;
}
.article blockquote {
  padding: 8px 0 8px 20px;
  border-top: 0;
  border-right: 0;
  border-bottom: 0;
  border-left: 9px solid #7c8961;
  background: #f3f0e8;
  color: inherit;
  font-family: "Songti SC", "STSong", Georgia, serif;
  font-size: 17px;
  line-height: 1.82;
}
.article code {
  border-color: #aaa69b;
  border-radius: 2px;
  background: #e9e3d8;
  color: inherit;
  font-weight: 650;
}
.article pre {
  padding: 18px 0;
  border-top: 2px solid currentColor;
  border-right: 0;
  border-bottom: 2px solid currentColor;
  border-left: 0;
  border-radius: 0;
  background: #f3f0e8;
  color: inherit;
}
.article pre code {
  color: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.article img {
  border: 1px solid #8f8b82;
  border-radius: 0;
  background: #f3f0e8;
  box-shadow: none;
}
.article hr {
  height: 3px;
  background: currentColor;
}
.article th {
  border-color: #11110f;
  background: #11110f;
  color: #f3f0e8;
}
.article td {
  border-color: #8f8b82;
  background: #f3f0e8;
  color: inherit;
}
.article a {
  border-bottom-color: currentColor;
  color: inherit;
}
.article a.weapp_text_link {
  display: inline-block;
  padding: 9px 15px;
  border: 2px solid #11110f;
  border-radius: 0;
  background: #7c8961;
  color: #11110f;
  font-weight: 820;
}
`;
}
