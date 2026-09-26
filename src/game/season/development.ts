import type { DraftedPlayer } from "../types/player";
import { clamp } from "../utils/math";
import { randomFloat, type Rng } from "../generation/random";

export function developPlayer(rng: Rng, player: DraftedPlayer): DraftedPlayer {
  const talent = player.trueTalent;
  const growth = talent.growthRate * randomFloat(rng, 0, 4) + talent.workEthic * randomFloat(rng, 0, 2);
  const volatilitySwing = randomFloat(rng, -talent.volatility * 4, talent.volatility * 4);
  const adaptationDrag = talent.proAdaptation < 0.35 ? randomFloat(rng, 0, 2.5) : 0;
  const currentOverall = clamp(player.revealed.currentOverall + growth + volatilitySwing - adaptationDrag, 20, talent.potential);

  return {
    ...player,
    revealed: {
      ...player.revealed,
      currentOverall: Math.round(currentOverall),
    },
    career: {
      ...player.career,
      yearsPro: player.career.yearsPro + 1,
    },
  };
}
