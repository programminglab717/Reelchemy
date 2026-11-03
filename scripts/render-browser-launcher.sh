#!/bin/sh
# Immutable launcher: temporary storage contains configuration, never code.
set -eu
umask 077
context=
profile=
for argument do
  shift
  case "$argument" in
    --user-agent=\"ReelchemyRenderAttempt/*\")
      [ -z "$context" ] || exit 64
      context=${argument#--user-agent=\"ReelchemyRenderAttempt/}
      context=${context%\"}
      ;;
    --user-data-dir=*) profile=${argument#--user-data-dir=}; set -- "$@" "$argument" ;;
    *) set -- "$@" "$argument" ;;
  esac
done
case "$context" in
  /proc/[0-9]*/fd/[0-9]*) ;;
  *) exit 64 ;;
esac
{
  IFS= read -r token
  IFS= read -r executable
  IFS= read -r temporary_root
} < "$context/config"
[ -n "$token" ] && [ -n "$executable" ] || exit 64
export REELCHEMY_RENDER_BROWSER_ATTEMPT="$token"
IFS= read -r identity < "/proc/$$/stat"
printf '%s\n%s\n' "$$" "$identity" > "$context/process"
case "$profile" in
  "$temporary_root"/puppeteer_dev_chrome_profile-??????)
    profile_identity=$(stat -Lc '%d:%i' -- "$profile" 2>/dev/null) || exit 64
    printf '%s\n%s\n' "$profile" "$profile_identity" > "$context/profile"
    ;;
  *) exit 64 ;;
esac
exec "$executable" "$@"
