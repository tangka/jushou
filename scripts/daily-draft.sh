#!/bin/zsh
# 本机定时出稿主链路:自动扫描 .env / .env.<账号>,并行拉素材、出稿、上传草稿箱、发布视频号,再并行补数据。
# 不再等待完整 sync。顺序固定为:登录检查 → 各账号并行拉素材+出稿 → 上传公众号草稿箱 → 发布视频号 → 各账号并行补互动/粉丝/收益/视频号数据。
# 本地跑(Docker 里没 Codex/Claude SDK 登录态);需 ~/.codex 登录 + ANTHROPIC_API_KEY/claude 登录。
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO="${SCRIPT_DIR:h}"
cd "$REPO" || exit 1
source "$REPO/scripts/operator-runtime.sh"
source "$REPO/scripts/account-envs.sh"
mkdir -p "$REPO/.data"
LOG="$REPO/.data/launchd-draft.log"
LOCK="$REPO/.data/.draft.lock"
SYNC_STAMP="$REPO/.data/.last-sync-day"     # 出稿后数据补完写当天日期
DRAFT_STAMP="$REPO/.data/.last-draft-day"   # 主链路上传草稿箱成功后写当天日期(一天只跑一次)
TODAY="$(date +%F)"
RUN_DIR="$REPO/.data/daily-draft-$TODAY-$$"

safe_job_name() {
  basename "$1" | tr -c 'A-Za-z0-9_.-' '_'
}

start_account_job() {
  local stage="$1"
  local env_file="$2"
  local label="$3"
  local log_file="$4"
  shift 4

  (
    echo "================ $(date '+%F %T') [$stage] $label 开始 ================"
    "$@" "$env_file"
    echo "================ $(date '+%F %T') [$stage] $label 结束 ================"
  ) > "$log_file" 2>&1 &
  pids+=($!)
  labels+=("$label")
  logs+=("$log_file")
}

wait_account_jobs() {
  local stage="$1"
  local failed=0
  local i pid label log_file rc
  for (( i = 1; i <= ${#pids[@]}; i++ )); do
    pid="${pids[$i]}"
    label="${labels[$i]}"
    log_file="${logs[$i]}"
    if wait "$pid"; then
      echo "[$stage] ✓ $label 完成;日志:$log_file"
    else
      rc=$?
      failed=1
      echo "[$stage] ✗ $label 失败(exit $rc);日志:$log_file"
      sed "s/^/[$stage][$label] /" "$log_file" | tail -n 120
    fi
  done
  return "$failed"
}

run_materials_and_draft_for_account() {
  local env_file="$1"
  run_for_account_env "$env_file" pnpm sync:materials
  run_for_account_env "$env_file" pnpm draft
}

run_data_for_account() {
  local env_file="$1"
  run_for_account_env "$env_file" pnpm sync:data
}

run_upload_draft_for_account() {
  local env_file="$1"
  if [[ -n "$(operator_config remote-host)" || "$(operator_config remote-mode)" == "remote" ]]; then
    "$REPO/scripts/remote-upload-draft.sh" --env "$env_file"
    return
  fi
  run_for_account_env "$env_file" pnpm upload-draft -- --dry-run
  run_for_account_env "$env_file" pnpm upload-draft
}

run_publish_channels_for_account() {
  local env_file="$1"
  run_for_account_env "$env_file" pnpm channels:publish-today -- --publish
}

# 今天已出过稿 → 跳过(多次触发只出一次)
if [[ "$(cat "$DRAFT_STAMP" 2>/dev/null)" == "$TODAY" ]]; then
  echo "$(date '+%F %T') [skip] 今天已出过稿。" >> "$LOG" 2>&1
  exit 0
fi
# 抢锁:避免并发
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') [skip] 已有出稿在跑。" >> "$LOG" 2>&1
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

{
  echo "================ $(date '+%F %T') 定时出稿开始 ================"
  mkdir -p "$RUN_DIR"
  echo "----- 登录检查 -----"
  pnpm login-check
  echo "----- 各账号并行:素材 → 出稿 -----"
  pids=()
  labels=()
  logs=()
  while IFS= read -r env_file; do
    label="$(account_env_label "$env_file")"
    log_file="$RUN_DIR/materials-draft-$(safe_job_name "$env_file").log"
    echo "[$label] 已启动;日志:$log_file"
    start_account_job "素材+出稿" "$env_file" "$label" "$log_file" run_materials_and_draft_for_account
  done < <(account_env_files "$REPO")
  wait_account_jobs "素材+出稿"

  echo "----- 各账号并行:上传公众号草稿箱 -----"
  pids=()
  labels=()
  logs=()
  while IFS= read -r env_file; do
    label="$(account_env_label "$env_file")"
    log_file="$RUN_DIR/upload-draft-$(safe_job_name "$env_file").log"
    echo "[$label] 已启动;日志:$log_file"
    start_account_job "上传草稿箱" "$env_file" "$label" "$log_file" run_upload_draft_for_account
  done < <(account_env_files "$REPO")
  wait_account_jobs "上传草稿箱"

  echo "----- 各账号并行:发布视频号 -----"
  pids=()
  labels=()
  logs=()
  while IFS= read -r env_file; do
    label="$(account_env_label "$env_file")"
    log_file="$RUN_DIR/channels-publish-$(safe_job_name "$env_file").log"
    echo "[$label] 已启动;日志:$log_file"
    start_account_job "视频号发布" "$env_file" "$label" "$log_file" run_publish_channels_for_account
  done < <(account_env_files "$REPO")
  wait_account_jobs "视频号发布"
  date +%F > "$DRAFT_STAMP"

  echo "----- 各账号并行:出稿后补互动/粉丝/收益/视频号数据 -----"
  pids=()
  labels=()
  logs=()
  while IFS= read -r env_file; do
    label="$(account_env_label "$env_file")"
    log_file="$RUN_DIR/data-$(safe_job_name "$env_file").log"
    echo "[$label] 已启动;日志:$log_file"
    start_account_job "补数据" "$env_file" "$label" "$log_file" run_data_for_account
  done < <(account_env_files "$REPO")
  wait_account_jobs "补数据"
  date +%F > "$SYNC_STAMP"
  echo "================ $(date '+%F %T') 定时出稿结束 ================"
} >> "$LOG" 2>&1
