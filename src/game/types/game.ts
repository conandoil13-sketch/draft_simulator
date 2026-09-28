import type { DraftPick } from "./draft";
import type { NewsItem } from "./news";
import type { DraftClassQualityProfile, DraftedPlayer, Prospect } from "./player";
import type { SchoolProfile } from "./school";
import type { Team } from "./team";
import type { ForeignPlayerId, GamePhase, PlayerId, ProspectId, TeamId, Year } from "./common";
import type { ForeignPlayerCandidate } from "./foreignPlayer";
import type { ForeignContract, ForeignContractOffer, ForeignRecruitmentDecision, ForeignRecruitmentState, ForeignRosterDecision } from "./foreignContract";

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
  foreignPlayerMarketYear?: Year;
  foreignPlayersById?: Record<string, ForeignPlayerCandidate>;
  foreignContractsById?: Record<string, ForeignContract>;
  foreignContractOffersById?: Record<string, ForeignContractOffer>;
  foreignRecruitmentByYear?: Record<Year, ForeignRecruitmentState>;
  foreignRecruitmentDecisionsByYear?: Record<Year, ForeignRecruitmentDecision[]>;
  foreignRosterDecisionsByYear?: Record<Year, ForeignRosterDecision[]>;
  foreignShortlistIds?: ForeignPlayerId[];
  draftClassProfilesByYear?: Record<Year, DraftClassQualityProfile>;
  draftClassesByYear: Record<Year, ProspectId[]>;
  draftPicksByYear: Record<Year, DraftPick[]>;
  draftedPlayersById: Record<string, DraftedPlayer>;
  draftHistoryByYear: Record<Year, string[]>;
  seasonHistoryByYear: Record<Year, SeasonStanding[]>;
  newsFeed: NewsItem[];
  settings: GameSettings;
};
