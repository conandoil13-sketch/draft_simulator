import { createInitialStandings, createVariedInitialTeams, DEFAULT_GAME_SETTINGS } from "../constants/league";
import { createDraftOrder } from "../draft/draftOrder";
import { createSeededRng } from "../generation/random";
import { generateHighSchoolPlayerPoolWithSchools } from "../generation/prospects";
import type { TeamId } from "../types/common";
import type { GameState } from "../types/game";

export type NewGameOptions = {
  userTeamId?: TeamId;
  userInitialRank?: number;
};

export function createNewGame(seed = String(Date.now()), options: NewGameOptions = {}): GameState {
  const currentYear = 2026;
  const rng = createSeededRng(seed);
  const teams = createVariedInitialTeams(rng);
  const initialStandings = createInitialStandings(teams, rng, options.userTeamId, options.userInitialRank).map((standing) => ({
    ...standing,
    year: currentYear - 1,
    wins: 0,
    losses: 0,
    strengthSnapshot: teams.find((team) => team.id === standing.teamId)?.currentStrength ?? 50,
  }));
  const { prospects, schools, classQuality } = generateHighSchoolPlayerPoolWithSchools(rng, currentYear, DEFAULT_GAME_SETTINGS.prospectsPerYear);
  const draftEligibleProspects = prospects.filter((prospect) => prospect.draftEligibleYear === currentYear);
  const picks = createDraftOrder(currentYear, teams, initialStandings, DEFAULT_GAME_SETTINGS.rounds);

  return {
    schemaVersion: 1,
    seed,
    turn: 0,
    phase: "team-selection",
    currentYear,
    userTeamId: options.userTeamId,
    teams,
    schoolsById: Object.fromEntries(schools.map((school) => [school.id, school])),
    prospectsById: Object.fromEntries(prospects.map((prospect) => [prospect.id, prospect])),
    draftClassProfilesByYear: {
      [currentYear]: classQuality,
    },
    draftClassesByYear: {
      [currentYear]: draftEligibleProspects.map((prospect) => prospect.id),
    },
    draftPicksByYear: {
      [currentYear]: picks,
    },
    draftedPlayersById: {},
    draftHistoryByYear: {},
    seasonHistoryByYear: {
      [currentYear - 1]: initialStandings,
    },
    newsFeed: [],
    settings: DEFAULT_GAME_SETTINGS,
  };
}
