import type { SeasonStanding } from "../types/game";
import type { Team } from "../types/team";
import { randomInt, type Rng } from "../generation/random";

export function simulateStandings(rng: Rng, year: number, teams: Team[]): SeasonStanding[] {
  return teams
    .map((team) => {
      const wins = Math.max(30, Math.min(95, Math.round(team.currentStrength + randomInt(rng, -12, 12))));
      return {
        year,
        teamId: team.id,
        wins,
        losses: 144 - wins,
        rank: 0,
        strengthSnapshot: team.currentStrength,
      };
    })
    .sort((a, b) => b.wins - a.wins)
    .map((standing, index) => ({ ...standing, rank: index + 1 }));
}
