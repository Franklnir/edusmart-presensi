#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
TMP_FILES="$(mktemp)"
trap 'rm -f "$TMP_FILES"' EXIT

is_placeholder() {
  local raw="${1:-}"
  local value
  value="$(printf '%s' "$raw" \
    | sed -E "s/^[[:space:]]+//; s/[[:space:]]+$//; s/^['\"]//; s/['\"]$//" \
    | tr '[:upper:]' '[:lower:]')"

  case "$value" in
    ""|changeme|change_me*|change-me*|replace_me*|replace-me*|your-*|redacted|redacted_*|"<redacted"*|placeholder*|example*|dummy*|test*|null|none)
      return 0
      ;;
  esac

  return 1
}

append_candidate_files() {
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT_DIR" ls-files --cached --others --exclude-standard \
      | grep -E '(^|/)(\.env($|\.)|[^/]+\.env$)|^docs/.*\.md$' >> "$TMP_FILES" || true
  fi

  find "$ROOT_DIR" \
    \( -path "$ROOT_DIR/.git" \
      -o -path "$ROOT_DIR/node_modules" \
      -o -path "$ROOT_DIR/backend/vendor" \
      -o -path "$ROOT_DIR/backend/node_modules" \
      -o -path "$ROOT_DIR/dist" \
      -o -path "$ROOT_DIR/.local" \) -prune \
    -o -type f \( -name '.env' -o -name '.env.*' -o -name '*.env' -o -path "$ROOT_DIR/docs/*.md" \) \
    -printf '%P\n' >> "$TMP_FILES"
}

append_candidate_files

failures=0
while IFS= read -r relative_path; do
  [ -n "$relative_path" ] || continue

  case "$relative_path" in
    .git/*|node_modules/*|backend/vendor/*|backend/node_modules/*|dist/*|.local/*)
      continue
      ;;
  esac

  file_path="$ROOT_DIR/$relative_path"
  [ -f "$file_path" ] || continue
  grep -Iq . "$file_path" || continue

  line_number=0
  while IFS= read -r line || [ -n "$line" ]; do
    line_number=$((line_number + 1))
    stripped="$(printf '%s' "$line" | sed -E 's/^[[:space:]]+//')"
    case "$stripped" in
      ""|\#*)
        continue
        ;;
    esac

    if [[ "$stripped" =~ ^(MAIL_PASSWORD|SMTP_PASSWORD|SMTP_PASS|ZEPTOMAIL_API_KEY|ZEPTO_MAIL_API_KEY)[[:space:]]*= ]]; then
      key="${BASH_REMATCH[1]}"
      value="${stripped#*=}"
      if ! is_placeholder "$value"; then
        echo "::error file=${relative_path},line=${line_number},title=Secret in env/docs::${key} must be redacted or moved to a secret manager"
        failures=$((failures + 1))
      fi
    fi

    if [[ "$stripped" =~ ^MAILER_DSN[[:space:]]*= ]]; then
      value="${stripped#*=}"
      if [[ "$value" =~ ://[^:@/]+:[^@/]+@ ]] && ! is_placeholder "$value"; then
        echo "::error file=${relative_path},line=${line_number},title=Secret in mail DSN::MAILER_DSN must not contain an inline password"
        failures=$((failures + 1))
      fi
    fi
  done < "$file_path"
done < <(sort -u "$TMP_FILES")

if [ "$failures" -gt 0 ]; then
  echo "Secret preflight failed: redact local env/report files before backup, commit, or deploy."
  exit 1
fi

echo "Secret preflight passed: no SMTP/ZeptoMail credentials found in env/docs."
