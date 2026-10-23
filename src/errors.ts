// 类型化错误层(ADR 0006):让"限流不报 / 登录失效报"靠错误类型分流,而非字符串匹配。

export abstract class AppError extends Error {
  abstract readonly code: string;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** 微信后台限流(短时间打太多次)。退避重试,**不**报警(ADR 0004)。 */
export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMIT';
}

/** 登录态失效(cookie/token 过期)。应报警并提示去宿主重新扫码。 */
export class AuthExpiredError extends AppError {
  readonly code = 'AUTH_EXPIRED';
}

/**
 * 单篇内容分析页缺 `window.wx.cgiData`。
 * 注意:**单篇**缺失可能只是"当天新文章后台还没出数据";若**所有文章**都缺,才是限流(见 CLAUDE.md)。
 */
export class CgiDataNotFoundError extends AppError {
  readonly code = 'CGI_DATA_NOT_FOUND';
}

/** 上游 HTTP 非 2xx。 */
export class UpstreamError extends AppError {
  readonly code = 'UPSTREAM';
  readonly status: number;
  constructor(status: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
  }
}
