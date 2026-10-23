import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountsResponse, DashboardAccount, DashboardPlatform, DashboardTask, PlatformHealth } from './defs';

const card: CSSProperties = {
  marginTop: 16,
  background: '#fff',
  borderRadius: 8,
  padding: 16,
  boxShadow: '0 1px 4px rgba(0,0,0,.06)',
};

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

const primaryButton: CSSProperties = {
  ...button,
  borderColor: '#0ea5e9',
  background: '#e0f2fe',
  color: '#0369a1',
};

const disabledButton: CSSProperties = {
  ...button,
  cursor: 'not-allowed',
  opacity: 0.55,
};

const platformGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(72px, 0.8fr) minmax(92px, 1fr) minmax(124px, 1fr)',
  gap: 8,
  alignItems: 'center',
};

function healthStyle(health: PlatformHealth): { bg: string; color: string; border: string } {
  if (health === 'ok') return { bg: '#dcfce7', color: '#166534', border: '#bbf7d0' };
  if (health === 'attention') return { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' };
  if (health === 'warning') return { bg: '#fef3c7', color: '#92400e', border: '#fde68a' };
  if (health === 'muted') return { bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' };
  return { bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' };
}

function StatusPill({ platform }: { platform: DashboardPlatform }) {
  const tone = healthStyle(platform.health);
  return (
    <span
      style={{
        display: 'inline-flex',
        justifySelf: 'start',
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        padding: '3px 8px',
        fontSize: 12,
        background: tone.bg,
        color: tone.color,
      }}
    >
      {platform.statusLabel}
    </span>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) throw new Error(await resp.text());
  return (await resp.json()) as T;
}

function selectedAccountQuery(): string {
  const account = new URLSearchParams(window.location.search).get('account');
  return account ? `?account=${encodeURIComponent(account)}` : '';
}

function platformActionLabel(platform: DashboardPlatform): string {
  if (platform.actionLabel) return platform.actionLabel;
  if (platform.key === 'mp') return platform.health === 'ok' ? '重扫' : '扫码';
  if (platform.key === 'channels' && platform.state === 'none') return '初始化';
  return platform.health === 'ok' ? '重扫' : '扫码';
}

function PlatformRow({
  account,
  platform,
  pending,
  onOpenLogin,
  onRunTask,
}: {
  account: DashboardAccount;
  platform: DashboardPlatform;
  pending: string;
  onOpenLogin: (account: DashboardAccount, platform: DashboardPlatform) => void;
  onRunTask: (account: DashboardAccount, platform: DashboardPlatform) => void;
}) {
  const pendingKey = `${account.id}:${platform.key}`;
  const canRun =
    platform.actionKind === 'task'
      ? !!platform.taskUrl && platform.available
      : !!platform.loginUrl && platform.available;
  return (
    <div style={{ ...platformGrid, padding: '9px 0', borderTop: '1px solid #edf2f7' }}>
      <div style={{ fontWeight: 650, color: '#0f172a', fontSize: 13 }}>{platform.label}</div>
      <StatusPill platform={platform} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {platform.entryUrl && (
          <button
            type="button"
            style={button}
            onClick={() => {
              window.location.href = platform.entryUrl || account.dashboardUrl;
            }}
          >
            进入
          </button>
        )}
        <button
          type="button"
          style={canRun ? primaryButton : disabledButton}
          disabled={!canRun || pending === pendingKey}
          onClick={() => {
            if (platform.actionKind === 'task') onRunTask(account, platform);
            else onOpenLogin(account, platform);
          }}
        >
          {platformActionLabel(platform)}
        </button>
      </div>
    </div>
  );
}

export function AccountManager({ selectedAccountId }: { selectedAccountId: string }) {
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [task, setTask] = useState<DashboardTask | null>(null);

  const load = useCallback(async () => {
    setError('');
    setData(await fetchJson<AccountsResponse>(`/api/dashboard/accounts${selectedAccountQuery()}`));
  }, []);

  useEffect(() => {
    void load().catch(e => setError(String(e)));
  }, [load]);

  useEffect(() => {
    if (!task || task.state !== 'running') return;
    const timer = window.setInterval(() => {
      void fetchJson<DashboardTask>(`/api/dashboard/accounts/tasks/${task.id}`)
        .then(next => {
          setTask(next);
          if (next.state !== 'running') void load().catch(e => setError(String(e)));
        })
        .catch(e => setError(String(e)));
    }, 1800);
    return () => window.clearInterval(timer);
  }, [task, load]);

  const totals = useMemo(() => {
    const accounts = data?.accounts ?? [];
    const platforms = accounts.flatMap(account => account.platforms);
    return {
      accounts: accounts.length,
      platforms: platforms.length,
      ok: platforms.filter(platform => platform.health === 'ok').length,
      attention: platforms.filter(platform => platform.health === 'attention').length,
    };
  }, [data]);

  const switchAccount = (account: DashboardAccount) => {
    setPending(`switch:${account.id}`);
    window.location.href = account.dashboardUrl;
  };

  const openLogin = (account: DashboardAccount, platform: DashboardPlatform) => {
    if (!platform.loginUrl) return;
    setPending(`${account.id}:${platform.key}`);
    window.location.href = platform.loginUrl;
  };

  const runTask = async (account: DashboardAccount, platform: DashboardPlatform) => {
    if (!platform.taskUrl) return;
    setPending(`${account.id}:${platform.key}`);
    try {
      const next = await fetchJson<DashboardTask>(platform.taskUrl, { method: 'POST' });
      setTask(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setPending('');
    }
  };

  return (
    <section style={card}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <div>
          <b style={{ fontSize: 15 }}>账号中心</b>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>
            {totals.accounts} 账号 · {totals.platforms} 平台 · {totals.ok} 正常 · {totals.attention} 待处理
          </div>
        </div>
        <button type="button" style={button} onClick={() => void load().catch(e => setError(String(e)))}>
          刷新
        </button>
      </div>
      {error && <div style={{ marginTop: 10, color: '#b91c1c', fontSize: 13 }}>{error}</div>}
      {!data ? (
        <div style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>加载中...</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 12,
            marginTop: 12,
          }}
        >
          {data.accounts.map(account => (
            <div key={account.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 750, color: '#0f172a' }}>{account.account}</div>
                  <div
                    style={{
                      color: '#94a3b8',
                      fontSize: 12,
                      marginTop: 2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 360,
                    }}
                    title={`${account.file} · ${account.dashboardUrl}`}
                  >
                    {account.file} · {account.dashboardUrl}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {account.isSelected && (
                    <span
                      style={{
                        borderRadius: 999,
                        background: '#0f172a',
                        color: '#fff',
                        padding: '3px 8px',
                        fontSize: 12,
                      }}
                    >
                      查看中
                    </span>
                  )}
                  <button
                    type="button"
                    style={account.id === selectedAccountId ? button : primaryButton}
                    disabled={pending === `switch:${account.id}`}
                    onClick={() => switchAccount(account)}
                  >
                    打开看板
                  </button>
                </div>
              </div>
              <div style={{ ...platformGrid, color: '#64748b', fontSize: 12, marginTop: 12, paddingBottom: 6 }}>
                <span>平台</span>
                <span>状态</span>
                <span style={{ textAlign: 'right' }}>操作</span>
              </div>
              {account.platforms.map(platform => (
                <PlatformRow
                  key={platform.key}
                  account={account}
                  platform={platform}
                  pending={pending}
                  onOpenLogin={openLogin}
                  onRunTask={(targetAccount, targetPlatform) => void runTask(targetAccount, targetPlatform)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      {task && (
        <div style={{ marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <b style={{ fontSize: 13 }}>{task.title}</b>
            <span style={{ color: task.state === 'failed' ? '#b91c1c' : '#64748b', fontSize: 12 }}>{task.state}</span>
          </div>
          <pre
            style={{
              margin: '8px 0 0',
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              color: '#334155',
              maxHeight: 180,
              overflow: 'auto',
            }}
          >
            {task.output || '任务已启动,请按输出提示继续。'}
          </pre>
        </div>
      )}
    </section>
  );
}
