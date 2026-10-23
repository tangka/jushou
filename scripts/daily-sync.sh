#!/bin/zsh
# 本机定时数据补刷:自动扫描 .env / .env.<账号>,逐号执行 pnpm sync:data。
# 当天出稿主链路在 daily-draft.sh;这里不再抢在出稿前跑完整 sync。
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO="${SCRIPT_DIR:h}"
cd "$REPO" || exit 1
source "$REPO/scripts/operator-runtime.sh"
source "$REPO/scripts/account-envs.sh"
mkdir -p "$REPO/.data"
LOG="$REPO/.data/launchd-sync.log"
LOCK="$REPO/.data/.sync.lock"     # mkdir 原子锁:主同步 + catch-up 撞车时只跑一个
STAMP="$REPO/.data/.last-sync-day" # 打卡:跑完写当天日期,catch-up 据此一天只补跑一次
DRAFT_STAMP="$REPO/.data/.last-draft-day"
TODAY="$(date +%F)"

if [[ "${FORCE_SYNC_BEFORE_DRAFT:-0}" != "1" && "$(cat "$DRAFT_STAMP" 2>/dev/null)" != "$TODAY" ]]; then
  echo "$(date '+%F %T') [skip] 今天尚未出稿,不先补数据。先跑 scripts/daily-draft.sh。" >> "$LOG" 2>&1
  exit 0
fi

# 抢锁:已有同步在跑就退出,避免并发重跑(catch-up 之所以反复跑,就是因为没这层 + 没打卡)
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') [skip] 已有同步在跑(锁存在),本次跳过。" >> "$LOG" 2>&1
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

{
  echo "================ $(date '+%F %T') 定时数据补刷开始 ================"
  while IFS= read -r env_file; do
    echo "----- $(account_env_label "$env_file") (${env_file:t}) -----"
    run_for_account_env "$env_file" pnpm sync:data
  done < <(account_env_files "$REPO")
  echo "================ $(date '+%F %T') 定时数据补刷结束 ================"
} >> "$LOG" 2>&1

# 打卡当天日期:catch-up 看到 == 今天就不再补跑(避免每小时重跑、触发限流)
date +%F > "$STAMP"
