import type { DraftPick } from "./draft";
import type { NewsItem } from "./news";
import type { DraftClassQualityProfile, DraftedPlayer, Prospect } from "./player";
import type { SchoolProfile } from "./school";
import type { Team } from "./team";
import type { GamePhase, PlayerId, ProspectId, TeamId, Year } from "./common";

export type SeasonStanding = {
  year: Year;
  teamId: TeamId;
  wins: number;
  losses: number;
  rank: number;
  strengthSnapshot: number;
};

export type GameSettings = {
  prospectsPerYear: number;
  teams: number;
  rounds: number;
  enablePickTrades: boolean;
};

export type GameState = {
  schemaVersion: 1;
  seed: string;
  turn: number;
  phase: GamePhase;
  currentYear: Year;
  userTeamId?: TeamId;
  teams: Team[];
  schoolsById: Record<string, SchoolProfile>;
  prospectsById: Record<string, Prospect>;
  draftClassProfilesByYear?: Record<Year, DraftClassQualityProfile>;
  draftClassesByYear: Record<Year, ProspectId[]>;
  draftPicksByYear: Record<Year, DraftPick[]>;
  draftedPlayersById: Record<string, DraftedPlayer>;
  draftHistoryByYear: Record<Year, string[]>;
  seasonHistoryByYear: Record<Year, SeasonStanding[]>;
  newsFeed: NewsItem[];
  settings: GameSettings;
};
