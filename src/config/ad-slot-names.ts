import { z } from 'zod';

// 微信流量主官方 AD_POS_MAP 已核实的通用名称；账号配置仍可覆盖。
// 来源：wxa.wxs.qq.com/mpweb/delivery/build/js/publisher/publisher_report/main.ae3c6fbfe2.js
const DEFAULT_AD_SLOT_NAMES: Readonly<Record<string, string>> = Object.freeze({
  '7325953122329732': '常看列表广告',
});

export function parseAdSlotNamesConfig(value: string | undefined): Readonly<Record<string, string>> {
  const trimmed = value?.trim();
  if (!trimmed) return { ...DEFAULT_AD_SLOT_NAMES };
  try {
    const configured = trimmed.startsWith('{')
      ? z.record(z.string().min(1), z.string().min(1)).parse(JSON.parse(trimmed) as unknown)
      : Object.fromEntries(
          trimmed.split(/[;\n]/).map(item => {
            const [key, label] = item.split('=').map(part => part.trim());
            if (!key || !label) throw new Error(`无法解析条目:${item}`);
            return [key, label] as const;
          })
        );
    return { ...DEFAULT_AD_SLOT_NAMES, ...configured };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`WECHAT_AD_SLOT_NAMES 配置无效:${message}`);
  }
}
