import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardOverviewAccount } from './defs';
import {
  INLINE_LOGIN_POLL_MS,
  INLINE_LOGIN_RELOAD_MS,
  InlineLoginLifecycle,
  type InlineLoginRun,
} from './inline-login-lifecycle';

const button: CSSProperties = {
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#0f172a',
  borderRadius: 6,
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

function accountQuery(accountId: string): string {
  return `account=${encodeURIComponent(accountId)}`;
}

export function InlineMpLogin({ account }: { account: DashboardOverviewAccount }) {
  const lifecycle = useRef(new InlineLoginLifecycle());
  const [qrUrl, setQrUrl] = useState('');
  const [message, setMessage] = useState('正在获取二维码...');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'confirming' | 'success' | 'error'>('loading');

  const withAccount = useCallback(
    (path: string): string => `${path}${path.includes('?') ? '&' : '?'}${accountQuery(account.id)}`,
    [account.id]
  );

  const bizLogin = useCallback(
    async (run: InlineLoginRun, sid: string) => {
      if (!run.active) return;
      setPhase('confirming');
      setMessage('已确认,正在登录...');
      try {
        const resp = await fetch(withAccount(`/api/web/login/inline/bizlogin/${sid}`), {
          method: 'POST',
          signal: run.signal,
        }).then(r => r.json());
        if (!run.active) return;
        if (resp.err) throw new Error(resp.err);
        setPhase('success');
        setMessage(`登录成功:${resp.nickname}`);
        run.schedule(() => window.location.reload(), INLINE_LOGIN_RELOAD_MS);
      } catch (e) {
        if (!run.active) return;
        setPhase('error');
        setMessage(e instanceof Error ? e.message : String(e));
      }
    },
    [withAccount]
  );

  const poll = useCallback(
    (run: InlineLoginRun, sid: string): void => {
      run.schedule(async () => {
        try {
          const resp = await fetch(withAccount(`/api/web/login/inline/scan/${sid}`), { signal: run.signal }).then(r =>
            r.json()
          );
          if (!run.active) return;
          if (resp.err) throw new Error(resp.err);
          if (!resp?.base_resp || resp.base_resp.ret !== 0) return poll(run, sid);
          if (resp.status === 0) return poll(run, sid);
          if (resp.status === 1) return void bizLogin(run, sid);
          if (resp.status === 2 || resp.status === 3) {
            setQrUrl(withAccount(`/api/web/login/inline/getqrcode/${sid}?rnd=${Date.now()}`));
            return poll(run, sid);
          }
          if (resp.status === 4 || resp.status === 6) {
            setMessage(resp.acct_size >= 1 ? '扫码成功,请在手机上确认' : '没有可登录账号');
            return poll(run, sid);
          }
          return poll(run, sid);
        } catch (e) {
          if (!run.active) return;
          setPhase('error');
          setMessage(e instanceof Error ? e.message : String(e));
        }
      }, INLINE_LOGIN_POLL_MS);
    },
    [bizLogin, withAccount]
  );

  const start = useCallback(async () => {
    const run = lifecycle.current.restart();
    const sid = `card-${account.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    setPhase('loading');
    setMessage('正在获取二维码...');
    setQrUrl('');
    try {
      const resp = await fetch(withAccount(`/api/web/login/inline/session/${sid}`), {
        method: 'POST',
        signal: run.signal,
      }).then(r => r.json());
      if (!run.active) return;
      if (!resp?.base_resp || resp.base_resp.ret !== 0) {
        throw new Error(resp?.base_resp?.err_msg || resp?.err || '获取登录会话失败');
      }
      setQrUrl(withAccount(`/api/web/login/inline/getqrcode/${sid}?rnd=${Date.now()}`));
      setPhase('ready');
      setMessage('公众号登录已过期,请用微信扫码');
      poll(run, sid);
    } catch (e) {
      if (!run.active) return;
      setPhase('error');
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [account.id, poll, withAccount]);

  useEffect(() => {
    const cleanup = lifecycle.current.bindPageHide(window, () => {
      setPhase('error');
      setMessage('登录已暂停，请刷新二维码继续');
    });
    void start();
    return cleanup;
  }, [start]);

  return (
    <div
      style={{
        marginTop: 14,
        borderTop: '1px solid #edf2f7',
        paddingTop: 14,
        display: 'grid',
        gridTemplateColumns: '112px minmax(0, 1fr)',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div
        style={{
          width: 112,
          height: 112,
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          background: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {qrUrl ? (
          <img src={qrUrl} alt={`${account.account} 公众号登录二维码`} style={{ width: 112, height: 112 }} />
        ) : (
          <span style={{ color: '#94a3b8', fontSize: 12 }}>二维码</span>
        )}
      </div>
      <div>
        <div
          style={{
            color: phase === 'success' ? '#16a34a' : phase === 'error' ? '#b91c1c' : '#64748b',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
        <button
          type="button"
          style={{ ...button, marginTop: 8 }}
          onClick={() => void start()}
          disabled={phase === 'confirming' || phase === 'success'}
        >
          刷新二维码
        </button>
      </div>
    </div>
  );
}
