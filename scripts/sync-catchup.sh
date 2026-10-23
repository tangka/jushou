#!/bin/zsh
# catch-up 兜底:补跑被睡眠/关机漏掉的 daily-sync。
# launchd 以 StartInterval(每小时)+ RunAtLoad 触发;macOS 唤醒后会立即补发错过的 tick,
# 于是「合盖一整天后唤醒」也能在醒来后尽快补跑一次。靠打卡文件去重,一天最多补一次。
set -euo pipefail
SCRIPT_DIR="${0:A:h}"
REPO="${SCRIPT_DIR:h}"
cd "$REPO" || exit 1
source "$REPO/scripts/operator-runtime.sh"
mkdir -p "$REPO/.data"
CATCHUP_AFTER="$(operator_config sync-catchup-after)"
STAMP="$REPO/.data/.last-sync-day"
LOG="$REPO/.data/launchd-sync.log"
TODAY="$(date +%F)"
HM="$(date +%H%M)"

if [ -f "$STAMP" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$TODAY" ]; then
  exit 0
fi
if [ "$HM" -lt "$CATCHUP_AFTER" ]; then
  exit 0
fi

echo "$(date '+%F %T') [catch-up] 今天尚未同步,补跑。" >> "$LOG" 2>&1
exec /bin/zsh "$REPO/scripts/daily-sync.sh"
