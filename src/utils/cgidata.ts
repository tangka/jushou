import vm from 'node:vm';
import * as cheerio from 'cheerio';
import { CgiDataNotFoundError } from '../errors.js';

/**
 * 从公众号后台内容分析页 HTML 中抽取内联的 `window.wx.cgiData = { ... }` 对象。
 *
 * 不能用正则——对象里有嵌套括号、字符串、注释。这里做一个最小的括号匹配扫描:
 * 跳过字符串(单/双/反引号)与行/块注释,数到深度归零的 `}` 截取对象字面量,再用 vm 求值。
 *
 * 返回 `unknown`:调用方必须用 zod 校验后再使用(ADR 0006:禁 any)。
 * 缺失时抛 {@link CgiDataNotFoundError}(单篇可能是当天新文,全篇皆缺才是限流)。
 */
export function parseCgiData(html: string): unknown {
  const marker = 'window.wx.cgiData = ';
  const start = html.lastIndexOf(marker);
  if (start < 0) throw new CgiDataNotFoundError('cgiData marker not found');
  const objectStart = html.indexOf('{', start + marker.length);
  if (objectStart < 0) throw new CgiDataNotFoundError('cgiData object start not found');

  let depth = 0;
  let quote = '';
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = objectStart; i < html.length; i += 1) {
    const ch = html[i];
    const next = html[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const objectCode = html.slice(objectStart, i + 1);
        return vm.runInNewContext(`(${objectCode})`, {}, { timeout: 1000 }) as unknown;
      }
    }
  }

  throw new CgiDataNotFoundError('cgiData object end not found');
}

/**
 * 从文章正文页 HTML 提取 `window.cgiDataNew` 对象(download?format=json 用)。
 *
 * 该对象在一个 `<script h5only>` 里赋值,可能伴随其它语句,故用 vm 在沙箱里跑整段脚本、
 * 再读 `window.cgiDataNew`(浏览器禁 eval,但本项目在 Node 服务端,可放心执行)。
 * 返回 `unknown`,调用方按需用 zod 校验。提取不到则返回 null。
 */
export function parseCgiDataNew(html: string): unknown {
  const $ = cheerio.load(html);
  const script = $('script[type="text/javascript"][h5only]')
    .toArray()
    .map(el => $(el).html() || '')
    .find(code => code.includes('window.cgiDataNew = '));
  if (!script) return null;

  const sandbox: { window: Record<string, unknown>; cgiDataNew?: unknown } = { window: {} };
  // 让脚本里的 window.x 与裸 x 都落进沙箱
  (sandbox.window as Record<string, unknown>).window = sandbox.window;
  try {
    vm.runInNewContext(script, sandbox, { timeout: 1000 });
  } catch {
    return null;
  }
  return sandbox.window.cgiDataNew ?? sandbox.cgiDataNew ?? null;
}
