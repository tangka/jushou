#!/bin/zsh
# Source this helper after deriving REPO from the script location. Never evaluate JSON as shell code.
operator_profile="${WECHAT_OPERATOR_PROFILE:-${WOA_OPERATOR_PROFILE:-$REPO/operator.local.json}}"
[[ "$operator_profile" == /* ]] || operator_profile="$REPO/$operator_profile"
operator_node="$(command -v node || true)"
if [[ -z "$operator_node" && -x /usr/bin/plutil && -f "$operator_profile" ]]; then
  operator_node="$(/usr/bin/plutil -extract runtime.nodeExecutable raw -o - "$operator_profile" 2>/dev/null || true)"
fi
[[ -n "$operator_node" && -x "$operator_node" ]] || {
  echo "找不到 Node；请配置 PATH 或私有字段 runtime.nodeExecutable" >&2
  return 1
}
operator_config() {
  "$operator_node" "$REPO/scripts/operator-config.mjs" "$@"
}
operator_path="$(operator_config runtime-path)" || return 1
export PATH="${operator_node:h}:$operator_path"
