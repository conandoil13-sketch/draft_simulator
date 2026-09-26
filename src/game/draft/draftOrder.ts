import type { DraftPick } from "../types/draft";
import type { SeasonStanding } from "../types/game";
import type { Team } from "../types/team";
import type { DraftPickId } from "../types/common";

export function createDraftOrder(year: number, teams: Team[], previousStandings: SeasonStanding[] | undefined, rounds: number): DraftPick[] {
  const teamOrder = previousStandings?.length
    ? [...previousStandings].sort((a, b) => b.rank - a.rank).map((standing) => standing.teamId)
    : teams.map((team) => team.id);

  const picks: DraftPick[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    for (let slot = 0; slot < teamOrder.length; slot += 1) {
      const overall = (round - 1) * teamOrder.length + slot + 1;
      const originalTeamId = teamOrder[slot];
      picks.push({
        id: `pick-${year}-${overall}` as DraftPickId,
        year,
        round,
        overall,
        originalTeamId,
        ownerTeamId: originalTeamId,
      });
    }
  }

  return picks;
}
