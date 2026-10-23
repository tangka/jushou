#!/bin/zsh
# Upload an official-account draft from a stable remote host.
# Flow: local dry-run -> bundle uploader -> rsync one draft dir -> remote node uploader -> pull .wechat-draft.json back.
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO="${SCRIPT_DIR:h}"
cd "$REPO" || exit 1
source "$REPO/scripts/operator-runtime.sh"
source "$REPO/scripts/account-envs.sh"

usage() {
  cat <<'EOF'
用法:
  scripts/remote-upload-draft.sh [--env .env[.<account>]] [--draft <本地草稿目录或名称>] [--ensure-draft|--force|--update-media-id <media_id>] [--replace-title-from <旧标题>]

远端配置:
  operator.local.json 的 remoteUpload.host / directory；未配置则停止。

可选环境变量:
  WECHAT_REMOTE_UPLOAD_HOST   SSH 目标,覆盖私有配置
  WECHAT_REMOTE_UPLOAD_DIR    白名单机运行目录,覆盖私有配置
  WECHAT_REMOTE_DRAFT_ROOT    白名单机临时草稿根目录,默认 <WECHAT_REMOTE_UPLOAD_DIR>/drafts
  WECHAT_REMOTE_SSH_OPTS      追加给 ssh/rsync 的参数,例如 "-i ~/.ssh/tencent"
  WECHAT_REMOTE_NODE_BINARY   白名单机 Node 可执行文件绝对路径,默认 node
  WECHAT_HUMAN_WRITING_CHECKER 公众号去 AI 味检查器路径;默认读取已安装 Skill

说明:
  - 本机只做 dry-run 校验和同步草稿目录。
  - --update-media-id 必须配合 --draft,同步并复核旧 metadata 后原位更新指定 media_id。
  - --ensure-draft 必须配合 --draft,同时核对草稿箱与已发表记录后幂等处理。
  - 换题时额外传 --replace-title-from <旧标题>,本地 metadata 与远端当前标题都必须精确匹配。
  - --force 会明确创建重复草稿,与 --update-media-id 互斥。
  - 本机生成 1 个单文件上传器,白名单机须有 Node.js 22 或以上,不需要远端 pnpm/node_modules。
  - 白名单机公网 IP 是微信 API 看到的源 IP。
EOF
}

env_file="$REPO/.env"
draft_arg=""
force=0
ensure_draft=0
ensure_published_proof=""
update_media_id=""
replace_title_from=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      [[ $# -ge 2 ]] || { echo "--env 需要路径" >&2; exit 2; }
      env_file="$2"
      shift 2
      ;;
    --draft)
      [[ $# -ge 2 ]] || { echo "--draft 需要草稿目录名或路径" >&2; exit 2; }
      draft_arg="$2"
      shift 2
      ;;
    --force)
      force=1
      shift
      ;;
    --ensure-draft)
      ensure_draft=1
      shift
      ;;
    --ensure-published-proof)
      [[ $# -ge 2 && ( "$2" == "absent" || "$2" == "exact" ) ]] || {
        echo "--ensure-published-proof 只接受 absent 或 exact" >&2
        exit 2
      }
      ensure_published_proof="$2"
      shift 2
      ;;
    --update-media-id)
      [[ $# -ge 2 && -n "$2" ]] || { echo "--update-media-id 需要 media_id" >&2; exit 2; }
      update_media_id="$2"
      shift 2
      ;;
    --replace-title-from)
      [[ $# -ge 2 && -n "$2" ]] || { echo "--replace-title-from 需要当前微信草稿完整标题" >&2; exit 2; }
      replace_title_from="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数:$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$force" == "1" && -n "$update_media_id" ]]; then
  echo "--force 与 --update-media-id 互斥" >&2
  exit 2
fi
if [[ "$ensure_draft" == "1" && ( "$force" == "1" || -n "$update_media_id" ) ]]; then
  echo "--ensure-draft 与 --force/--update-media-id 互斥" >&2
  exit 2
fi
if [[ "$ensure_draft" == "1" && -z "$draft_arg" ]]; then
  echo "--ensure-draft 为避免误操作,必须同时显式传 --draft" >&2
  exit 2
fi
if [[ -n "$ensure_published_proof" && "$ensure_draft" != "1" ]]; then
  echo "--ensure-published-proof 必须配合 --ensure-draft" >&2
  exit 2
fi
if [[ -n "$update_media_id" && -z "$draft_arg" ]]; then
  echo "--update-media-id 为避免误更新,必须同时显式传 --draft" >&2
  exit 2
fi
if [[ -n "$replace_title_from" && -z "$update_media_id" ]]; then
  echo "--replace-title-from 必须配合 --update-media-id" >&2
  exit 2
fi

account_id="$(account_env_id "$env_file")"
operator_config account-exists "$account_id" "$env_file"
remote_host="$(operator_config remote-host)"
remote_dir="$(operator_config remote-directory)"
remote_root="$(operator_config remote-draft-root)"
remote_node_binary="${WECHAT_REMOTE_NODE_BINARY:-node}"
[[ "$remote_node_binary" == node || "$remote_node_binary" == /* ]] || {
  echo "WECHAT_REMOTE_NODE_BINARY 必须是绝对路径或 node" >&2
  exit 2
}
[[ -n "$remote_host" && "$remote_dir" == /* ]] || { echo "请配置远端 host 和绝对 directory" >&2; exit 1; }
if [[ "$remote_dir" == "~"* || "$remote_root" == "~"* ]]; then
  echo "远端路径请使用绝对路径,不要使用 ~: WECHAT_REMOTE_UPLOAD_DIR / WECHAT_REMOTE_DRAFT_ROOT" >&2
  exit 1
fi

account_label="$(account_env_label "$env_file")"
remote_root="${remote_root:-${remote_dir%/}/drafts}"
[[ "$remote_root" == /* ]] || { echo "远端 draftRoot 必须是绝对路径" >&2; exit 1; }
bundle_path="$REPO/.data/remote-upload-bundle/upload-wechat-draft.mjs"
human_writing_checker="${WECHAT_HUMAN_WRITING_CHECKER:-$HOME/.agents/skills/wechat-human-writing/scripts/check_prose.py}"
if [[ ! -f "$human_writing_checker" ]]; then
  human_writing_checker="$HOME/.codex/skills/wechat-human-writing/scripts/check_prose.py"
fi
[[ -f "$human_writing_checker" ]] || {
  echo "未找到公众号去 AI 味检查器:$human_writing_checker" >&2
  exit 1
}
export WECHAT_HUMAN_WRITING_CHECKER="$human_writing_checker"
remote_checker_path="${remote_dir%/}/check_prose.py"

safe_remote_segment() {
  print -r -- "$1" | tr '/:[:space:]' '____'
}

shell_quote() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  print -r -- "'$value'"
}

remote_bash() {
  local script="$1"
  shift
  local remote_command="env"
  local env_arg
  for env_arg in "$@"; do
    remote_command+=" $(shell_quote "$env_arg")"
  done
  remote_command+=" bash -s"
  "${ssh_cmd[@]}" "$remote_command" <<EOF
set -euo pipefail
$script
EOF
}

ssh_parts=()
if [[ -n "${WECHAT_REMOTE_SSH_OPTS:-}" ]]; then
  ssh_parts=(${(z)WECHAT_REMOTE_SSH_OPTS})
else
  operator_config remote-ssh-options >/dev/null
  while IFS= read -r -d $'\0' option; do
    ssh_parts+=("$option")
  done < <(operator_config remote-ssh-options)
fi
ssh_cmd=(ssh "${ssh_parts[@]}" "$remote_host")
rsync_ssh=(ssh "${ssh_parts[@]}")

build_bundle() {
  mkdir -p "${bundle_path:h}"
  npx --yes esbuild@0.27.2 dist/wechat/remote-upload-entry.js \
    --bundle \
    --platform=node \
    --format=esm \
    --target=node22 \
    --outfile="$bundle_path" \
    --banner:js='process.env.WOA_BUNDLED_ENTRY = "1"; import { createRequire as __createRequire } from "module"; const require = __createRequire(import.meta.url);' >/dev/null
}

dry_args=(dist/upload-wechat-draft.js --dry-run)
if [[ -n "$draft_arg" ]]; then
  dry_args+=(--draft "$draft_arg")
fi
if [[ "$force" == "1" ]]; then
  dry_args+=(--force)
fi
if [[ "$ensure_draft" == "1" ]]; then
  dry_args+=(--ensure-draft)
fi
if [[ -n "$ensure_published_proof" ]]; then
  dry_args+=(--ensure-published-proof "$ensure_published_proof")
fi
if [[ -n "$update_media_id" ]]; then
  dry_args+=(--update-media-id "$update_media_id")
fi
if [[ -n "$replace_title_from" ]]; then
  dry_args+=(--replace-title-from "$replace_title_from")
fi

echo "----- 本地 dry-run:${account_label} -----"
if ! dry_output="$(run_for_account_env "$env_file" node "${dry_args[@]}" 2>&1)"; then
  print -r -- "$dry_output"
  exit 1
fi
print -r -- "$dry_output"

draft_dir="$(print -r -- "$dry_output" | sed -n 's/^草稿://p' | tail -n 1)"
[[ -n "$draft_dir" ]] || { echo "无法从 dry-run 输出解析草稿路径" >&2; exit 1; }
[[ -d "$draft_dir" ]] || { echo "本地草稿目录不存在:$draft_dir" >&2; exit 1; }

draft_name="${draft_dir:t}"
remote_account_segment="$(safe_remote_segment "$account_label")"
remote_draft_dir="${remote_root%/}/${remote_account_segment}/${draft_name}"
remote_profile_path="${remote_dir%/}/profiles/${remote_account_segment}.local.json"
projection_path="${bundle_path:h}/${remote_account_segment}.local.json"
operator_config export-remote "$account_id" "${env_file:A:h}" "$remote_dir" "$projection_path"

echo "----- 构建单文件上传器 -----"
build_bundle
echo "bundle:${bundle_path} ($(wc -c < "$bundle_path" | tr -d ' ') bytes)"

echo "----- 同步上传器/当前账号配置/草稿到白名单机 -----"
remote_node_version="$("${ssh_cmd[@]}" "$(shell_quote "$remote_node_binary") --version")"
remote_node_major="${${remote_node_version#v}%%.*}"
[[ "$remote_node_major" == <-> && "$remote_node_major" -ge 22 ]] || {
  echo "远端上传需要 Node.js 22 或以上；尚未同步文件" >&2
  exit 1
}
remote_bash 'mkdir -p "$REMOTE_DIR" "$REMOTE_DRAFT_DIR" "$REMOTE_DIR/profiles" "$REMOTE_DIR/empty-env"; chmod 700 "$REMOTE_DIR" "$REMOTE_DIR/profiles" "$REMOTE_DIR/empty-env"' \
  REMOTE_DIR="$remote_dir" \
  REMOTE_DRAFT_DIR="$remote_draft_dir"
rsync -az --protect-args -e "${rsync_ssh[*]}" "$bundle_path" "${remote_host}:${remote_dir}/upload-wechat-draft.mjs"
rsync -az --protect-args -e "${rsync_ssh[*]}" "$human_writing_checker" "${remote_host}:${remote_checker_path}"
rsync -az --protect-args -e "${rsync_ssh[*]}" "$projection_path" "${remote_host}:${remote_profile_path}"
remote_bash 'chmod 600 "$REMOTE_PROFILE_PATH"' REMOTE_PROFILE_PATH="$remote_profile_path"
if [[ "$ensure_draft" == "1" ]] && \
  "${ssh_cmd[@]}" "test -f $(shell_quote "$remote_draft_dir/.wechat-draft-operation.json")"; then
  rsync -az --protect-args -e "${rsync_ssh[*]}" \
    "${remote_host}:${remote_draft_dir}/.wechat-draft-operation.json" \
    "$draft_dir/.wechat-draft-operation.json"
fi
draft_sync_args=(
  -az
  --delete
  --delete-excluded
  --protect-args
  --include='/*.md'
  --include='/editorial-brief.json'
  --include='/human-writing-review.json'
  --include='/prose-pattern-review.json'
  --include='/internal-audit/'
  --include='/internal-audit/source-audit.md'
  --include='/internal-audit/tutorial-expression-review.json'
  --include='/internal-audit/translation-review.json'
  --include='/internal-audit/translation-sources/'
  --include='/internal-audit/translation-sources/***'
  --include='/.x-asset-manifest.json'
  --include='/media/'
  --include='/media/***'
)
if [[ -n "$update_media_id" || "$ensure_draft" == "1" ]]; then
  draft_sync_args+=(--include='/.wechat-draft.json')
fi
draft_sync_args+=(--include='/.wechat-draft-operation.json')
draft_sync_args+=(--include='/.wechat-draft-state.json')
draft_sync_args+=(--exclude='*')
rsync "${draft_sync_args[@]}" -e "${rsync_ssh[*]}" "$draft_dir/" "${remote_host}:${remote_draft_dir}/"

echo "----- 白名单机上传公众号草稿箱:${account_label} -----"
remote_status=0
if remote_bash '
cd "$REMOTE_DIR"
test -f "$WECHAT_OPERATOR_PROFILE" || { echo "远端当前账号配置不存在" >&2; exit 1; }
export WECHAT_ACCOUNT="$WECHAT_ACCOUNT_ID"
args=(upload-wechat-draft.mjs --draft "$REMOTE_DRAFT_DIR")
if [[ "${REMOTE_FORCE:-0}" == "1" ]]; then
  args+=(--force)
fi
if [[ "${REMOTE_ENSURE_DRAFT:-0}" == "1" ]]; then
  args+=(--ensure-draft)
fi
if [[ -n "${REMOTE_ENSURE_PUBLISHED_PROOF:-}" ]]; then
  args+=(--ensure-published-proof "$REMOTE_ENSURE_PUBLISHED_PROOF")
fi
if [[ -n "${REMOTE_UPDATE_MEDIA_ID:-}" ]]; then
  args+=(--update-media-id "$REMOTE_UPDATE_MEDIA_ID")
fi
if [[ -n "${REMOTE_REPLACE_TITLE_FROM:-}" ]]; then
  args+=(--replace-title-from "$REMOTE_REPLACE_TITLE_FROM")
fi
"$REMOTE_NODE_BINARY" "${args[@]}"
' \
  REMOTE_DIR="$remote_dir" \
  REMOTE_NODE_BINARY="$remote_node_binary" \
  REMOTE_DRAFT_DIR="$remote_draft_dir" \
  WECHAT_OPERATOR_PROFILE="$remote_profile_path" \
  WECHAT_ENV_DIR="$remote_dir/empty-env" \
  WECHAT_ACCOUNT_ID="$account_id" \
  REMOTE_FORCE="$force" \
  REMOTE_ENSURE_DRAFT="$ensure_draft" \
  REMOTE_ENSURE_PUBLISHED_PROOF="$ensure_published_proof" \
  REMOTE_UPDATE_MEDIA_ID="$update_media_id" \
  REMOTE_REPLACE_TITLE_FROM="$replace_title_from" \
  WOA_REMOTE_UPLOAD="1" \
  WECHAT_HUMAN_WRITING_CHECKER="$remote_checker_path"; then
  remote_status=0
else
  remote_status=$?
fi

echo "----- 回同步草稿状态 -----"
for state_file in .wechat-draft.json .wechat-draft-operation.json .wechat-draft-state.json; do
  if "${ssh_cmd[@]}" "test -f $(shell_quote "$remote_draft_dir/$state_file")"; then
    rsync -az --protect-args -e "${rsync_ssh[*]}" "${remote_host}:${remote_draft_dir}/${state_file}" "$draft_dir/${state_file}"
  fi
done
if [[ "$remote_status" != "0" ]]; then
  echo "远端确保草稿失败；操作记录已尽力回同步，远端目录已保留供恢复" >&2
  exit "$remote_status"
fi
remote_bash '
rm -rf "$REMOTE_DRAFT_DIR"
chmod 700 "$REMOTE_DIR"
if [[ -d "$REMOTE_DIR/.data" ]]; then
  chmod 700 "$REMOTE_DIR/.data"
  chmod 600 "$REMOTE_DIR"/.data/wechat-api-token-*.json 2>/dev/null || true
fi
' \
  REMOTE_DIR="$remote_dir" \
  REMOTE_DRAFT_DIR="$remote_draft_dir"
echo "完成:远端草稿状态已核验并回同步"
