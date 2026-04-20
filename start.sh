#!/usr/bin/env bash
# start.sh — 서버 + 클라이언트 동시 실행
# 사용법: ./start.sh [--build]
#   --build  실행 전 서버 재빌드

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── 옵션 파싱 ─────────────────────────────────────────────────────────────────
BUILD=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    --help|-h)
      echo "Usage: ./start.sh [--build]"
      echo "  --build   서버 TypeScript 재빌드 후 실행"
      exit 0
      ;;
  esac
done

# ── 빌드 ─────────────────────────────────────────────────────────────────────
if [ "$BUILD" = true ]; then
  echo "🔨  서버 빌드 중..."
  pnpm -F @ab/server build
  echo "✅  빌드 완료"
fi

# ── 프로세스 정리 (기존 실행 중인 서버/클라이언트 종료) ──────────────────────
cleanup() {
  echo ""
  echo "🛑  종료 중..."
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  wait "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  echo "👋  종료 완료"
}
trap cleanup EXIT INT TERM

# ── 서버 실행 ─────────────────────────────────────────────────────────────────
echo "🚀  서버 시작 (포트 3000)..."
pnpm -F @ab/server start &
SERVER_PID=$!

# 서버가 올라올 때까지 대기 (최대 10초)
for i in $(seq 1 20); do
  if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅  서버 준비 완료"
    break
  fi
  sleep 0.5
done

# ── 클라이언트 실행 ───────────────────────────────────────────────────────────
echo "🌐  클라이언트 시작 (포트 5173)..."
pnpm -F @ab/client dev &
CLIENT_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  서버:     http://localhost:3000"
echo "  클라이언트: http://localhost:5173"
echo "  종료:     Ctrl+C"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 두 프로세스 중 하나가 죽으면 종료
wait -n "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || wait "$SERVER_PID" "$CLIENT_PID"
