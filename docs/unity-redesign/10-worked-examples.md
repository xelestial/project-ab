# 10 — 워크스루 예제

이 문서는 이전에 구버전 유닛/무기 데이터 값을 직접 포함했다.

현재 정책:
- 유닛/무기/스킬/패시브 값은 문서에 중복 기재하지 않는다.
- 단일 소스는 `packages/metadata/data/*.json`이다.
- 사람이 읽는 요약은 `UNIT.MD`를 본다.
- 새 워크스루 예제는 반드시 `DataRegistry` 또는 `/api/v1/meta/*`에서 값을 조회해 생성한다.

단일 소스:

| 데이터 | 파일 |
|---|---|
| 유닛 | `packages/metadata/data/units.json` |
| 무기 | `packages/metadata/data/weapons.json` |
| 스킬 | `packages/metadata/data/skills.json` |
| 패시브 | `packages/metadata/data/unit-passives.json` |
| 효과 | `packages/metadata/data/effects.json` |
| 타일 | `packages/metadata/data/tiles.json` |

TODO:
- 현재 메타데이터 기준으로 예제를 재생성한다.
- 예제 생성 스크립트는 JSON을 직접 읽지 말고 `DataRegistry`와 같은 런타임 조회 경로를 사용한다.
