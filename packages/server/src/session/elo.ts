/**
 * ELO rating calculation utilities.
 *
 * Standard ELO formula:
 *   E_A = 1 / (1 + 10^((R_B - R_A) / 400))
 *   R_A' = R_A + K * (S_A - E_A)
 *
 * K-factor:
 *   - New players (< 30 games): K = 40
 *   - Standard: K = 20
 *   - High rating (> 2400): K = 10
 *
 * Initial rating: 1000
 * Floor: 100 (rating cannot drop below this)
 */

export const ELO_INITIAL = 1_000;
export const ELO_FLOOR = 100;

function kFactor(rating: number, gamesPlayed: number): number {
  if (gamesPlayed < 30) return 40;
  if (rating >= 2_400) return 10;
  return 20;
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export interface EloResult {
  playerId: string;
  oldRating: number;
  newRating: number;
  delta: number;
}

/**
 * Calculate new ELO ratings after a game with exactly 2 players.
 * For multiplayer (3-4 players), uses all pairwise comparisons averaged.
 */
export function calculateElo(
  players: { playerId: string; rating: number; gamesPlayed: number }[],
  winnerIds: string[],
): EloResult[] {
  if (players.length === 0) return [];

  const isDraw = winnerIds.length === 0;

  // For each player, sum up expected vs actual score across all opponents
  const ratingDeltas = new Map<string, number>();

  for (const a of players) {
    let totalDelta = 0;

    for (const b of players) {
      if (a.playerId === b.playerId) continue;

      const expected = expectedScore(a.rating, b.rating);
      const actual =
        isDraw ? 0.5
        : winnerIds.includes(a.playerId) ? 1.0
        : 0.0;

      const k = kFactor(a.rating, a.gamesPlayed);
      totalDelta += k * (actual - expected);
    }

    // Average across opponents
    ratingDeltas.set(a.playerId, totalDelta / (players.length - 1));
  }

  return players.map((p) => {
    const delta = Math.round(ratingDeltas.get(p.playerId) ?? 0);
    const newRating = Math.max(ELO_FLOOR, p.rating + delta);
    return {
      playerId: p.playerId,
      oldRating: p.rating,
      newRating,
      delta: newRating - p.rating,
    };
  });
}
