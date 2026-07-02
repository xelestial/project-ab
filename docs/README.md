# Project AB — 문서 인덱스

## Unity 재설계 (2026-06-11) ★ 최신

> Unity 클라이언트/엔진 완전 재설계 문서 세트. 사람 개발자가 이 문서만으로 구현 가능하도록
> 모든 인터페이스·처리 순서·수치를 정의. 모듈 관계는 Mermaid 그래프로 문서화.

- **[unity-redesign/README.md](unity-redesign/README.md)** — 진입점: 설계 목표, 문서 지도, 전체 아키텍처
  - [01-architecture.md](unity-redesign/01-architecture.md) — 어셈블리, DI, 스레딩, 결정론
  - [02-domain-model.md](unity-redesign/02-domain-model.md) — 도메인 타입, GameState, GameChange 18종
  - [03-metadata.md](unity-redesign/03-metadata.md) — ScriptableObject 메타데이터
  - [04-core-engine.md](unity-redesign/04-core-engine.md) — Validator/Resolver/Manager + 파이프라인
  - [05-game-flow.md](unity-redesign/05-game-flow.md) — GameLoop, IPlayerAgent, 타임아웃
  - [06-events.md](unity-redesign/06-events.md) — SignalBus, 발행–구독 매트릭스
  - [07-presentation.md](unity-redesign/07-presentation.md) — View, 연출 큐, 입력/UI
  - [08-rules-reference.md](unity-redesign/08-rules-reference.md) — 게임 룰 완전 명세
  - [09-testing-and-roadmap.md](unity-redesign/09-testing-and-roadmap.md) — 테스트, 마일스톤
  - [10-worked-examples.md](unity-redesign/10-worked-examples.md) — 워크스루 예제 재생성 가이드
  - [11-action-flows.md](unity-redesign/11-action-flows.md) — 액션 처리 흐름 가이드 (초보 개발자용)
  - [12-ai-design.md](unity-redesign/12-ai-design.md) — AI 플레이어 설계 (Utility AI)
  - [13-camera-design.md](unity-redesign/13-camera-design.md) — XCOM 스타일 카메라 + UI/UX (3D 전환)

## 게임 룰 / 설계 (기존 TS 구현 기준)

- [../GAME_RULES.md](../GAME_RULES.md) — 게임 규칙 명세서 (원본)
- [architecture.md](architecture.md) — TS 모노레포 아키텍처 (2026-04-13)
- [DESIGN.md](DESIGN.md) / [design-principal.md](design-principal.md) — 디자인 문서
- [implementation-review.md](implementation-review.md) — 룰 구현 검토

## API / 프로토콜

- [api-spec.md](api-spec.md) — HTTP API 명세
- [unity-ws-protocol.md](unity-ws-protocol.md) — Unity WebSocket 프로토콜

## 개발

- [automated-testing-guide.md](automated-testing-guide.md) — 자동화 테스트 가이드
- [progress.md](progress.md) — 진행 현황
- [../TEST_PLAN.md](../TEST_PLAN.md) — 테스트 계획
