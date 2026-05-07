#!/usr/bin/env bash
# start.sh — Redis + 서버 + 클라이언트 동시 실행
# 사용법: ./start.sh [--build] [--no-redis]
#   --build     실행 전 서버 재빌드
#   --no-redis  Redis 없이 MemorySessionStore 모드로 실행

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── 옵션 파싱 ─────────────────────────────────────────────────────────────────
BUILD=false
NO_REDIS=false
for arg in "$@"; do
  case "$arg" in
    --build)    BUILD=true ;;
    --no-redis) NO_REDIS=true ;;
    --help|-h)
      echo "Usage: ./start.sh [--build] [--no-redis]"
      echo "  --build     서버 TypeScript 재빌드 후 실행"
      echo "  --no-redis  Redis 없이 MemorySessionStore 모드로 실행"
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

# ── 프로세스 정리 ─────────────────────────────────────────────────────────────
REDIS_STARTED=false
cleanup() {
  echo ""
  echo "🛑  종료 중..."
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  wait "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || true
  if [ "$REDIS_STARTED" = true ]; then
    echo "🗄️  Redis 컨테이너 정지..."
    docker compose stop redis 2>/dev/null || true
  fi
  echo "👋  종료 완료"
}
trap cleanup EXIT INT TERM

# ── Redis 시작 ─────────────────────────────────────────────────────────────────
if [ "$NO_REDIS" = false ]; then
  if command -v docker &> /dev/null; then
    echo "🗄️  Redis 시작 중..."
    docker compose up -d redis 2>/dev/null && REDIS_STARTED=true
    # Redis가 준비될 때까지 대기 (최대 10초)
    for i in $(seq 1 20); do
      if docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
        echo "✅  Redis 준비 완료 (localhost:6379)"
        break
      fi
      sleep 0.5
    done
  else
    echo "⚠️  docker 미설치 — Redis 없이 MemorySessionStore 모드로 실행"
  fi
fi

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
echo "  Redis:    localhost:6379"
echo "  서버:     http://localhost:3000"
echo "  클라이언트: http://localhost:5173"
echo "  종료:     Ctrl+C"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 두 프로세스 중 하나가 죽으면 종료
wait -n "$SERVER_PID" "$CLIENT_PID" 2>/dev/null || wait "$SERVER_PID" "$CLIENT_PID"
