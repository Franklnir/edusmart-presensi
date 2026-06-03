#!/bin/sh

set -eu

default_processes="${QUEUE_WORKER_PROCESSES:-1}"
quiz_processes="${QUIZ_SCORING_WORKER_PROCESSES:-0}"
quiz_queue="${QUIZ_SCORING_QUEUE:-quiz-scoring}"

case "$default_processes" in
  ''|*[!0-9]*) default_processes=1 ;;
esac

case "$quiz_processes" in
  ''|*[!0-9]*) quiz_processes=0 ;;
esac

if [ "$default_processes" -gt 32 ]; then
  default_processes=32
fi

if [ "$quiz_processes" -gt 32 ]; then
  quiz_processes=32
fi

pids=""

start_worker() {
  queue="$1"
  php artisan queue:work redis \
    --queue="$queue" \
    --sleep=1 \
    --tries=3 \
    --timeout=120 \
    --max-time=3600 &
  pids="$pids $!"
}

i=0
while [ "$i" -lt "$default_processes" ]; do
  if [ "$quiz_processes" -gt 0 ]; then
    start_worker default
  else
    start_worker "$quiz_queue,default"
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
