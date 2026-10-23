export const INLINE_LOGIN_POLL_MS = 1800;
export const INLINE_LOGIN_RELOAD_MS = 800;

/** 每次打开或刷新二维码都有独立生命周期，迟到的请求不能重新启动轮询。 */
export class InlineLoginRun {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get active(): boolean {
    return !this.signal.aborted;
  }

  schedule(callback: () => void, delay: number): void {
    if (!this.active) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.active) callback();
    }, delay);
  }

  stop(): void {
    this.controller.abort();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

export class InlineLoginLifecycle {
  private current: InlineLoginRun | null = null;

  restart(): InlineLoginRun {
    this.stop();
    this.current = new InlineLoginRun();
    return this.current;
  }

  stop(): void {
    this.current?.stop();
    this.current = null;
  }

  bindPageHide(target: EventTarget, onPause?: () => void): () => void {
    const stop = () => {
      this.stop();
      onPause?.();
    };
    target.addEventListener('pagehide', stop);
    return () => {
      target.removeEventListener('pagehide', stop);
      this.stop();
    };
  }
}
