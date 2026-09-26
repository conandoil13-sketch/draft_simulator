import type { DraftPick } from "../types/draft";
import type { Team } from "../types/team";
import { pickOne, type Rng } from "../generation/random";

export function maybeApplyPickTrades(rng: Rng, picks: DraftPick[], teams: Team[], probability = 0.08): DraftPick[] {
  if (rng.next() > probability || picks.length === 0) {
    return picks;
  }

  const fromTeam = pickOne(rng, teams);
  const toTeam = pickOne(rng, teams.filter((team) => team.id !== fromTeam.id));
  const movablePick = picks.find((pick) => pick.ownerTeamId === fromTeam.id && pick.round > 1);

  if (!movablePick) {
    return picks;
  }

  return picks.map((pick) => (pick.id === movablePick.id ? { ...pick, ownerTeamId: toTeam.id } : pick));
}
