#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' 'A supported internal job name is required.' >&2
  exit 64
fi

: "${SMS_API_ORIGIN:?SMS_API_ORIGIN is required}"
: "${CRON_SECRET_FILE:?CRON_SECRET_FILE is required}"

case "$1" in
  annual-leave-quota-provisioning)
    method=GET
    ;;
  license-reconciliation)
    method=POST
    ;;
  *)
    printf '%s\n' 'Unsupported internal job.' >&2
    exit 64
    ;;
esac

secret=$(cat "$CRON_SECRET_FILE")
if [ -z "$secret" ]; then
  printf '%s\n' 'The cron secret file is empty.' >&2
  exit 78
fi

curl --fail --silent --show-error --retry 2 --retry-delay 5 --max-time 90 \
  --request "$method" \
  --header "Authorization: Bearer $secret" \
  "${SMS_API_ORIGIN%/}/api/v1/internal/$1" >/dev/null
