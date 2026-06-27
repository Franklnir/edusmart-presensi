#!/bin/sh

set -eu

default_processes="${QUEUE_WORKER_PROCESSES:-2}"
quiz_processes="${QUIZ_SCORING_WORKER_PROCESSES:-4}"
quiz_queue="${QUIZ_SCORING_QUEUE:-quiz-scoring}"
backup_queue="${BACKUP_QUEUE:-backup}"
worker_timeout="${QUEUE_WORKER_TIMEOUT_SECONDS:-${BACKUP_JOB_TIMEOUT_SECONDS:-900}}"

case "$default_processes" in
  ''|*[!0-9]*) default_processes=2 ;;
esac

case "$quiz_processes" in
  ''|*[!0-9]*) quiz_processes=4 ;;
esac

case "$worker_timeout" in
  ''|*[!0-9]*) worker_timeout=900 ;;
esac

if [ "$default_processes" -gt 32 ]; then
  default_processes=32
fi

if [ "$quiz_processes" -gt 32 ]; then
  quiz_processes=32
fi

pids=""

if php artisan list --raw 2>/dev/null | grep -qx 'horizon'; then
  exec php artisan horizon
fi

start_worker() {
  queue="$1"
  php artisan queue:work redis \
    --queue="$queue" \
    --sleep=1 \
    --tries=3 \
    --timeout="$worker_timeout" \
    --max-time=3600 &
  pids="$pids $!"
}

i=0
while [ "$i" -lt "$default_processes" ]; do
  if [ "$quiz_processes" -gt 0 ]; then
    start_worker "default,$backup_queue"
  else
    start_worker "$quiz_queue,default,$backup_queue"
  fi
  i=$((i + 1))
done

i=0
while [ "$i" -lt "$quiz_processes" ]; do
  start_worker "$quiz_queue"
  i=$((i + 1))
done

if [ -z "$pids" ]; then
  echo "At least one queue worker process is required." >&2
  exit 1
fi

terminate_workers() {
  for pid in $pids; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  wait || true
}

trap terminate_workers INT TERM

wait
