import type { Position } from "./common";

export type SchoolTier = "elite" | "strong" | "normal" | "small";

export type SchoolRegion =
  | "서울권"
  | "경기·인천권"
  | "강원권"
  | "충청권"
  | "대전·세종권"
  | "전북권"
  | "광주·전남권"
  | "대구·경북권"
  | "부산·울산·경남권"
  | "제주권";

export type SchoolDevelopmentBias =
  | "pitching"
  | "catcher"
  | "infield-defense"
  | "power"
  | "speed-outfield"
  | "two-way"
  | "polished"
  | "raw";

export type SchoolTrait = SchoolDevelopmentBias | "high-data" | "low-report";

export type SchoolProfile = {
  id: string;
  name: string;
  region: SchoolRegion;
  tier: SchoolTier;
  leagueStrength: number;
  annualProspectVolume: number;
  developmentBias: SchoolDevelopmentBias;
  reportReliabilityBase: number;
  traits: SchoolTrait[];
  positionBias: Partial<Record<Position, number>>;
};
