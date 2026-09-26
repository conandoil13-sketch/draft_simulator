import type { NewsId, PlayerId, TeamId, Year } from "./common";

export type NewsType =
  | "draft"
  | "debut"
  | "injury"
  | "release"
  | "award"
  | "rookie-of-year"
  | "golden-glove"
  | "trade"
  | "standings";

export type NewsItem = {
  id: NewsId;
  year: Year;
  week: number;
  type: NewsType;
  teamId?: TeamId;
  playerId?: PlayerId;
  headline: string;
  body: string;
  importance: 1 | 2 | 3 | 4 | 5;
};
