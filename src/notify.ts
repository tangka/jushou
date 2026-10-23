import { config } from './config/index.js';
import { AuthExpiredError, RateLimitError } from './errors.js';

// 失败通知(ADR 0004):只报失败,不报成功。可插拔——默认飞书 webhook 格式化器。
// 限流不报(退避重试);登录失效报且提示去宿主重新扫码;其他报摘要。同次运行同类只报一次。

export type FailureKind = 'rate_limit' | 'auth_expired' | 'other';

export function classifyFailure(error: unknown): FailureKind {
  if (error instanceof RateLimitError) return 'rate_limit';
  if (error instanceof AuthExpiredError) return 'auth_expired';
  return 'other';
}

/** 飞书自定义机器人文本消息体。换通道(Telegram/企业微信)时只改这个 formatter。 */
function feishuTextPayload(text: string): string {
  return JSON.stringify({ msg_type: 'text', content: { text } });
}

const reportedKinds = new Set<FailureKind>();

/** 新一轮运行开始时调用,清空"同类只报一次"的去重状态。 */
export function resetNotifications(): void {
  reportedKinds.clear();
}

/** 里程碑通知:目标达标这类「需要人去行动」的事件主动报一次(去重由调用方靠库保证)。 */
export async function notifyMilestone(text: string): Promise<boolean> {
  if (!config.notifyWebhookUrl) {
    console.log(`[notify] 里程碑(未配 NOTIFY_WEBHOOK_URL,仅日志):\n${text}`);
    return false;
  }
  try {
    const resp = await fetch(config.notifyWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: feishuTextPayload(text),
    });
    if (!resp.ok) {
      console.error(`[notify] 里程碑 webhook 返回 ${resp.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[notify] 里程碑推送失败:', e);
    return false;
  }
}

/** 根据失败类型决定是否推送 + 推送内容。返回是否真正推送了。 */
export async function notifyFailure(stage: string, error: unknown): Promise<boolean> {
  const kind = classifyFailure(error);
  const detail = error instanceof Error ? error.message : String(error);

  if (kind === 'rate_limit') {
    console.warn(`[notify] ${stage} 限流,不报警(退避重试):${detail}`);
    return false;
  }
  if (reportedKinds.has(kind)) {
    console.warn(`[notify] ${stage} 同类失败(${kind})已报过,跳过`);
    return false;
  }
  reportedKinds.add(kind);

  const text =
    kind === 'auth_expired'
      ? `⚠️ 公众号采集:登录态失效\n阶段:${stage}\n处理:到宿主机打开扫码页(pnpm dev)重新登录\n详情:${detail}`
      : `⚠️ 公众号采集失败\n阶段:${stage}\n详情:${detail}`;

  if (!config.notifyWebhookUrl) {
    console.warn(`[notify] 未配置 NOTIFY_WEBHOOK_URL,仅本地日志:\n${text}`);
    return false;
  }

  try {
    const resp = await fetch(config.notifyWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: feishuTextPayload(text),
    });
    if (!resp.ok) {
      console.error(`[notify] 飞书 webhook 返回 ${resp.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[notify] 推送失败:', e);
    return false;
  }
}
