# AB — Unity WebSocket 프로토콜 가이드

> 이 문서는 Unity C# 클라이언트에서 AB 서버 WebSocket에 연결하는 방법을 설명합니다.

---

## 연결 엔드포인트

```
ws://<host>:<port>/ws/game/<gameId>
```

예) `ws://localhost:3000/ws/game/game_1234_abc`

---

## 메시지 형식

모든 메시지는 **JSON 문자열**입니다. 필드 `type`으로 메시지 종류를 구분합니다.

```csharp
// Unity 예시
webSocket.SendText(JsonUtility.ToJson(new JoinMessage { type = "join", gameId = ..., playerId = ..., token = ... }));
```

---

## 클라이언트 → 서버 (송신)

### join
게임에 참가합니다. 플레이어로 연결.

```json
{
  "type": "join",
  "gameId": "game_abc123",
  "playerId": "player-1",
  "token": "<JWT accessToken>"
}
```

### spectate
관전 모드로 연결합니다 (읽기 전용).

```json
{
  "type": "spectate",
  "gameId": "game_abc123"
}
```

### action
게임 액션을 서버에 전송합니다. 자신의 턴에만 유효합니다.

```json
{
  "type": "action",
  "gameId": "game_abc123",
  "action": {
    "type": "move",
    "playerId": "player-1",
    "unitId": "u1",
    "destination": { "row": 3, "col": 4 }
  }
}
```

액션 타입:

| type | 필수 필드 | 설명 |
|---|---|---|
| `move` | `unitId`, `destination` | 유닛 이동 |
| `attack` | `unitId`, `target` | 유닛 공격 (`target`: `{row, col}`) |
| `pass` | `unitId` | 턴 넘기기 |
| `extinguish` | `unitId` | 화재 소화 |
| `skill` | `unitId`, `skillId`, `target?` | 스킬 사용 |
| `draft_place` | `unitId`, `metaId`, `position` | 드래프트 배치 |

### surrender
항복 선언합니다.

```json
{
  "type": "surrender",
  "gameId": "game_abc123",
  "playerId": "player-1"
}
```

### ping
연결 유지 (하트비트).

```json
{ "type": "ping" }
```

---

## 서버 → 클라이언트 (수신)

### joined
`join` 성공 응답.

```json
{
  "type": "joined",
  "gameId": "game_abc123",
  "playerId": "player-1"
}
```

### spectator_joined
`spectate` 성공 응답.

```json
{
  "type": "spectator_joined",
  "gameId": "game_abc123",
  "spectatorCount": 2
}
```

### state_update
게임 상태 전체 스냅샷. 매 액션마다 전송됩니다.

```json
{
  "type": "state_update",
  "gameId": "game_abc123",
  "state": { /* GameState 전체 */ }
}
```

`GameState` 구조:
```typescript
{
  gameId: string
  phase: "draft" | "battle" | "result"
  round: number
  currentTurnIndex: number
  turnOrder: { playerId: string, priority: number }[]
  players: { [playerId]: PlayerState }
  units: { [unitId]: UnitState }
  map: { mapId: string, tiles: Record<string, TileType> }
  endResult?: { result: "win"|"draw", winnerIds: string[] }
}
```

### game_end
게임 종료 알림.

```json
{
  "type": "game_end",
  "gameId": "game_abc123",
  "winnerIds": ["player-1"],
  "reason": "all_units_dead"
}
```

종료 이유 (`reason`):

| reason | 설명 |
|---|---|
| `all_units_dead` | 상대방 유닛 전멸 |
| `surrender` | 항복 |
| `round_limit` | 라운드 제한 초과 |
| `draw` | 무승부 |

### pong
`ping`에 대한 응답.

```json
{ "type": "pong" }
```

### error
에러 발생.

```json
{
  "type": "error",
  "code": "error.internal",
  "message": "Game not found"
}
```

---

## Unity C# 연결 예시

```csharp
using System;
using System.Threading.Tasks;
using NativeWebSocket; // 예: endel/NativeWebSocket

public class AbGameClient : MonoBehaviour
{
    WebSocket _ws;
    string _gameId;
    string _playerId;
    string _accessToken;

    async void Start()
    {
        _ws = new WebSocket($"ws://localhost:3000/ws/game/{_gameId}");

        _ws.OnOpen += () =>
        {
            // 접속 후 즉시 join 전송
            SendJson(new { type = "join", gameId = _gameId, playerId = _playerId, token = _accessToken });
        };

        _ws.OnMessage += (bytes) =>
        {
            var json = System.Text.Encoding.UTF8.GetString(bytes);
            HandleMessage(json);
        };

        _ws.OnError += (e) => Debug.LogError($"WS Error: {e}");

        await _ws.Connect();
    }

    void HandleMessage(string json)
    {
        var msg = JsonUtility.FromJson<BaseMessage>(json);
        switch (msg.type)
        {
            case "joined":
                Debug.Log("Joined game successfully");
                break;
            case "state_update":
                var su = JsonUtility.FromJson<StateUpdateMessage>(json);
                UpdateGameState(su.state);
                break;
            case "game_end":
                var ge = JsonUtility.FromJson<GameEndMessage>(json);
                ShowResult(ge.winnerIds, ge.reason);
                break;
        }
    }

    public void SendAction(string unitId, string actionType, Position? target = null)
    {
        SendJson(new
        {
            type = "action",
            gameId = _gameId,
            action = new { type = actionType, playerId = _playerId, unitId, target }
        });
    }

    void SendJson(object obj)
    {
        if (_ws.State == WebSocketState.Open)
            _ws.SendText(JsonUtility.ToJson(obj));
    }

    void Update()
    {
#if !UNITY_WEBGL || UNITY_EDITOR
        _ws.DispatchMessageQueue();
#endif
    }

    async void OnApplicationQuit()
    {
        await _ws.Close();
    }
}
```

---

## HTTP REST API (로비/인증)

### 로그인 (토큰 발급)
```
POST /api/v1/auth/login
{ "playerId": "player-1" }
→ { "accessToken": "...", "refreshToken": "...", "expiresIn": 900, "tokenType": "Bearer" }
```

### 방 생성
```
POST /api/v1/rooms
Authorization: Bearer <accessToken>
{ "mapId": "map_2p", "playerCount": 2 }
→ { "gameId": "game_abc123", "createdBy": "player-1" }
```

### AI 플레이어 추가
```
POST /api/v1/rooms/<gameId>/ai
Authorization: Bearer <accessToken>
{ "iterations": 200, "timeoutMs": 1000 }
→ { "aiPlayerId": "ai_1234567890", "gameId": "game_abc123" }
```

### 리더보드
```
GET /api/v1/leaderboard?limit=10
→ { "leaderboard": [{ "rank": 1, "playerId": "...", "wins": 5, "winRate": 83.3 }] }
```

---

## 재연결 처리

플레이어가 연결이 끊어진 후 재접속할 경우, 동일한 `playerId`로 `join` 메시지를 다시 보내면 됩니다. 서버는 자동으로 기존 어댑터에 새 소켓을 연결하고 현재 게임 상태를 즉시 전송합니다.

```csharp
// 재연결 시 동일 gameId + playerId로 join 재전송
_ws.OnOpen += () => SendJson(new { type = "join", gameId = _gameId, playerId = _playerId, token = _accessToken });
```
