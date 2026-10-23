#!/bin/zsh

ACCOUNT_ENV_SCRIPT_DIR="${${(%):-%x}:A:h}"

account_env_files() {
  local root="${WECHAT_ENV_DIR:-${1:-${ACCOUNT_ENV_SCRIPT_DIR:h}}}"
  node "$ACCOUNT_ENV_SCRIPT_DIR/operator-config.mjs" account-files "$root"
}

account_env_id() {
  local file="$1"
  local base="${file:t}"
  [[ "$base" == ".env" ]] && print -r -- "" || print -r -- "${base#.env.}"
}

account_env_value() {
  local file="$1"
  local key="$2"
  sed -nE "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$/\\1/p" "$file" \
    | tail -n 1 \
    | sed -E "s/^['\"]//; s/['\"]$//"
}

account_env_label() {
  local file="$1"
  local root="${file:A:h}"
  node "$ACCOUNT_ENV_SCRIPT_DIR/operator-config.mjs" account-label "$(account_env_id "$file")" "$root"
}

run_for_account_env() {
  local file="$1"
  shift
  local id
  id="$(account_env_id "$file")"
  if [[ -n "$id" ]]; then
    WECHAT_ENV_DIR="${file:A:h}" WECHAT_ACCOUNT="$id" "$@"
  else
    env -u WECHAT_ACCOUNT WECHAT_ENV_DIR="${file:A:h}" "$@"
  fi
}
