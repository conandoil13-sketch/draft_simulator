import type { Grade20to80, Position, ProspectId } from "../types/common";
import type { DraftClassQualityProfile, HiddenTalentProfile, HighSchoolCareerLogEntry, HighSchoolYearSnapshot, HitterDevelopmentTools, HitterStats, LeagueLevel, MetricQuality, MonthlyFormPoint, PhysicalProfile, PitchArsenalEntry, PitcherDevelopmentTools, PitcherStats, PitchingArmSlot, PitchType, PlayerGroup, Prospect, ProspectAccolade, ProspectDataTier, ProspectRiskTag, SchoolYear, ScoutGrade, SeasonFormCycle, VisibleScoutingReport } from "../types/player";
import type { SchoolProfile } from "../types/school";
import { clamp, roundGrade, roundTo } from "../utils/math";
import { generateKoreanName } from "./names";
import { createVisibleScoutingReport, dataTierFromPublicRank } from "./scouting";
import { pickOne, randomFloat, randomInt, weightedPick, type Rng } from "./random";
import { createSchoolAssignments, generateSchoolPool } from "./schools";

const POSITION_GROUPS: Record<Position, PlayerGroup> = {
  SP: "pitcher",
  RP: "pitcher",
  C: "catcher",
  "1B": "infielder",
  "2B": "infielder",
  "3B": "infielder",
  SS: "infielder",
  LF: "outfielder",
  CF: "outfielder",
  RF: "outfielder",
};

const POSITIONAL_VALUE: Record<Position, number> = {
  SP: 9,
  RP: 4,
  C: 8,
  SS: 8,
  CF: 7,
  "2B": 6,
  "3B": 6,
  RF: 5,
  LF: 4,
  "1B": 3,
};

const POSITION_NAMES: Record<Position, string> = {
  SP: "선발",
  RP: "불펜",
  C: "포수",
  "1B": "1루수",
  "2B": "2루수",
  "3B": "3루수",
  SS: "유격수",
  LF: "좌익수",
  CF: "중견수",
  RF: "우익수",
};

type HighSchoolIssueEvent =
  | { type: "none" }
  | { type: "injury" }
  | { type: "long-rehab" }
  | { type: "repeat-year" }
  | { type: "transfer" }
  | { type: "college-risk" }
  | { type: "position-change" };

const NO_HIGH_SCHOOL_EVENT: HighSchoolIssueEvent = { type: "none" };

type HighSchoolGrowthEpisode =
  | { type: "height-spurt"; heightGain: number }
  | { type: "bulk-up"; weightGain: number }
  | { type: "defensive-position-change"; from: Position; to: Position }
  | { type: "pitching-role-change"; from: Position; to: Position }
  | { type: "pitcher-to-hitter"; from: Position; to: Position }
  | { type: "hitter-to-pitcher"; from: Position; to: Position };

type HighSchoolPositionPlan = {
  primaryPosition: Position;
  playerGroup: PlayerGroup;
};

const ACCOLADES: ProspectAccolade[] = [
  { id: "golden-lion-mvp", label: "황금사자기 MVP", category: "tournament", meaning: "전국대회 최고 활약으로 언론 순위와 구단 관심이 크게 오른다. 표본 기간과 상대 수준은 함께 확인해야 한다.", reputationBoost: 18, hypeBoost: 24 },
  { id: "blue-dragon-pitcher", label: "청룡기 우수투수상", category: "pitching", meaning: "큰 경기 투구 내용과 경기 운영 평가에 가점이 붙는다.", reputationBoost: 12, hypeBoost: 12 },
  { id: "phoenix-hr-king", label: "봉황대기 홈런왕", category: "hitting", meaning: "장타 생산력을 강하게 보여주지만 상위 레벨 변화구 대응은 별도 확인이 필요하다.", reputationBoost: 12, hypeBoost: 16 },
  { id: "emart-batting", label: "이마트배 타격상", category: "hitting", meaning: "타율과 출루 과정의 신뢰도를 올려주는 신호다.", reputationBoost: 11, hypeBoost: 10 },
  { id: "u18-national", label: "U-18 국가대표", category: "reputation", meaning: "또래 상위권 검증 이력으로 프로 적응 기대치와 구단 관심이 오른다.", reputationBoost: 16, hypeBoost: 15 },
  { id: "college-hs-allstar", label: "대학·고교 올스타전 출전", category: "reputation", meaning: "스카우트 노출이 많아진 선수로 관심 구단이 늘기 쉽다.", reputationBoost: 9, hypeBoost: 9 },
  { id: "lee-youngmin", label: "이영민 타격상", category: "hitting", meaning: "컨택 능력과 타격 정확도에 강한 공개 신호를 준다.", reputationBoost: 15, hypeBoost: 13 },
  { id: "choi-dongwon", label: "고교 최동원상", category: "pitching", meaning: "투수 완성도와 에이스 실적을 올려보지만 혹사와 부상 리스크도 같이 살펴야 한다.", reputationBoost: 16, hypeBoost: 16 },
  { id: "final-starter", label: "전국대회 결승 선발", category: "tournament", meaning: "큰 경기 경험이 평가에 반영되지만 표본이 짧으면 과대평가 위험이 있다.", reputationBoost: 10, hypeBoost: 12 },
  { id: "club-150", label: "150km/h 클럽", category: "physical", meaning: "구속과 잠재력으로 관심이 몰린다. 제구가 낮으면 실패 위험도 커진다.", reputationBoost: 9, hypeBoost: 18 },
  { id: "national-catcher", label: "이만수 포수상", category: "defense", meaning: "고교 포수 중 수비, 송구, 경기 운영 평가가 가장 두드러진 선수에게 붙는 포수 프리미엄 신호다.", reputationBoost: 14, hypeBoost: 14 },
  { id: "ss-defense", label: "유격수 수비상", category: "defense", meaning: "수비 위치 유지 가능성이 올라가며 안전한 야수 프로필로 보인다.", reputationBoost: 10, hypeBoost: 8 },
  { id: "career-20hr", label: "고교 통산 20홈런", category: "hitting", meaning: "누적 장타 실적은 분명하지만 파워 원툴 과대평가 가능성도 있다.", reputationBoost: 13, hypeBoost: 17 },
  { id: "baseball-variety", label: "야구 예능 출연", category: "reputation", meaning: "학교 단위 방송 노출로 인지도가 오른다. 경기력 신호라기보다 팬 여론과 이름값에 가까운 정보다.", reputationBoost: 6, hypeBoost: 8 },
  { id: "baseball-variety-breakout", label: "야구 예능 활약", category: "reputation", meaning: "방송 노출에서 개인 존재감이 커 팬 모의지명과 이름값에 소폭 가산된다. 실제 재능을 보장하지는 않는다.", reputationBoost: 11, hypeBoost: 15 },
  { id: "mlb-direct-interest", label: "MLB 구단 관심", category: "reputation", meaning: "해외 스카우트 관찰망에 오른 선수다. 국내 드래프트 가치와 별개로 계약 변수와 이탈 가능성을 같이 봐야 한다.", reputationBoost: 10, hypeBoost: 18 },
  { id: "mlb-direct-signing", label: "MLB 직행 계약", category: "reputation", meaning: "드래프트 전 해외 구단과 계약해 국내 지명 대상에서 빠진다. 국내 구단 입장에서는 최종 회의 직전 사라지는 대형 변수다.", reputationBoost: 16, hypeBoost: 24 },
];

export function generateDraftClass(rng: Rng, year: number, count = 400): Prospect[] {
  const schools = generateSchoolPool(rng);
  return createDraftClassFromSchools(rng, year, count, schools).prospects;
}

export function generateDraftClassWithSchools(rng: Rng, year: number, count = 400): { prospects: Prospect[]; schools: SchoolProfile[]; classQuality: DraftClassQualityProfile } {
  const schools = generateSchoolPool(rng);
  return createDraftClassFromSchools(rng, year, count, schools);
}

export function generateHighSchoolPlayerPoolWithSchools(rng: Rng, year: number, count = 400): { prospects: Prospect[]; schools: SchoolProfile[]; classQuality: DraftClassQualityProfile } {
  const schools = generateSchoolPool(rng);
  const draftClass = createDraftClassFromSchools(rng, year, count, schools, 3);
  const secondYearClass = createDraftClassFromSchools(rng, year + 1, count, schools, 2);
  const firstYearClass = createDraftClassFromSchools(rng, year + 2, count, schools, 1);
  return {
    schools,
    classQuality: draftClass.classQuality,
    prospects: [...draftClass.prospects, ...secondYearClass.prospects, ...firstYearClass.prospects],
  };
}

export function advanceHighSchoolPlayerPool(
  rng: Rng,
  year: number,
  count: number,
  previousProspects: Prospect[],
  schools: SchoolProfile[],
): { prospects: Prospect[]; classQuality: DraftClassQualityProfile } {
  const promotedBase = previousProspects
    .filter((prospect) => prospect.schoolYear < 3 && prospect.draftEligibleYear >= year)
    .map((prospect) => promoteProspect(rng, prospect, year, schools));
  const promotedEligible = applyNonHighSchoolEntrants(
    rng,
    year,
    promotedBase.filter((prospect) => prospect.schoolYear === 3 && prospect.draftEligibleYear === year),
  );
  const promotedEligibleIds = new Set(promotedEligible.map((prospect) => prospect.id));
  const promoted = [
    ...promotedEligible,
    ...promotedBase.filter((prospect) => !promotedEligibleIds.has(prospect.id)),
  ];
  const existingIds = new Set(promoted.map((prospect) => prospect.id));
  const newFirstYearClass = createDraftClassFromSchools(rng, year + 2, count, schools, 1);
  const prospects = [
    ...promoted,
    ...newFirstYearClass.prospects.filter((prospect) => !existingIds.has(prospect.id)),
  ];
  return {
    prospects,
    classQuality: createDraftClassQuality(rng),
  };
}

function createDraftClassFromSchools(rng: Rng, year: number, count: number, schools: SchoolProfile[], schoolYear: SchoolYear = 3): { prospects: Prospect[]; schools: SchoolProfile[]; classQuality: DraftClassQualityProfile } {
  const assignments = createSchoolAssignments(rng, schools, count);
  const classQuality = createDraftClassQuality(rng);
  const highSchoolSpecialCount = createHighSchoolSpecialCount(rng, classQuality, schoolYear);
  const baseProspects = Array.from({ length: count }, (_, index) => createProspect(rng, year, index + 1, assignments[index], classQuality, index < highSchoolSpecialCount, schoolYear));
  const prospects = schoolYear === 3 ? applyNonHighSchoolEntrants(rng, year, baseProspects) : baseProspects;
  const accoladeProspects = applyQuotaAccoladesToClass(prospects, observationYearForClass(year, schoolYear));
  return {
    schools,
    classQuality,
    prospects: applyVisibilityEventsToClass(rng, accoladeProspects, observationYearForClass(year, schoolYear)),
  };
}

function promoteProspect(rng: Rng, prospect: Prospect, year: number, schools: SchoolProfile[]): Prospect {
  const growth = createHighSchoolGrowthChange(rng, prospect);
  const event = determineHighSchoolIssueEvent(rng, prospect, growth);
  const nextSchoolYear = event.type === "repeat-year" ? prospect.schoolYear : Math.min(3, prospect.schoolYear + 1) as SchoolYear;
  const nextSchool = event.type === "transfer" ? pickTransferSchool(rng, prospect, schools) : undefined;
  const basePhysical = advanceHighSchoolPhysical(rng, prospect.physical, prospect.primaryPosition, nextSchoolYear, growth);
  const episodes = determineHighSchoolGrowthEpisodes(rng, prospect, growth, nextSchoolYear, basePhysical, event);
  const positionPlan = createHighSchoolPositionPlan(prospect, episodes);
  const nextPhysical = applyHighSchoolEpisodesToPhysical(basePhysical, episodes, positionPlan.primaryPosition);
  const nextTrueTalent = applyHighSchoolEpisodesToTalent(advanceHighSchoolTalent(prospect.trueTalent, growth, event), episodes, positionPlan);
  const tier = dataTierFromPublicRank(prospect.visible.publicRank);
  const advancedHitterStats = prospect.hitterStats ? advanceHighSchoolHitterStats(prospect.hitterStats, rng, growth, nextSchoolYear) : undefined;
  const advancedPitcherStats = prospect.pitcherStats ? advanceHighSchoolPitcherStats(prospect.pitcherStats, rng, growth, nextSchoolYear, nextPhysical) : undefined;
  const nextHitterStats = positionPlan.playerGroup === "pitcher"
    ? undefined
    : applyHighSchoolEpisodesToHitterStats(
      applyHighSchoolEventToHitterStats(advancedHitterStats ?? createConvertedHitterStats(rng, nextTrueTalent, tier, positionPlan.primaryPosition, prospect.leagueLevel), event),
      episodes,
    );
  const nextPitcherStats = positionPlan.playerGroup === "pitcher"
    ? applyHighSchoolEpisodesToPitcherStats(
      applyHighSchoolEventToPitcherStats(advancedPitcherStats ?? createConvertedPitcherStats(rng, nextTrueTalent, tier, positionPlan.primaryPosition, prospect.leagueLevel, nextPhysical), event),
      episodes,
    )
    : undefined;
  const nextVisible = applyHighSchoolEpisodesToVisible(
    applyHighSchoolEventToVisible(advanceHighSchoolVisibleReport(prospect.visible, rng, growth, nextSchoolYear), event, nextSchool),
    episodes,
  );
  const nextSeasonFormCycle = advanceSeasonFormCycle(rng, prospect.seasonFormCycle, growth, nextSchoolYear);
  const nextArchetype = episodes.some((episode) => episode.type === "pitcher-to-hitter" || episode.type === "hitter-to-pitcher" || episode.type === "defensive-position-change" || episode.type === "pitching-role-change")
    ? createArchetype(rng, nextVisible.publicRank, positionPlan.primaryPosition, nextPhysical, nextTrueTalent, prospect.leagueLevel, prospect.collegeCommitRisk, nextHitterStats, nextPitcherStats, prospect.accolades)
    : prospect.archetype;
  const logEntries = [
    ...createHighSchoolPromotionLogs(prospect, nextSchoolYear, year, growth, nextPhysical, nextPitcherStats),
    ...createHighSchoolEpisodeLogs(prospect, nextSchoolYear, year, episodes),
    ...createHighSchoolActualEventLogs(prospect, nextSchoolYear, year, event, nextSchool),
  ];
  const promoted: Prospect = {
    ...prospect,
    ...(nextSchool ? schoolFieldsFromProfile(nextSchool) : {}),
    schoolYear: nextSchoolYear,
    highSchoolStatus: nextSchoolYear === 3 ? "draft-eligible" : "active",
    playerGroup: positionPlan.playerGroup,
    primaryPosition: positionPlan.primaryPosition,
    secondaryPositions: secondaryPositionsFor(rng, positionPlan.primaryPosition),
    archetype: nextArchetype,
    draftYear: event.type === "repeat-year" ? prospect.draftYear + 1 : prospect.draftYear,
    draftEligibleYear: event.type === "repeat-year" ? prospect.draftEligibleYear + 1 : prospect.draftEligibleYear,
    age: roundTo(prospect.age + 1, 1),
    collegeCommitRisk: event.type === "college-risk" ? Math.round(clamp(prospect.collegeCommitRisk + 14, 0, 98)) : prospect.collegeCommitRisk,
    physical: nextPhysical,
    hitterStats: nextHitterStats,
    pitcherStats: nextPitcherStats,
    seasonFormCycle: nextSeasonFormCycle,
    visible: nextVisible,
    trueTalent: nextTrueTalent,
    highSchoolCareerLog: [...(prospect.highSchoolCareerLog ?? []), ...logEntries],
    highSchoolSnapshots: [
      ...(prospect.highSchoolSnapshots ?? []),
      createHighSchoolSnapshot({
        ...prospect,
        schoolYear: nextSchoolYear,
        physical: nextPhysical,
        hitterStats: nextHitterStats,
        pitcherStats: nextPitcherStats,
        visible: nextVisible,
      }, year, highSchoolSnapshotNote(growth, nextSchoolYear, event)),
    ],
  };
  const exposedPromoted = exposePromotedHighSchoolSpecial(promoted, year);
  return nextSchoolYear === 3 && exposedPromoted.mlbDirectStatus === "interest"
    ? maybeApplyMlbDirectEvent(rng, exposedPromoted, year)
    : exposedPromoted;
}

function createHighSchoolSpecialCount(rng: Rng, classQuality: DraftClassQualityProfile, schoolYear: SchoolYear): number {
  if (schoolYear === 1) {
    if (classQuality.id === "bumper" && rng.next() < 0.18) return 1;
    if (classQuality.id === "strong" && rng.next() < 0.08) return 1;
    return 0;
  }
  if (schoolYear === 2) {
    if (classQuality.id === "bumper") return randomInt(rng, 1, 2);
    if (classQuality.id === "strong") return rng.next() < 0.56 ? 1 : 0;
    if (classQuality.id === "normal") return rng.next() < 0.24 ? 1 : 0;
    return rng.next() < 0.12 ? 1 : 0;
  }
  if (classQuality.id === "bumper") return randomInt(rng, 4, 7);
  if (classQuality.id === "strong") return randomInt(rng, 2, 4);
  if (classQuality.id === "normal") return randomInt(rng, 1, 3);
  if (classQuality.id === "thin") return rng.next() < 0.64 ? 1 : 2;
  return rng.next() < 0.72 ? 1 : 0;
}

function createDraftClassQuality(rng: Rng): DraftClassQualityProfile {
  const roll = rng.next();
  if (roll < 0.12) {
    return {
      id: "bumper",
      label: "대풍년",
      description: "상위권 스타 후보와 중하위권 숨은 자원이 동시에 두꺼운 해입니다.",
      currentAbilityShift: 2.2,
      potentialShift: 4.6,
      topTalentShift: 3.6,
      depthTalentShift: 2.4,
      sleeperChanceBoost: 0.035,
      overhypeChanceBoost: -0.04,
      growthRateShift: 0.08,
      volatilityShift: -0.03,
    };
  }
  if (roll < 0.34) {
    return {
      id: "strong",
      label: "풍년",
      description: "1~4라운드 후보층이 평년보다 탄탄한 드래프트입니다.",
      currentAbilityShift: 1.1,
      potentialShift: 2.4,
      topTalentShift: 1.8,
      depthTalentShift: 1,
      sleeperChanceBoost: 0.018,
      overhypeChanceBoost: -0.015,
      growthRateShift: 0.035,
      volatilityShift: -0.015,
    };
  }
  if (roll < 0.72) {
    return {
      id: "normal",
      label: "평년",
      description: "상위권과 하위권의 분포가 평년 수준인 드래프트입니다.",
      currentAbilityShift: 0,
      potentialShift: 0,
      topTalentShift: 0,
      depthTalentShift: 0,
      sleeperChanceBoost: 0,
      overhypeChanceBoost: 0,
      growthRateShift: 0,
      volatilityShift: 0,
    };
  }
  if (roll < 0.92) {
    return {
      id: "thin",
      label: "소흉년",
      description: "상위권은 보이지만 중위권 이후 확실한 후보가 얇은 해입니다.",
      currentAbilityShift: -1,
      potentialShift: -2.4,
      topTalentShift: -0.8,
      depthTalentShift: -1.7,
      sleeperChanceBoost: -0.012,
      overhypeChanceBoost: 0.055,
      growthRateShift: -0.035,
      volatilityShift: 0.035,
    };
  }
  return {
    id: "weak",
    label: "흉년",
    description: "전체적으로 확실한 재능이 부족하고 공개 평가와 실제 재능의 괴리가 큰 해입니다.",
    currentAbilityShift: -2.2,
    potentialShift: -4.2,
    topTalentShift: -2.6,
    depthTalentShift: -2.2,
    sleeperChanceBoost: -0.018,
    overhypeChanceBoost: 0.11,
    growthRateShift: -0.055,
    volatilityShift: 0.07,
  };
}

function applyNonHighSchoolEntrants(rng: Rng, year: number, prospects: Prospect[]): Prospect[] {
  const collegeCount = randomInt(rng, 28, 44);
  const returneeCount = rng.next() < 0.18 ? 0 : rng.next() < 0.68 ? 1 : rng.next() < 0.9 ? 2 : rng.next() < 0.98 ? 3 : 4;
  const protectedRanks = new Set(prospects.filter((prospect) => prospect.archetype === "고교특급" || prospect.visible.publicRank <= 18).map((prospect) => prospect.visible.publicRank));
  const collegeRanks = pickUniqueRanks(
    rng,
    prospects
      .filter((prospect) => !protectedRanks.has(prospect.visible.publicRank) && prospect.visible.publicRank >= 35 && prospect.visible.publicRank <= 310)
      .map((prospect) => prospect.visible.publicRank),
    collegeCount,
  );
  const returneeRanks = pickUniqueRanks(
    rng,
    prospects
      .filter((prospect) => !protectedRanks.has(prospect.visible.publicRank) && !collegeRanks.has(prospect.visible.publicRank) && prospect.visible.publicRank >= 50 && prospect.visible.publicRank <= 240)
      .map((prospect) => prospect.visible.publicRank),
    returneeCount,
  );

  return prospects.map((prospect) => {
    if (returneeRanks.has(prospect.visible.publicRank)) return createOverseasReturneeProspect(rng, year, prospect);
    if (collegeRanks.has(prospect.visible.publicRank)) return createCollegeProspect(rng, year, prospect);
    return { ...prospect, sourceType: "high-school" };
  });
}

function pickUniqueRanks(rng: Rng, ranks: number[], count: number): Set<number> {
  const pool = [...ranks];
  const selected = new Set<number>();
  while (pool.length > 0 && selected.size < count) {
    const index = randomInt(rng, 0, pool.length - 1);
    selected.add(pool[index]);
    pool.splice(index, 1);
  }
  return selected;
}

function createCollegeProspect(rng: Rng, year: number, prospect: Prospect): Prospect {
  const program = pickOne(rng, COLLEGE_PROGRAMS);
  const fourYearEarlyEligible = program.type === "four-year" && prospect.visible.publicRank <= 115 && (prospect.reputation + prospect.draftHype >= 78 || prospect.visible.scoutGrade === "A" || prospect.visible.scoutGrade === "B");
  const earlyEntry = fourYearEarlyEligible && rng.next() < 0.42;
  const redraft = !earlyEntry && rng.next() < (prospect.visible.publicRank >= 95 ? 0.86 : 0.68);
  const collegeDraftRoute: NonNullable<Prospect["collegeDraftRoute"]> = redraft
    ? "redraft"
    : program.type === "two-year"
      ? "junior-college"
      : earlyEntry
        ? "early-entry"
        : "regular";
  const collegeYear = createCollegeYearForRoute(rng, collegeDraftRoute, program.type);
  const age = createCollegeDraftAge(rng, collegeDraftRoute, collegeYear);
  const polishedTalent = adjustTalentForCollege(prospect.trueTalent);
  const routeLabel = collegeRouteLabel(collegeDraftRoute);
  const routeNote = collegeRouteNote(collegeDraftRoute, collegeYear, prospect);
  const visible = {
    ...prospect.visible,
    confidence: clamp(prospect.visible.confidence + randomFloat(rng, collegeDraftRoute === "early-entry" ? 0.04 : 0.08, collegeDraftRoute === "redraft" ? 0.16 : 0.22), 0.32, 0.94),
    riskTags: collegeRiskTags(prospect, collegeDraftRoute),
    strengths: uniqueStringsLocal([routeLabel, "대학리그 표본", ...prospect.visible.strengths]).slice(0, 4),
    weaknesses: uniqueStringsLocal([...prospect.visible.weaknesses, collegeDraftRoute === "early-entry" ? "얼리드래프트 검증 표본" : polishedTalent.potential <= 66 ? "성장 여지 제한" : "나이 대비 고점 검증 필요"]).slice(0, 4),
    summary: `${program.type === "two-year" ? "2년제 전문대" : "4년제 대학"} ${collegeYear}학년 후보. ${routeNote} 고교 시절 기록과 대학 표본을 함께 봐야 하는 선수다. 성장 곡선은 고교생보다 짧지만 역할 검증은 더 많다. ${prospect.visible.summary}`,
    oneLine: `${program.name} ${routeLabel} ${POSITION_NAMES[prospect.primaryPosition]} 후보. 즉전성은 확인됐지만 장기 고점은 별도 판단이 필요하다.`,
    growthProjection: `입단 직후 퓨처스 적응 기간은 짧을 수 있다. 다만 ${collegeDraftRoute === "early-entry" ? "어린 나이에 대학 실적을 앞세워 나온 케이스라 프로 적응 속도" : "고교 선수보다 나이가 많아 잠재력보다 역할 적합도"}를 우선 확인해야 한다.`,
  };
  return {
    ...prospect,
    sourceType: "college",
    collegeProgramType: program.type,
    collegeYear,
    collegeDraftRoute,
    draftEligibilityNote: `${program.type === "two-year" ? "2년제 전문대" : "4년제 대학"} ${collegeYear}학년 · ${routeLabel}${collegeDraftRoute === "redraft" ? " · 고교 미지명 후 대학 재도전" : ""}`,
    highSchoolEntryYear: year - 5,
    age,
    schoolId: `college-${program.name}`,
    school: program.name,
    schoolRegion: program.region,
    schoolTier: prospect.schoolTier === "small" ? "normal" : prospect.schoolTier,
    schoolLeagueStrength: Math.round(clamp(prospect.schoolLeagueStrength + randomFloat(rng, 3, 9), 45, 92)),
    schoolReportReliabilityBase: clamp(prospect.schoolReportReliabilityBase + randomFloat(rng, 0.08, 0.18), 0.38, 0.92),
    archetype: collegeArchetype(prospect, collegeDraftRoute),
    leagueLevel: prospect.leagueLevel === "정보 부족" ? "보통" : prospect.leagueLevel,
    collegeCommitRisk: 0,
    reputation: Math.round(clamp(prospect.reputation + randomFloat(rng, 3, 13), 0, 100)),
    draftHype: Math.round(clamp(prospect.draftHype + randomFloat(rng, -4, 10), 0, 100)),
    trueTalent: polishedTalent,
    visible,
    highSchoolCareerLog: [
      ...prospect.highSchoolCareerLog,
      {
        year,
        schoolYear: 3,
        type: "showcase",
        headline: `${prospect.name}, ${routeLabel} 지명 후보로 재평가`,
        body: `${program.name}에서 ${routeNote} 고교 시절 기존 리포트와 대학 성적을 함께 대조해야 한다. 고점보다 즉전성과 포지션 적합도가 평가의 중심이다.`,
        importance: prospect.visible.publicRank <= 100 ? 4 : 3,
      },
    ],
  };
}

function createOverseasReturneeProspect(rng: Rng, year: number, prospect: Prospect): Prospect {
  const path = weightedPick(rng, [
    { value: "mlb-minor" as const, weight: 8 },
    { value: "npb-minor" as const, weight: 3 },
    { value: "independent" as const, weight: 4 },
    { value: "academy" as const, weight: 2 },
  ]);
  const returnReason = weightedPick(rng, [
    { value: "방출" as const, weight: 5 },
    { value: "부상" as const, weight: 2 },
    { value: "출전 기회 부족" as const, weight: 4 },
    { value: "병역/국내 복귀" as const, weight: 2 },
    { value: "계약 만료" as const, weight: 3 },
  ]);
  const lifestyle = weightedPick(rng, [
    { value: "regular-starter" as const, weight: 3 },
    { value: "bench-depth" as const, weight: 4 },
    { value: "rehab-focused" as const, weight: returnReason === "부상" ? 6 : 2 },
    { value: "travel-grind" as const, weight: 4 },
    { value: "training-only" as const, weight: 2 },
  ]);
  const overseasYears = randomInt(rng, 2, 6);
  const age = createOverseasReturneeAge(rng, overseasYears, lifestyle);
  const adjustedTalent = adjustTalentForOverseasReturnee(prospect.trueTalent, returnReason, lifestyle, age);
  const riskTags = uniqueRiskTags([
    ...prospect.visible.riskTags,
    returnReason === "부상" ? "injury-history" : "low-record-trust",
    "signability",
  ]);
  const visible = {
    ...prospect.visible,
    confidence: clamp(prospect.visible.confidence + randomFloat(rng, -0.03, 0.1), 0.24, 0.82),
    riskLevel: prospect.visible.riskLevel === "low" ? "medium" : prospect.visible.riskLevel,
    riskTags,
    strengths: uniqueStringsLocal([overseasPathLabel(path), overseasLifestyleLabel(lifestyle), ...prospect.visible.strengths]).slice(0, 4),
    weaknesses: uniqueStringsLocal([returnReason === "부상" ? "건강 검증 필요" : age >= 27 ? "나이와 실전 공백" : "국내 실전 공백", ...prospect.visible.weaknesses]).slice(0, 4),
    summary: `${overseasPathLabel(path)} 경력 후 국내 드래프트 복귀. ${overseasLifestyleLabel(lifestyle)} 생활을 거쳤고, 나이 ${age}세라는 변수가 평가의 중심이다. 이름값과 툴은 남아 있지만, 실전 공백과 복귀 사유를 분리해서 봐야 한다. ${prospect.visible.summary}`,
    oneLine: `해외 복귀 후보. ${returnReason} 이후 국내 무대에서 다시 평가받는 리스크/즉전성 혼합 프로필.`,
    growthProjection: `해외 시스템 경험은 적응에 도움이 될 수 있다. 다만 ${age >= 27 ? "나이와 역할 전환" : "생활 패턴과 실전 감각"} 문제가 반복되면 기대치와 결과의 차이가 크게 벌어질 수 있다.`,
  };
  return {
    ...prospect,
    sourceType: "overseas-returnee",
    overseasPath: path,
    overseasYears,
    overseasLifestyle: lifestyle,
    returnReason,
    draftEligibilityNote: `${overseasPathLabel(path)} ${overseasYears}년 · ${overseasLifestyleLabel(lifestyle)} · 국내 복귀`,
    highSchoolEntryYear: year - 6,
    age,
    schoolId: `overseas-${path}`,
    school: overseasPathLabel(path),
    schoolRegion: "서울권",
    schoolTier: "normal",
    schoolLeagueStrength: Math.round(clamp(prospect.schoolLeagueStrength + randomFloat(rng, 0, 12), 40, 94)),
    schoolReportReliabilityBase: clamp(prospect.schoolReportReliabilityBase + randomFloat(rng, -0.06, 0.08), 0.28, 0.82),
    archetype: `해외 복귀 ${POSITION_NAMES[prospect.primaryPosition]}`,
    leagueLevel: "정보 부족",
    collegeCommitRisk: 0,
    reputation: Math.round(clamp(prospect.reputation + randomFloat(rng, 18, 34), 0, 100)),
    draftHype: Math.round(clamp(prospect.draftHype + randomFloat(rng, 12, 30), 0, 100)),
    trueTalent: adjustedTalent,
    visible,
    highSchoolCareerLog: [
      ...prospect.highSchoolCareerLog,
      {
        year,
        schoolYear: 3,
        type: "showcase",
        headline: `${prospect.name}, 해외 경험 후 국내 드래프트 복귀`,
        body: `${overseasPathLabel(path)}에서 ${overseasYears}년을 보냈고, 최근 생활 패턴은 ${overseasLifestyleLabel(lifestyle)}에 가깝다. ${returnReason} 사유로 국내 지명 시장에 들어왔으며 나이와 실전 공백이 동시에 평가 변수다.`,
        importance: prospect.visible.publicRank <= 120 ? 4 : 3,
      },
    ],
  };
}

function createCollegeYearForRoute(
  _rng: Rng,
  route: NonNullable<Prospect["collegeDraftRoute"]>,
  programType: NonNullable<Prospect["collegeProgramType"]>,
): 2 | 4 {
  if (programType === "two-year") return 2;
  if (route === "early-entry") return 2;
  return 4;
}

function createCollegeDraftAge(rng: Rng, route: NonNullable<Prospect["collegeDraftRoute"]>, collegeYear: 2 | 4): number {
  if (route === "junior-college") return roundTo(randomFloat(rng, 20.0, 21.4), 1);
  if (route === "early-entry") return roundTo(randomFloat(rng, 19.7, 20.8), 1);
  if (route === "redraft") {
    return collegeYear === 2 ? roundTo(randomFloat(rng, 20.1, 21.8), 1) : roundTo(randomFloat(rng, 21.5, 24.4), 1);
  }
  return collegeYear === 2 ? roundTo(randomFloat(rng, 20.0, 21.5), 1) : roundTo(randomFloat(rng, 21.5, 23.6), 1);
}

function collegeRouteLabel(route: NonNullable<Prospect["collegeDraftRoute"]>): string {
  if (route === "junior-college") return "전문대 드래프트";
  if (route === "early-entry") return "얼리드래프트";
  if (route === "redraft") return "재도전 드래프트";
  return "정규 드래프트";
}

function collegeRouteNote(route: NonNullable<Prospect["collegeDraftRoute"]>, collegeYear: 2 | 4, prospect: Prospect): string {
  if (route === "junior-college") return `고교 드래프트 이후 2년제 전문대 ${collegeYear}학년으로 짧은 대학 경력 안에서 지명 시장에 들어왔다.`;
  if (route === "early-entry") return `대학 1~2학년 성적과 툴 평가가 좋아 ${collegeYear}학년 시점에 얼리드래프트를 신청했다.`;
  if (route === "redraft") return `고교 드래프트에서 지명받지 못한 뒤 대학에서 표본을 쌓아 다시 지명 시장에 돌아왔다.`;
  return `고교 드래프트 이후 4년제 대학에서 누적 표본을 쌓은 뒤 정규 지명 대상이 됐다.`;
}

function collegeRiskTags(prospect: Prospect, route: NonNullable<Prospect["collegeDraftRoute"]>): ProspectRiskTag[] {
  const tags: ProspectRiskTag[] = prospect.visible.riskTags.filter((tag) => tag !== "low-record-trust" && tag !== "signability");
  if (route === "early-entry") tags.push("small-sample");
  if (route === "redraft") tags.push("low-record-trust");
  return uniqueRiskTags(tags);
}

function createOverseasReturneeAge(rng: Rng, overseasYears: number, lifestyle: NonNullable<Prospect["overseasLifestyle"]>): number {
  const lifestyleShift = lifestyle === "regular-starter" ? -0.4 : lifestyle === "training-only" ? 0.7 : lifestyle === "rehab-focused" ? 0.9 : 0.2;
  return roundTo(randomFloat(rng, 21.4 + overseasYears * 0.45 + lifestyleShift, 24.6 + overseasYears * 0.62 + lifestyleShift), 1);
}

function overseasLifestyleLabel(lifestyle?: Prospect["overseasLifestyle"]): string {
  if (lifestyle === "regular-starter") return "주전급 출전";
  if (lifestyle === "bench-depth") return "벤치·대기 전력";
  if (lifestyle === "rehab-focused") return "재활 중심 생활";
  if (lifestyle === "travel-grind") return "이동 많은 마이너 생활";
  if (lifestyle === "training-only") return "훈련 위주 생활";
  return "해외 생활";
}

function adjustTalentForCollege(talent: HiddenTalentProfile): HiddenTalentProfile {
  return {
    ...talent,
    currentAbility: Math.round(clamp(talent.currentAbility + 3, 20, 82)),
    potential: Math.round(clamp(talent.potential - 2, 30, 88)),
    growthRate: clamp(talent.growthRate - 0.05, 0.05, 0.92),
    proAdaptation: clamp(talent.proAdaptation + 0.08, 0.08, 0.96),
    volatility: clamp(talent.volatility - 0.04, 0.05, 0.9),
  };
}

function adjustTalentForOverseasReturnee(talent: HiddenTalentProfile, returnReason: Prospect["returnReason"], lifestyle: Prospect["overseasLifestyle"], age: number): HiddenTalentProfile {
  const injuryPenalty = returnReason === "부상" ? 0.1 : 0;
  const lifestyleAdaptation = lifestyle === "regular-starter" ? 0.06 : lifestyle === "training-only" ? -0.04 : lifestyle === "rehab-focused" ? -0.02 : 0;
  const agePenalty = Math.max(0, age - 25.5) * 0.025;
  return {
    ...talent,
    currentAbility: Math.round(clamp(talent.currentAbility + 4 - agePenalty * 8, 24, 84)),
    potential: Math.round(clamp(talent.potential + (returnReason === "출전 기회 부족" ? 2 : -1) - agePenalty * 12, 34, 91)),
    injuryRisk: clamp(talent.injuryRisk + injuryPenalty + 0.04, 0.04, 0.96),
    volatility: clamp(talent.volatility + 0.1 + agePenalty, 0.12, 0.98),
    proAdaptation: clamp(talent.proAdaptation + 0.03 + lifestyleAdaptation, 0.08, 0.96),
  };
}

function collegeArchetype(prospect: Prospect, route: NonNullable<Prospect["collegeDraftRoute"]>): string {
  if (route === "early-entry") return `대학 얼리 ${POSITION_NAMES[prospect.primaryPosition]}`;
  if (route === "redraft") return `대학 재도전 ${POSITION_NAMES[prospect.primaryPosition]}`;
  if (route === "junior-college") return `전문대 ${POSITION_NAMES[prospect.primaryPosition]}`;
  if (prospect.primaryPosition === "RP") return "대학 즉전 불펜";
  if (prospect.primaryPosition === "SP") return "대학 선발 후보";
  if (["C", "SS", "CF"].includes(prospect.primaryPosition)) return "대학 수비형 즉전 후보";
  return "대학 완성형 야수";
}

function overseasPathLabel(path?: Prospect["overseasPath"]): string {
  if (path === "mlb-minor") return "MLB 마이너";
  if (path === "npb-minor") return "NPB 육성/2군";
  if (path === "independent") return "해외 독립리그";
  if (path === "academy") return "해외 아카데미";
  return "해외 경력";
}

function uniqueRiskTags(tags: ProspectRiskTag[]): ProspectRiskTag[] {
  return Array.from(new Set(tags));
}

function uniqueStringsLocal(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

const COLLEGE_PROGRAMS: Array<{ name: string; type: "two-year" | "four-year"; region: Prospect["schoolRegion"] }> = [
  { name: "고려대", type: "four-year", region: "서울권" },
  { name: "연세대", type: "four-year", region: "서울권" },
  { name: "성균관대", type: "four-year", region: "서울권" },
  { name: "한양대", type: "four-year", region: "서울권" },
  { name: "동국대", type: "four-year", region: "서울권" },
  { name: "중앙대", type: "four-year", region: "서울권" },
  { name: "건국대", type: "four-year", region: "서울권" },
  { name: "경희대", type: "four-year", region: "서울권" },
  { name: "홍익대", type: "four-year", region: "서울권" },
  { name: "서울대", type: "four-year", region: "서울권" },
  { name: "사이버한국외대", type: "four-year", region: "서울권" },
  { name: "서울문화예술대", type: "four-year", region: "서울권" },
  { name: "단국대", type: "four-year", region: "경기·인천권" },
  { name: "인하대", type: "four-year", region: "경기·인천권" },
  { name: "용인예술과학대", type: "two-year", region: "경기·인천권" },
  { name: "동원대", type: "two-year", region: "경기·인천권" },
  { name: "장안대", type: "two-year", region: "경기·인천권" },
  { name: "신안산대", type: "two-year", region: "경기·인천권" },
  { name: "여주대", type: "two-year", region: "경기·인천권" },
  { name: "경민대", type: "two-year", region: "경기·인천권" },
  { name: "강릉영동대", type: "two-year", region: "강원권" },
  { name: "대덕대", type: "two-year", region: "대전·세종권" },
  { name: "신성대", type: "two-year", region: "충청권" },
  { name: "충북보건과학대", type: "two-year", region: "충청권" },
  { name: "청운대", type: "four-year", region: "충청권" },
  { name: "원광대", type: "four-year", region: "전북권" },
  { name: "우석대", type: "four-year", region: "전북권" },
  { name: "전주기전대", type: "two-year", region: "전북권" },
  { name: "한일장신대", type: "four-year", region: "전북권" },
  { name: "송원대", type: "four-year", region: "광주·전남권" },
  { name: "동강대", type: "two-year", region: "광주·전남권" },
  { name: "목포과학대", type: "two-year", region: "광주·전남권" },
  { name: "영남대", type: "four-year", region: "대구·경북권" },
  { name: "계명대", type: "four-year", region: "대구·경북권" },
  { name: "경일대", type: "four-year", region: "대구·경북권" },
  { name: "구미대", type: "two-year", region: "대구·경북권" },
  { name: "수성대", type: "two-year", region: "대구·경북권" },
  { name: "동아대", type: "four-year", region: "부산·울산·경남권" },
  { name: "동의대", type: "four-year", region: "부산·울산·경남권" },
  { name: "경성대", type: "four-year", region: "부산·울산·경남권" },
  { name: "경남대", type: "four-year", region: "부산·울산·경남권" },
  { name: "동의과학대", type: "two-year", region: "부산·울산·경남권" },
  { name: "동원과학기술대", type: "two-year", region: "부산·울산·경남권" },
  { name: "부산과학기술대", type: "two-year", region: "부산·울산·경남권" },
  { name: "제주관광대", type: "two-year", region: "제주권" },
];

function createProspect(rng: Rng, year: number, publicRank: number, school: SchoolProfile, classQuality: DraftClassQualityProfile, highSchoolSpecial = false, schoolYear: SchoolYear = 3): Prospect {
  const primaryPosition = highSchoolSpecial ? pickHighSchoolSpecialPosition(rng, school) : pickPosition(rng, school);
  const playerGroup = POSITION_GROUPS[primaryPosition];
  const dataTier = dataTierFromPublicRank(publicRank);
  let trueTalent = highSchoolSpecial
    ? createHighSchoolSpecialTalent(rng, publicRank, dataTier, school, classQuality, primaryPosition)
    : createHiddenTalent(rng, publicRank, dataTier, school, classQuality, primaryPosition);
  const age = createAgeForSchoolYear(rng, schoolYear);
  const physical: PhysicalProfile = {
    heightCm: heightForPosition(rng, primaryPosition),
    weightKg: weightForPosition(rng, primaryPosition),
    bats: pickOne(rng, ["L", "R", "S"] as const),
    throws: primaryPosition === "SP" || primaryPosition === "RP" ? pickOne(rng, ["L", "R"] as const) : pickOne(rng, ["R", "R", "R", "L"] as const),
  };
  const leagueLevel = pickLeagueLevel(rng, publicRank, school);
  const rawHitterStats = playerGroup === "pitcher" ? undefined : createHitterStats(rng, trueTalent, dataTier, primaryPosition, leagueLevel);
  const rawPitcherStats = playerGroup === "pitcher" ? createPitcherStats(rng, trueTalent, dataTier, primaryPosition, leagueLevel, physical) : undefined;
  const specialHitterStats = highSchoolSpecial && rawHitterStats ? polishHighSchoolSpecialHitterStats(rawHitterStats, rng, primaryPosition) : rawHitterStats;
  const specialPitcherStats = highSchoolSpecial && rawPitcherStats ? polishHighSchoolSpecialPitcherStats(rawPitcherStats, rng, primaryPosition) : rawPitcherStats;
  const accolades = createMilestoneAccolades(publicRank, primaryPosition, specialHitterStats, specialPitcherStats, schoolYear);
  const hitterStats = specialHitterStats ? applyUnderclassHitterUsage(applyAccoladeHitterEffects(specialHitterStats, accolades), rng, schoolYear, highSchoolSpecial) : undefined;
  const pitcherStats = specialPitcherStats ? applyUnderclassPitcherUsage(applyAccoladePitcherEffects(specialPitcherStats, accolades), rng, schoolYear, highSchoolSpecial, primaryPosition) : undefined;
  trueTalent = adjustForkSplitterInjuryRisk(trueTalent, pitcherStats);
  const collegeCommitRisk = createCollegeCommitRisk(rng, publicRank, dataTier, accolades);
  const archetype = highSchoolSpecial ? "고교특급" : createArchetype(rng, publicRank, primaryPosition, physical, trueTalent, leagueLevel, collegeCommitRisk, hitterStats, pitcherStats, accolades);
  const reputation = clamp(accolades.reduce((total, accolade) => total + accolade.reputationBoost, 0) + leagueReputationBonus(leagueLevel) + randomFloat(rng, highSchoolSpecial ? 18 : 0, highSchoolSpecial ? 34 : publicRank <= 40 ? 10 : 4), 0, 100);
  const draftHype = clamp(accolades.reduce((total, accolade) => total + accolade.hypeBoost, 0) + (highSchoolSpecial ? randomFloat(rng, 32, 52) : publicRank <= 20 ? randomFloat(rng, 8, 18) : randomFloat(rng, 0, 8)) + (collegeCommitRisk >= 70 ? randomFloat(rng, -6, 2) : 0), 0, 100);
  const baseVisible = createVisibleScoutingReport(rng, trueTalent, publicRank, playerGroup, {
    position: primaryPosition,
    physical,
    hitterStats,
    pitcherStats,
    accolades,
    reputation,
    draftHype,
    archetype,
    leagueLevel,
    collegeCommitRisk,
    schoolTier: school.tier,
    schoolTraits: school.traits,
    schoolDevelopmentBias: school.developmentBias,
    schoolReportReliabilityBase: school.reportReliabilityBase,
  });
  const visible = exposeDraftEligibleHighSchoolSpecial(
    createSchoolYearVisibleReport(highSchoolSpecial ? createHighSchoolSpecialVisibleReport(baseVisible, trueTalent.currentAbility) : baseVisible, schoolYear, highSchoolSpecial),
    trueTalent.currentAbility,
    schoolYear,
    highSchoolSpecial,
  );
  const seasonFormCycle = createSeasonFormCycle(rng, playerGroup === "pitcher" ? "pitcher" : "hitter", trueTalent, dataTier, highSchoolSpecial, hitterStats, pitcherStats);

  const prospect: Prospect = {
    id: `prospect-${year}-${publicRank}` as ProspectId,
    draftYear: year,
    highSchoolEntryYear: year - 2,
    draftEligibleYear: year,
    name: generateKoreanName(rng),
    schoolId: school.id,
    school: school.name,
    schoolRegion: school.region,
    schoolTier: school.tier,
    schoolTraits: school.traits,
    schoolDevelopmentBias: school.developmentBias,
    schoolLeagueStrength: school.leagueStrength,
    schoolReportReliabilityBase: school.reportReliabilityBase,
    schoolYear,
    highSchoolStatus: schoolYear === 3 ? "draft-eligible" : "active",
    playerGroup,
    primaryPosition,
    secondaryPositions: secondaryPositionsFor(rng, primaryPosition),
    age,
    archetype,
    leagueLevel,
    collegeCommitRisk,
    physical,
    hitterStats,
    pitcherStats,
    seasonFormCycle,
    accolades,
    reputation: Math.round(reputation),
    draftHype: Math.round(draftHype),
    visible,
    trueTalent,
    highSchoolSnapshots: [],
    highSchoolCareerLog: [],
    isDrafted: false,
  };
  const initialHistory = createInitialHighSchoolHistory(prospect, observationYearForClass(year, schoolYear));
  return {
    ...prospect,
    highSchoolSnapshots: initialHistory.snapshots,
    highSchoolCareerLog: initialHistory.logs,
  };
}

function observationYearForClass(draftEligibleYear: number, schoolYear: SchoolYear): number {
  return draftEligibleYear - (3 - schoolYear);
}

function createAgeForSchoolYear(rng: Rng, schoolYear: SchoolYear): number {
  if (schoolYear === 1) return roundTo(randomFloat(rng, 15.1, 16.4), 1);
  if (schoolYear === 2) return roundTo(randomFloat(rng, 16.1, 17.4), 1);
  return roundTo(randomFloat(rng, 17.1, 18.9), 1);
}

function createHighSchoolGrowthChange(rng: Rng, prospect: Prospect): number {
  const room = Math.max(0, prospect.trueTalent.potential - prospect.trueTalent.currentAbility);
  const schoolBias = prospect.schoolDevelopmentBias === "raw" ? 0.45 : prospect.schoolDevelopmentBias === "polished" ? 0.2 : 0;
  const growthSignal = (prospect.trueTalent.growthRate - 0.42) * 4.2;
  const workSignal = (prospect.trueTalent.workEthic - 0.5) * 2.1;
  const volatilitySwing = randomFloat(rng, -3.8, 3.2) * prospect.trueTalent.volatility;
  const roleCompetitionDrag = rng.next() < roleCompetitionDragChance(prospect) ? randomFloat(rng, 1.1, prospect.schoolYear === 2 ? 4.2 : 3.2) : 0;
  const physicalStallDrag = rng.next() < physicalStallChance(prospect) ? randomFloat(rng, 0.8, 2.8) : 0;
  const injuryDrag = rng.next() < prospect.trueTalent.injuryRisk * (prospect.schoolYear === 2 ? 0.26 : 0.2) ? randomFloat(rng, 1.5, 5.2) : 0;
  const lateBloomBonus = room >= 12 && rng.next() < prospect.trueTalent.growthRate * 0.34 ? randomFloat(rng, 0.8, 3.8) : 0;
  const classPressure = prospect.visible.publicRank <= 40 && rng.next() < 0.2 ? randomFloat(rng, 0.7, 2.6) : 0;
  return roundTo(clamp(growthSignal + workSignal + schoolBias + volatilitySwing + lateBloomBonus - roleCompetitionDrag - physicalStallDrag - injuryDrag - classPressure, -6.5, Math.min(7.2, room + 1.2)), 1);
}

function roleCompetitionDragChance(prospect: Prospect): number {
  const schoolPressure = prospect.schoolTier === "elite" ? 0.22 : prospect.schoolTier === "strong" ? 0.16 : 0.08;
  const positionCrowd = ["C", "SS", "CF", "SP"].includes(prospect.primaryPosition) ? 0.06 : 0.02;
  const earlyHype = prospect.schoolYear <= 2 && prospect.visible.publicRank <= 80 ? 0.08 : 0;
  return clamp(schoolPressure + positionCrowd + earlyHype + prospect.trueTalent.volatility * 0.08, 0.05, 0.42);
}

function physicalStallChance(prospect: Prospect): number {
  const undersizedPitcher = prospect.pitcherStats && prospect.physical.heightCm <= 180 ? 0.11 : 0;
  const lightHitter = prospect.hitterStats && prospect.physical.weightKg <= 72 ? 0.09 : 0;
  const alreadyPolished = prospect.schoolDevelopmentBias === "polished" && prospect.trueTalent.potential - prospect.trueTalent.currentAbility <= 8 ? 0.1 : 0;
  return clamp(0.08 + undersizedPitcher + lightHitter + alreadyPolished, 0.04, 0.32);
}

function determineHighSchoolIssueEvent(rng: Rng, prospect: Prospect, growth: number): HighSchoolIssueEvent {
  const injuryChance = clamp(prospect.trueTalent.injuryRisk * (growth <= -1 ? 0.22 : 0.1), 0.004, 0.22);
  if (rng.next() < injuryChance) {
    const rehabChance = clamp(prospect.trueTalent.injuryRisk * (growth <= -2 ? 0.36 : 0.12), 0.02, 0.34);
    return rng.next() < rehabChance ? { type: "long-rehab" } : { type: "injury" };
  }

  if (growth <= -4 && prospect.schoolYear <= 2 && rng.next() < 0.16) return { type: "repeat-year" };

  const transferChance =
    prospect.schoolYear <= 2 && prospect.schoolTier !== "elite"
      ? (prospect.schoolTier === "small" ? 0.065 : 0.028) + (prospect.visible.publicRank <= 140 ? 0.035 : 0)
      : 0;
  if (rng.next() < transferChance) return { type: "transfer" };

  if (prospect.schoolYear >= 2 && prospect.collegeCommitRisk >= 68 && rng.next() < 0.18) return { type: "college-risk" };
  if (prospect.schoolYear >= 2 && prospect.visible.riskTags.includes("position-uncertainty") && rng.next() < 0.1) return { type: "position-change" };
  return NO_HIGH_SCHOOL_EVENT;
}

function pickTransferSchool(rng: Rng, prospect: Prospect, schools: SchoolProfile[]): SchoolProfile | undefined {
  const sameRegion = schools.filter((school) => school.id !== prospect.schoolId && school.region === prospect.schoolRegion && school.leagueStrength >= prospect.schoolLeagueStrength + 3);
  const stronger = schools.filter((school) => school.id !== prospect.schoolId && school.leagueStrength >= prospect.schoolLeagueStrength + 8);
  const pool = sameRegion.length > 0 ? sameRegion : stronger;
  if (pool.length === 0) return undefined;
  return weightedPick(rng, pool.map((school) => ({
    value: school,
    weight: Math.max(1, school.leagueStrength - prospect.schoolLeagueStrength + (school.tier === "elite" ? 8 : school.tier === "strong" ? 4 : 1)),
  })));
}

function schoolFieldsFromProfile(school: SchoolProfile): Pick<Prospect, "schoolId" | "school" | "schoolRegion" | "schoolTier" | "schoolTraits" | "schoolDevelopmentBias" | "schoolLeagueStrength" | "schoolReportReliabilityBase"> {
  return {
    schoolId: school.id,
    school: school.name,
    schoolRegion: school.region,
    schoolTier: school.tier,
    schoolTraits: school.traits,
    schoolDevelopmentBias: school.developmentBias,
    schoolLeagueStrength: school.leagueStrength,
    schoolReportReliabilityBase: school.reportReliabilityBase,
  };
}

function determineHighSchoolGrowthEpisodes(
  rng: Rng,
  prospect: Prospect,
  growth: number,
  schoolYear: SchoolYear,
  physical: PhysicalProfile,
  issue: HighSchoolIssueEvent,
): HighSchoolGrowthEpisode[] {
  const episodes: HighSchoolGrowthEpisode[] = [];
  const heightGain = physical.heightCm - prospect.physical.heightCm;
  const weightGain = physical.weightKg - prospect.physical.weightKg;

  if (heightGain >= 3 || (schoolYear <= 2 && heightGain >= 2 && growth >= 2.2 && rng.next() < 0.45)) {
    episodes.push({ type: "height-spurt", heightGain: Math.max(2, heightGain) });
  }
  if (weightGain >= 6 || (schoolYear === 3 && weightGain >= 4 && growth >= 2.2 && rng.next() < 0.42)) {
    episodes.push({ type: "bulk-up", weightGain: Math.max(4, weightGain) });
  }

  if (issue.type === "position-change" || shouldCreateDefensivePositionEpisode(rng, prospect, growth, schoolYear)) {
    const to = pickDefensiveTransitionPosition(rng, prospect.primaryPosition, prospect.physical);
    if (to && to !== prospect.primaryPosition) episodes.push({ type: "defensive-position-change", from: prospect.primaryPosition, to });
  }

  if ((prospect.primaryPosition === "SP" || prospect.primaryPosition === "RP") && rng.next() < (schoolYear === 3 ? 0.035 : 0.02)) {
    const to = prospect.primaryPosition === "SP" && (prospect.pitcherStats?.starterChance ?? 100) <= 42 ? "RP" : prospect.primaryPosition === "RP" && growth >= 3.4 ? "SP" : undefined;
    if (to && to !== prospect.primaryPosition) episodes.push({ type: "pitching-role-change", from: prospect.primaryPosition, to });
  }

  if (prospect.playerGroup === "pitcher" && schoolYear >= 2 && rng.next() < pitcherToHitterChance(prospect, growth)) {
    episodes.push({ type: "pitcher-to-hitter", from: prospect.primaryPosition, to: pickConvertedHitterPosition(rng, prospect) });
  } else if (prospect.playerGroup !== "pitcher" && schoolYear >= 2 && rng.next() < hitterToPitcherChance(prospect, growth)) {
    episodes.push({ type: "hitter-to-pitcher", from: prospect.primaryPosition, to: pickOne(rng, ["SP", "RP"] as const) });
  }

  return episodes.slice(0, 2);
}

function shouldCreateDefensivePositionEpisode(rng: Rng, prospect: Prospect, growth: number, schoolYear: SchoolYear): boolean {
  if (prospect.playerGroup === "pitcher") return false;
  const pressure =
    prospect.visible.riskTags.includes("position-uncertainty") ? 0.12 :
    prospect.hitterStats && (prospect.hitterStats.defensiveGrade ?? 80) <= 42 ? 0.08 :
    0.025;
  const physicalMove = prospect.primaryPosition === "SS" && prospect.physical.weightKg >= 88 ? 0.08 : prospect.primaryPosition === "C" && prospect.physical.heightCm >= 188 ? 0.05 : 0;
  const yearBonus = schoolYear === 3 ? 0.02 : 0;
  return rng.next() < clamp(pressure + physicalMove + yearBonus + (growth <= -1 ? 0.035 : 0), 0, 0.22);
}

function pickDefensiveTransitionPosition(rng: Rng, position: Position, physical: PhysicalProfile): Position | undefined {
  if (position === "SS") return pickOne(rng, physical.weightKg >= 86 ? ["3B", "2B", "CF"] : ["2B", "3B", "CF"]);
  if (position === "2B") return pickOne(rng, ["SS", "3B", "CF"]);
  if (position === "3B") return pickOne(rng, ["1B", "LF", "RF"]);
  if (position === "C") return pickOne(rng, ["1B", "3B"]);
  if (position === "CF") return pickOne(rng, ["LF", "RF", "SS"]);
  if (position === "LF" || position === "RF") return pickOne(rng, ["1B", "CF", position === "LF" ? "RF" : "LF"]);
  if (position === "1B") return physical.throws === "R" ? pickOne(rng, ["3B", "LF", "RF"]) : pickOne(rng, ["LF", "RF"]);
  return undefined;
}

function pitcherToHitterChance(prospect: Prospect, growth: number): number {
  const velocityStall = (prospect.pitcherStats?.maxVelocityKph ?? 150) <= 140 ? 0.018 : 0;
  const physicalBat = prospect.physical.weightKg >= 88 || prospect.physical.heightCm >= 188 ? 0.014 : 0;
  const schoolHint = prospect.schoolDevelopmentBias === "two-way" ? 0.018 : 0;
  return clamp(0.006 + velocityStall + physicalBat + schoolHint + (growth <= -1 ? 0.012 : 0), 0, 0.055);
}

function hitterToPitcherChance(prospect: Prospect, growth: number): number {
  const armHint = prospect.physical.throws === "R" && ["SS", "3B", "CF", "RF"].includes(prospect.primaryPosition) ? 0.012 : 0;
  const physicalHint = prospect.physical.heightCm >= 185 ? 0.012 : 0;
  const schoolHint = prospect.schoolDevelopmentBias === "two-way" ? 0.02 : 0;
  return clamp(0.004 + armHint + physicalHint + schoolHint + (growth >= 3.5 ? 0.01 : 0), 0, 0.045);
}

function pickConvertedHitterPosition(rng: Rng, prospect: Prospect): Position {
  if (prospect.physical.heightCm >= 188 || prospect.physical.weightKg >= 90) return pickOne(rng, ["1B", "LF", "RF"] as const);
  if (prospect.physical.throws === "L") return pickOne(rng, ["1B", "LF", "RF"] as const);
  return pickOne(rng, ["3B", "RF", "LF", "1B"] as const);
}

function createHighSchoolPositionPlan(prospect: Prospect, episodes: HighSchoolGrowthEpisode[]): HighSchoolPositionPlan {
  const conversion = episodes.find((episode) => episode.type === "pitcher-to-hitter" || episode.type === "hitter-to-pitcher" || episode.type === "defensive-position-change" || episode.type === "pitching-role-change");
  const primaryPosition = conversion && "to" in conversion ? conversion.to : prospect.primaryPosition;
  return {
    primaryPosition,
    playerGroup: POSITION_GROUPS[primaryPosition],
  };
}

function advanceHighSchoolTalent(talent: HiddenTalentProfile, growth: number, event: HighSchoolIssueEvent = NO_HIGH_SCHOOL_EVENT): HiddenTalentProfile {
  const eventCurrentDrag = event.type === "long-rehab" ? -2.2 : event.type === "injury" ? -0.8 : event.type === "repeat-year" ? -1.3 : 0;
  const eventGrowthDrag = event.type === "long-rehab" ? 0.035 : event.type === "repeat-year" ? 0.02 : event.type === "injury" ? 0.01 : 0;
  const eventInjuryPenalty = event.type === "long-rehab" ? 0.08 : event.type === "injury" ? 0.04 : 0;
  return {
    ...talent,
    currentAbility: Math.round(clamp(talent.currentAbility + growth + eventCurrentDrag, 20, talent.potential)),
    growthRate: clamp(talent.growthRate + growth * 0.006 - eventGrowthDrag, 0.05, 0.99),
    injuryRisk: clamp(talent.injuryRisk + eventInjuryPenalty, 0.02, 0.98),
  };
}

function applyHighSchoolEpisodesToTalent(talent: HiddenTalentProfile, episodes: HighSchoolGrowthEpisode[], positionPlan: HighSchoolPositionPlan): HiddenTalentProfile {
  const heightSpurt = episodes.some((episode) => episode.type === "height-spurt");
  const bulkUp = episodes.some((episode) => episode.type === "bulk-up");
  const convertedToHitter = episodes.some((episode) => episode.type === "pitcher-to-hitter");
  const convertedToPitcher = episodes.some((episode) => episode.type === "hitter-to-pitcher");
  const currentBoost = (heightSpurt ? 0.5 : 0) + (bulkUp ? 0.8 : 0) + (convertedToHitter || convertedToPitcher ? -1.2 : 0);
  const next: HiddenTalentProfile = {
    ...talent,
    currentAbility: Math.round(clamp(talent.currentAbility + currentBoost, 20, talent.potential)),
  };

  if (positionPlan.playerGroup === "pitcher") {
    next.pitcherTools = talent.pitcherTools ?? {
      command: Math.max(30, talent.currentAbility - 2),
      stuff: talent.currentAbility,
      velocity: talent.currentAbility,
      stamina: positionPlan.primaryPosition === "SP" ? talent.currentAbility : Math.max(30, talent.currentAbility - 8),
      mentality: talent.currentAbility,
    };
    if (bulkUp || heightSpurt) {
      next.pitcherTools = {
        ...next.pitcherTools,
        velocity: clamp(next.pitcherTools.velocity + (bulkUp ? 3 : 1), 20, 90),
        stuff: clamp(next.pitcherTools.stuff + (heightSpurt ? 2 : 1), 20, 90),
        stamina: clamp(next.pitcherTools.stamina + (bulkUp ? 2 : 0), 20, 90),
      };
    }
  } else {
    next.hitterTools = talent.hitterTools ?? {
      contact: talent.currentAbility,
      discipline: talent.currentAbility,
      speed: talent.currentAbility,
      power: talent.currentAbility,
      defense: talent.currentAbility,
      mentality: talent.currentAbility,
    };
    if (bulkUp || heightSpurt) {
      next.hitterTools = {
        ...next.hitterTools,
        power: clamp(next.hitterTools.power + (bulkUp ? 4 : 1), 20, 90),
        defense: clamp(next.hitterTools.defense + (heightSpurt ? 1 : 0), 20, 90),
        speed: clamp(next.hitterTools.speed - (bulkUp ? 1 : 0), 20, 90),
      };
    }
  }

  return next;
}

function applyHighSchoolEpisodesToPhysical(physical: PhysicalProfile, episodes: HighSchoolGrowthEpisode[], position: Position): PhysicalProfile {
  const extraHeight = episodes.reduce((total, episode) => total + (episode.type === "height-spurt" ? Math.max(0, episode.heightGain - 1) : 0), 0);
  const extraWeight = episodes.reduce((total, episode) => total + (episode.type === "bulk-up" ? Math.max(0, episode.weightGain - 3) : 0), 0);
  const positionWeightCap = position === "C" || position === "1B" ? 108 : position === "SP" || position === "RP" ? 102 : 99;
  return {
    ...physical,
    heightCm: Math.min(203, physical.heightCm + extraHeight),
    weightKg: Math.min(positionWeightCap, physical.weightKg + extraWeight),
  };
}

function advanceHighSchoolPhysical(rng: Rng, physical: PhysicalProfile, position: Position, schoolYear: SchoolYear, growth: number): PhysicalProfile {
  const heightRoom = growth <= -1 ? 0 : schoolYear === 2 ? randomInt(rng, 0, 3) : schoolYear === 3 ? randomInt(rng, 0, 2) : 0;
  const weightGain = growth <= -1 ? randomInt(rng, 0, 2) : randomInt(rng, growth >= 3 ? 3 : 1, growth >= 3 ? 8 : 5);
  const positionWeightCap = position === "C" || position === "1B" ? 105 : position === "SP" || position === "RP" ? 98 : 96;
  return {
    ...physical,
    heightCm: Math.min(202, physical.heightCm + heightRoom),
    weightKg: Math.min(positionWeightCap, physical.weightKg + weightGain),
  };
}

function advanceHighSchoolHitterStats(stats: HitterStats, rng: Rng, growth: number, schoolYear: SchoolYear): HitterStats {
  const next = { ...stats };
  const playingTimeBoost = growth <= -1 ? randomInt(rng, 0, 7) : schoolYear === 3 ? randomInt(rng, 8, 18) : randomInt(rng, 5, 14);
  next.games = Math.min(36, next.games + playingTimeBoost);
  next.plateAppearances = Math.min(156, next.plateAppearances + randomInt(rng, playingTimeBoost * 2, playingTimeBoost * 4 + 16));
  const slumpNoise = growth <= -1 ? randomFloat(rng, -0.024, 0.006) : randomFloat(rng, -0.018, 0.022);
  if (next.average !== null) next.average = roundTo(clamp(next.average + growth * 0.005 + slumpNoise, 0.16, 0.48), 3);
  if (next.onBase !== null) next.onBase = roundTo(clamp(next.onBase + growth * 0.006 + slumpNoise, 0.19, 0.58), 3);
  if (next.slugging !== null) next.slugging = roundTo(clamp(next.slugging + growth * 0.01 + (growth <= -1 ? randomFloat(rng, -0.04, 0.008) : randomFloat(rng, -0.022, 0.034)), 0.24, 0.86), 3);
  if (next.ops !== null) next.ops = roundTo((next.onBase ?? 0) + (next.slugging ?? 0), 3);
  if (next.homeRuns !== null) next.homeRuns = Math.max(0, Math.min(18, next.homeRuns + randomInt(rng, growth <= -1 ? -1 : growth >= 3 ? 1 : 0, growth >= 4 ? 4 : 2)));
  if (next.doubles !== null) next.doubles = Math.max(0, Math.min(26, next.doubles + randomInt(rng, 1, growth >= 2 ? 5 : 3)));
  if (next.stolenBases !== null) next.stolenBases = Math.max(0, Math.min(34, next.stolenBases + randomInt(rng, 0, growth >= 2 ? 5 : 3)));
  if (next.strikeoutRate !== null) next.strikeoutRate = roundTo(clamp(next.strikeoutRate - growth * 0.003 + randomFloat(rng, -0.01, growth <= -1 ? 0.026 : 0.012), 0.045, 0.36), 3);
  if (next.walkRate !== null) next.walkRate = roundTo(clamp(next.walkRate + growth * 0.002 + randomFloat(rng, -0.008, 0.01), 0.02, 0.21), 3);
  if (next.defensiveGrade !== null) next.defensiveGrade = roundGrade(next.defensiveGrade + growth * 0.45 + randomFloat(rng, -2, 3));
  if (next.athleticismGrade !== null) next.athleticismGrade = roundGrade(next.athleticismGrade + growth * 0.35 + randomFloat(rng, -2, 3));
  return next;
}

function advanceHighSchoolPitcherStats(stats: PitcherStats, rng: Rng, growth: number, schoolYear: SchoolYear, physical: PhysicalProfile): PitcherStats {
  const next = { ...stats };
  next.games = Math.min(32, next.games + randomInt(rng, growth <= -1 ? 0 : schoolYear === 3 ? 5 : 3, growth <= -1 ? 5 : schoolYear === 3 ? 12 : 8));
  if (next.innings !== null) next.innings = roundTo(Math.min(98, next.innings + randomFloat(rng, growth <= -1 ? 0 : schoolYear === 3 ? 12 : 6, growth <= -1 ? 10 : schoolYear === 3 ? 28 : 18)), 1);
  const velocityGain = growth >= 4 ? randomInt(rng, 1, 3) : growth >= 2 ? randomInt(rng, 0, 2) : growth < 0 ? randomInt(rng, -2, 0) : randomInt(rng, 0, 1);
  if (next.maxVelocityKph !== null) next.maxVelocityKph = Math.round(clamp(next.maxVelocityKph + velocityGain, 124, physical.throws === "L" ? 155 : 159));
  if (next.averageVelocityKph !== null) next.averageVelocityKph = Math.round(clamp(next.averageVelocityKph + Math.max(-1, velocityGain - 1), 120, 153));
  if (next.era !== null) next.era = roundTo(clamp(next.era - growth * 0.08 + randomFloat(rng, growth <= -1 ? -0.02 : -0.12, growth <= -1 ? 0.36 : 0.18), 0.35, 7.2), 2);
  if (next.strikeoutsPerNine !== null) next.strikeoutsPerNine = roundTo(clamp(next.strikeoutsPerNine + growth * 0.1 + randomFloat(rng, growth <= -1 ? -0.55 : -0.25, 0.35), 2.8, 17.4), 1);
  if (next.walksPerNine !== null) next.walksPerNine = roundTo(clamp(next.walksPerNine - growth * 0.06 + randomFloat(rng, -0.16, growth <= -1 ? 0.34 : 0.18), 0.9, 8.4), 1);
  if (next.whip !== null) next.whip = roundTo(clamp(next.whip - growth * 0.012 + randomFloat(rng, -0.035, 0.045), 0.68, 2.05), 2);
  if (next.commandGrade !== null) next.commandGrade = roundGrade(next.commandGrade + growth * 0.5 + randomFloat(rng, -2, 3));
  if (next.starterChance !== null) next.starterChance = Math.round(clamp(next.starterChance + growth * 1.2 + randomFloat(rng, -4, 5), 2, 98));
  return next;
}

function createSeasonFormCycle(
  rng: Rng,
  kind: SeasonFormCycle["kind"],
  talent: HiddenTalentProfile,
  tier: ProspectDataTier,
  highSchoolSpecial: boolean,
  hitterStats?: HitterStats,
  pitcherStats?: PitcherStats,
): SeasonFormCycle {
  const staminaBase = kind === "pitcher"
    ? talent.pitcherTools?.stamina ?? 50
    : (talent.hitterTools?.mentality ?? 50) * 0.45 + (talent.hitterTools?.speed ?? 50) * 0.2 + (talent.workEthic * 100) * 0.35;
  const volatility = talent.volatility;
  const pattern = pickSeasonCyclePattern(rng, staminaBase, volatility, highSchoolSpecial);
  const reliability = cycleReliability(tier, highSchoolSpecial);
  const base = clamp(48 + (talent.currentAbility - 50) * 0.16 + randomFloat(rng, -4, 4), 38, 66);
  const points = createCyclePoints(rng, pattern, base, staminaBase, volatility);
  const staminaSignal = Math.round(clamp(staminaBase + (pattern === "stamina-fade" ? -12 : pattern === "late-surge" ? 7 : 0), 20, 95));
  const clutchSignal = Math.round(clamp(
    48 +
    (points[6].value + points[7].value - points[0].value - points[1].value) * 0.6 +
    (talent.workEthic - 0.5) * 22 +
    randomFloat(rng, -8, 8),
    20,
    90,
  ));
  return {
    kind,
    pattern,
    points,
    reliability,
    staminaSignal,
    clutchSignal,
    report: seasonCycleReport(kind, pattern, points, reliability, hitterStats, pitcherStats),
  };
}

function advanceSeasonFormCycle(rng: Rng, cycle: SeasonFormCycle, growth: number, schoolYear: SchoolYear): SeasonFormCycle {
  const lateBonus = growth >= 3 ? 2.2 : growth <= -2 ? -2.8 : randomFloat(rng, -1.2, 1.4);
  const reliabilityGain = schoolYear === 3 ? 0.1 : 0.06;
  const points = cycle.points.map((point, index) => {
    const lateSeason = index >= 5;
    const adjustment = randomFloat(rng, -2.2, 2.2) + (lateSeason ? lateBonus : growth * 0.25);
    return { ...point, value: Math.round(clamp(point.value + adjustment, 25, 85)) };
  });
  const next: SeasonFormCycle = {
    ...cycle,
    points,
    reliability: roundTo(clamp(cycle.reliability + reliabilityGain + growth * 0.01, 0.18, 0.96), 2),
    staminaSignal: Math.round(clamp(cycle.staminaSignal + growth * 0.9 + randomFloat(rng, -3, 3), 20, 95)),
    clutchSignal: Math.round(clamp(cycle.clutchSignal + lateBonus + randomFloat(rng, -3, 3), 20, 95)),
  };
  return {
    ...next,
    report: seasonCycleReport(next.kind, next.pattern, next.points, next.reliability),
  };
}

function pickSeasonCyclePattern(rng: Rng, staminaBase: number, volatility: number, highSchoolSpecial: boolean): SeasonFormCycle["pattern"] {
  const entries: Array<{ value: SeasonFormCycle["pattern"]; weight: number }> = [
    { value: "steady", weight: 20 + Math.max(0, staminaBase - 55) * 0.4 + (highSchoolSpecial ? 8 : 0) },
    { value: "early-peak", weight: 13 },
    { value: "summer-slump", weight: 14 + Math.max(0, 54 - staminaBase) * 0.6 },
    { value: "late-surge", weight: 12 + Math.max(0, staminaBase - 58) * 0.35 },
    { value: "volatile", weight: 8 + volatility * 24 },
    { value: "stamina-fade", weight: 8 + Math.max(0, 52 - staminaBase) * 0.7 },
    { value: "rebound", weight: 10 },
  ];
  return weightedPick(rng, entries);
}

function cycleReliability(tier: ProspectDataTier, highSchoolSpecial: boolean): number {
  const base =
    tier === "top-40" ? 0.82 :
    tier === "rank-41-100" ? 0.72 :
    tier === "rank-101-180" ? 0.58 :
    tier === "rank-181-260" ? 0.44 :
    0.32;
  return roundTo(clamp(base + (highSchoolSpecial ? 0.08 : 0), 0.2, 0.94), 2);
}

function createCyclePoints(rng: Rng, pattern: SeasonFormCycle["pattern"], base: number, staminaBase: number, volatility: number): MonthlyFormPoint[] {
  const months: MonthlyFormPoint["month"][] = [3, 4, 5, 6, 7, 8, 9, 10];
  const shapes: Record<SeasonFormCycle["pattern"], number[]> = {
    steady: [0, 1, 1, 0, -1, 0, 1, 0],
    "early-peak": [7, 8, 5, 1, -2, -4, -2, -1],
    "summer-slump": [2, 4, 3, -1, -8, -10, -4, 0],
    "late-surge": [-4, -2, 0, 2, 3, 5, 8, 9],
    volatile: [6, -5, 7, -6, 4, -7, 6, -2],
    "stamina-fade": [4, 5, 3, 1, -3, -7, -10, -12],
    rebound: [-6, -7, -3, 1, 4, 3, 6, 5],
  };
  const staminaAdjustment = staminaBase >= 62 ? [0, 0, 0, 0, 1, 2, 3, 3] : staminaBase <= 45 ? [1, 1, 0, -1, -2, -4, -5, -5] : [0, 0, 0, 0, 0, 0, 0, 0];
  return months.map((month, index) => ({
    month,
    value: Math.round(clamp(base + shapes[pattern][index] + staminaAdjustment[index] + randomFloat(rng, -3 - volatility * 4, 3 + volatility * 4), 25, 85)),
  }));
}

function seasonCycleReport(kind: SeasonFormCycle["kind"], pattern: SeasonFormCycle["pattern"], points: MonthlyFormPoint[], reliability: number, hitterStats?: HitterStats, pitcherStats?: PitcherStats): string {
  const label = kind === "pitcher" ? "투구" : "타격";
  const highMonth = [...points].sort((left, right) => right.value - left.value)[0]?.month;
  const lowMonth = [...points].sort((left, right) => left.value - right.value)[0]?.month;
  const reliabilityText = reliability >= 0.72 ? "관찰 표본 신뢰도는 높은 편입니다." : reliability >= 0.5 ? "표본은 보통 수준이라 해석에 여지가 있습니다." : "표본이 제한적이라 추정치에 가깝습니다.";
  const context = hitterStats?.ops !== null && hitterStats?.ops !== undefined
    ? "고교 타격 지표와 함께 보면 월별 기복을 따로 확인할 필요가 있습니다."
    : pitcherStats?.innings !== null && pitcherStats?.innings !== undefined
      ? "이닝 소화와 구위 유지 여부를 함께 봐야 합니다."
      : "공개 기록이 제한적이라 사이클 자체가 중요한 관찰 포인트입니다.";
  const patternText: Record<SeasonFormCycle["pattern"], string> = {
    steady: `시즌 내내 ${label} 흐름이 비교적 안정적인 타입입니다.`,
    "early-peak": `초반 강세가 먼저 보이고 후반으로 갈수록 유지력이 관찰 포인트입니다.`,
    "summer-slump": `7~8월 구간에서 ${label} 흐름이 꺾이는 패턴이 있습니다.`,
    "late-surge": `시즌 후반으로 갈수록 ${label} 컨디션이 올라오는 타입입니다.`,
    volatile: `월별 편차가 커서 장기 시즌 운용 변동성이 있습니다.`,
    "stamina-fade": `후반 체력 저하 신호가 있어 가을 경기력은 별도 확인이 필요합니다.`,
    rebound: `초반 적응 뒤 반등하는 흐름이 반복되는 타입입니다.`,
  };
  return `${patternText[pattern]} 강세 구간은 ${highMonth}월, 약세 구간은 ${lowMonth}월로 관찰됩니다. ${reliabilityText} ${context}`;
}

function advanceHighSchoolVisibleReport(report: VisibleScoutingReport, rng: Rng, growth: number, schoolYear: SchoolYear): VisibleScoutingReport {
  const rankMove = Math.round(growth <= -1 ? randomFloat(rng, 8, 26) : growth >= 4 ? randomFloat(rng, -34, -12) : growth >= 2 ? randomFloat(rng, -18, -4) : randomFloat(rng, -5, 9));
  const publicRank = Math.round(clamp(report.publicRank + rankMove, 1, 400));
  const confidenceGain = schoolYear === 3 ? 0.14 : 0.08;
  const trend = growth >= 3 ? "rising" : growth <= -1 ? "falling" : "steady";
  const riskTags = [...report.riskTags];
  const addRisk = (tag: ProspectRiskTag) => {
    if (!riskTags.includes(tag)) riskTags.push(tag);
  };
  if (growth <= -2) addRisk("low-record-trust");
  if (growth <= -3) addRisk("late-bloomer");
  return {
    ...report,
    publicRank,
    confidence: clamp(report.confidence + confidenceGain + growth * 0.008, 0.18, 0.97),
    trend,
    expectedOverallRange: {
      min: Math.round(clamp(report.expectedOverallRange.min + growth * 0.7, 20, 80)),
      max: Math.round(clamp(report.expectedOverallRange.max + growth * 0.9, 20, 80)),
    },
    riskTags,
    summary: `${schoolYear}학년 진급 후 공개 평가가 ${trend === "rising" ? "상승" : trend === "falling" ? "하락" : "유지"} 흐름이다. ${report.summary}`,
  };
}

function applyHighSchoolEventToHitterStats(stats: HitterStats, event: HighSchoolIssueEvent): HitterStats {
  if (event.type === "none" || event.type === "college-risk" || event.type === "transfer" || event.type === "position-change") return stats;
  const missedRate = event.type === "long-rehab" ? 0.46 : event.type === "repeat-year" ? 0.34 : 0.18;
  const next = { ...stats };
  next.games = Math.max(2, Math.round(next.games * (1 - missedRate)));
  next.plateAppearances = Math.max(6, Math.round(next.plateAppearances * (1 - missedRate)));
  if (next.average !== null) next.average = roundTo(clamp(next.average - (event.type === "long-rehab" ? 0.018 : 0.008), 0.15, 0.48), 3);
  if (next.onBase !== null) next.onBase = roundTo(clamp(next.onBase - (event.type === "long-rehab" ? 0.018 : 0.008), 0.18, 0.58), 3);
  if (next.slugging !== null) next.slugging = roundTo(clamp(next.slugging - (event.type === "long-rehab" ? 0.04 : 0.016), 0.22, 0.86), 3);
  if (next.ops !== null) next.ops = roundTo((next.onBase ?? 0) + (next.slugging ?? 0), 3);
  if (next.homeRuns !== null) next.homeRuns = Math.max(0, Math.round(next.homeRuns * (1 - missedRate * 0.72)));
  if (next.doubles !== null) next.doubles = Math.max(0, Math.round(next.doubles * (1 - missedRate * 0.7)));
  if (next.stolenBases !== null) next.stolenBases = Math.max(0, Math.round(next.stolenBases * (1 - missedRate * 0.82)));
  if (next.athleticismGrade !== null && event.type === "long-rehab") next.athleticismGrade = roundGrade(next.athleticismGrade - 4);
  return next;
}

function applyHighSchoolEventToPitcherStats(stats: PitcherStats, event: HighSchoolIssueEvent): PitcherStats {
  if (event.type === "none" || event.type === "college-risk" || event.type === "transfer" || event.type === "position-change") return stats;
  const missedRate = event.type === "long-rehab" ? 0.58 : event.type === "repeat-year" ? 0.42 : 0.24;
  const next = { ...stats };
  next.games = Math.max(1, Math.round(next.games * (1 - missedRate)));
  if (next.innings !== null) next.innings = roundTo(Math.max(1, next.innings * (1 - missedRate)), 1);
  if (next.maxVelocityKph !== null) next.maxVelocityKph = Math.round(clamp(next.maxVelocityKph - (event.type === "long-rehab" ? 2 : 1), 120, 159));
  if (next.averageVelocityKph !== null) next.averageVelocityKph = Math.round(clamp(next.averageVelocityKph - (event.type === "long-rehab" ? 2 : 1), 118, 153));
  if (next.era !== null) next.era = roundTo(clamp(next.era + (event.type === "long-rehab" ? 0.38 : 0.16), 0.35, 7.8), 2);
  if (next.walksPerNine !== null) next.walksPerNine = roundTo(clamp(next.walksPerNine + (event.type === "long-rehab" ? 0.38 : 0.16), 0.8, 8.8), 1);
  if (next.commandGrade !== null && event.type === "long-rehab") next.commandGrade = roundGrade(next.commandGrade - 3);
  if (next.starterChance !== null) next.starterChance = Math.round(clamp(next.starterChance - (event.type === "long-rehab" ? 9 : 4), 1, 98));
  return next;
}

function createConvertedHitterStats(rng: Rng, talent: HiddenTalentProfile, tier: ProspectDataTier, position: Position, leagueLevel: LeagueLevel): HitterStats {
  const next = createHitterStats(rng, talent, tier, position, leagueLevel);
  next.games = Math.max(8, Math.round(next.games * 0.58));
  next.plateAppearances = Math.max(24, Math.round(next.plateAppearances * 0.54));
  if (next.average !== null) next.average = roundTo(clamp(next.average - 0.025, 0.16, 0.42), 3);
  if (next.onBase !== null) next.onBase = roundTo(clamp(next.onBase - 0.02, 0.18, 0.52), 3);
  if (next.slugging !== null) next.slugging = roundTo(clamp(next.slugging + 0.015, 0.25, 0.78), 3);
  if (next.ops !== null) next.ops = roundTo((next.onBase ?? 0) + (next.slugging ?? 0), 3);
  if (next.strikeoutRate !== null) next.strikeoutRate = roundTo(clamp(next.strikeoutRate + 0.035, 0.08, 0.38), 3);
  return next;
}

function createConvertedPitcherStats(rng: Rng, talent: HiddenTalentProfile, tier: ProspectDataTier, position: Position, leagueLevel: LeagueLevel, physical: PhysicalProfile): PitcherStats {
  const next = createPitcherStats(rng, talent, tier, position, leagueLevel, physical);
  next.games = Math.max(5, Math.round(next.games * 0.62));
  if (next.innings !== null) next.innings = roundTo(Math.max(10, next.innings * 0.52), 1);
  if (next.era !== null) next.era = roundTo(clamp(next.era + 0.45, 1.2, 7.8), 2);
  if (next.walksPerNine !== null) next.walksPerNine = roundTo(clamp(next.walksPerNine + 0.65, 1.4, 8.8), 1);
  if (next.commandGrade !== null) next.commandGrade = roundGrade(next.commandGrade - 6);
  if (next.starterChance !== null && position === "SP") next.starterChance = Math.round(clamp(next.starterChance - 14, 5, 84));
  return next;
}

function applyHighSchoolEpisodesToHitterStats(stats: HitterStats, episodes: HighSchoolGrowthEpisode[]): HitterStats {
  if (episodes.length === 0) return stats;
  const next = { ...stats };
  const heightSpurt = episodes.some((episode) => episode.type === "height-spurt");
  const bulkUp = episodes.some((episode) => episode.type === "bulk-up");
  const positionChange = episodes.some((episode) => episode.type === "defensive-position-change" || episode.type === "pitcher-to-hitter");
  if (bulkUp) {
    if (next.slugging !== null) next.slugging = roundTo(clamp(next.slugging + 0.035, 0.24, 0.88), 3);
    if (next.homeRuns !== null) next.homeRuns = Math.min(20, next.homeRuns + 2);
    if (next.strikeoutRate !== null) next.strikeoutRate = roundTo(clamp(next.strikeoutRate + 0.01, 0.05, 0.38), 3);
  }
  if (heightSpurt) {
    if (next.doubles !== null) next.doubles = Math.min(28, next.doubles + 2);
    if (next.defensiveGrade !== null) next.defensiveGrade = roundGrade(next.defensiveGrade + 2);
  }
  if (positionChange) {
    if (next.defensiveGrade !== null) next.defensiveGrade = roundGrade(next.defensiveGrade - 3);
    if (next.positionalValue !== null) next.positionalValue = Math.max(1, next.positionalValue - 1);
  }
  if (next.ops !== null) next.ops = roundTo((next.onBase ?? 0) + (next.slugging ?? 0), 3);
  return next;
}

function applyHighSchoolEpisodesToPitcherStats(stats: PitcherStats, episodes: HighSchoolGrowthEpisode[]): PitcherStats {
  if (episodes.length === 0) return stats;
  const next = { ...stats };
  const heightSpurt = episodes.some((episode) => episode.type === "height-spurt");
  const bulkUp = episodes.some((episode) => episode.type === "bulk-up");
  const roleChange = episodes.some((episode) => episode.type === "pitching-role-change" || episode.type === "hitter-to-pitcher");
  if (bulkUp) {
    if (next.maxVelocityKph !== null) next.maxVelocityKph = Math.round(clamp(next.maxVelocityKph + 2, 124, next.armSlot === "submarine" ? 151 : next.armSlot === "sidearm" ? 153 : 159));
    if (next.averageVelocityKph !== null) next.averageVelocityKph = Math.round(clamp(next.averageVelocityKph + 1, 120, 154));
  }
  if (heightSpurt) {
    if (next.strikeoutsPerNine !== null) next.strikeoutsPerNine = roundTo(clamp(next.strikeoutsPerNine + 0.35, 2.8, 17.8), 1);
    if (next.commandGrade !== null) next.commandGrade = roundGrade(next.commandGrade - 1);
  }
  if (roleChange) {
    if (next.starterChance !== null) next.starterChance = Math.round(clamp(next.starterChance + (episodes.some((episode) => episode.type === "pitching-role-change" && episode.to === "SP") ? 10 : -8), 1, 98));
  }
  return next;
}

function applyHighSchoolEventToVisible(report: VisibleScoutingReport, event: HighSchoolIssueEvent, nextSchool?: SchoolProfile): VisibleScoutingReport {
  if (event.type === "none") return report;
  const riskTags = [...report.riskTags];
  const addRisk = (tag: ProspectRiskTag) => {
    if (!riskTags.includes(tag)) riskTags.push(tag);
  };
  let rankPenalty = 0;
  let confidenceShift = 0;
  let summaryPrefix = "";

  if (event.type === "injury") {
    addRisk("injury-history");
    rankPenalty = 10;
    confidenceShift = -0.04;
    summaryPrefix = "부상으로 출전 관리가 필요했다.";
  } else if (event.type === "long-rehab") {
    addRisk("injury-history");
    addRisk("low-record-trust");
    rankPenalty = 28;
    confidenceShift = -0.1;
    summaryPrefix = "장기 재활로 표본이 크게 줄었다.";
  } else if (event.type === "repeat-year") {
    addRisk("injury-history");
    addRisk("low-record-trust");
    rankPenalty = 36;
    confidenceShift = -0.12;
    summaryPrefix = "부상 유급으로 드래프트 예정 시점이 밀렸다.";
  } else if (event.type === "transfer") {
    rankPenalty = nextSchool && nextSchool.leagueStrength >= 70 ? -7 : 4;
    confidenceShift = nextSchool && nextSchool.reportReliabilityBase >= 0.7 ? 0.04 : -0.02;
    summaryPrefix = nextSchool ? `${nextSchool.name} 전학으로 리그와 출전 환경이 바뀌었다.` : "전학 변수로 평가 환경이 바뀌었다.";
  } else if (event.type === "college-risk") {
    addRisk("signability");
    rankPenalty = 12;
    confidenceShift = -0.03;
    summaryPrefix = "대학 진학 의사가 강해져 지명 순위에 변수가 생겼다.";
  } else if (event.type === "position-change") {
    addRisk("position-uncertainty");
    rankPenalty = 8;
    confidenceShift = -0.02;
    summaryPrefix = "포지션 전환 가능성이 실제 검토 단계에 들어갔다.";
  }

  return {
    ...report,
    publicRank: Math.round(clamp(report.publicRank + rankPenalty, 1, 400)),
    confidence: clamp(report.confidence + confidenceShift, 0.12, 0.97),
    trend: rankPenalty >= 10 ? "falling" : report.trend,
    riskLevel: rankPenalty >= 28 && report.riskLevel !== "extreme" ? "high" : report.riskLevel,
    riskTags,
    summary: `${summaryPrefix} ${report.summary}`,
  };
}

function applyHighSchoolEpisodesToVisible(report: VisibleScoutingReport, episodes: HighSchoolGrowthEpisode[]): VisibleScoutingReport {
  if (episodes.length === 0) return report;
  const riskTags = [...report.riskTags];
  const addRisk = (tag: ProspectRiskTag) => {
    if (!riskTags.includes(tag)) riskTags.push(tag);
  };
  const summaries: string[] = [];
  let rankMove = 0;
  let confidenceShift = 0;

  for (const episode of episodes) {
    if (episode.type === "height-spurt") {
      summaries.push(`키가 ${episode.heightGain}cm가량 자라며 타점과 수비 반경 재평가가 붙었다.`);
      rankMove -= 5;
      confidenceShift += 0.02;
    } else if (episode.type === "bulk-up") {
      summaries.push(`벌크업 이후 타구 질 또는 구속 지표가 올라왔다는 현장 보고가 붙었다.`);
      rankMove -= 7;
      confidenceShift += 0.025;
    } else if (episode.type === "defensive-position-change") {
      summaries.push(`${positionName(episode.from)}에서 ${positionName(episode.to)} 쪽으로 수비 위치를 옮기며 포지션 가치 평가가 다시 열렸다.`);
      addRisk("position-uncertainty");
      rankMove += 5;
      confidenceShift -= 0.03;
    } else if (episode.type === "pitching-role-change") {
      summaries.push(`${positionName(episode.from)}에서 ${positionName(episode.to)} 역할로 재분류됐다.`);
      rankMove += episode.to === "SP" ? -6 : 4;
      confidenceShift += episode.to === "SP" ? 0.02 : -0.01;
    } else if (episode.type === "pitcher-to-hitter") {
      summaries.push(`투수에서 야수로 전향했다. 타격 툴은 흥미롭지만 표본과 수비 위치 확인이 필요하다.`);
      addRisk("position-uncertainty");
      addRisk("small-sample");
      rankMove += 12;
      confidenceShift -= 0.08;
    } else if (episode.type === "hitter-to-pitcher") {
      summaries.push(`야수에서 투수로 전향했다. 팔 재능은 보이지만 제구와 이닝 소화는 새 평가 영역이다.`);
      addRisk("position-uncertainty");
      addRisk("small-sample");
      addRisk("command");
      rankMove += 14;
      confidenceShift -= 0.08;
    }
  }

  return {
    ...report,
    publicRank: Math.round(clamp(report.publicRank + rankMove, 1, 400)),
    confidence: clamp(report.confidence + confidenceShift, 0.12, 0.98),
    trend: rankMove <= -5 ? "rising" : rankMove >= 8 ? "falling" : report.trend,
    riskTags,
    summary: `${summaries.join(" ")} ${report.summary}`,
  };
}

function createHighSchoolEpisodeLogs(prospect: Prospect, schoolYear: SchoolYear, year: number, episodes: HighSchoolGrowthEpisode[]): HighSchoolCareerLogEntry[] {
  return episodes.map((episode): HighSchoolCareerLogEntry => {
    if (episode.type === "height-spurt") {
      return {
        year,
        schoolYear,
        type: "physical",
        headline: `${prospect.name}, 신장 급성장`,
        body: `1년 사이 키가 ${episode.heightGain}cm가량 자라며 릴리스 높이, 타격 타점, 수비 반경에 대한 평가가 다시 붙었다.`,
        importance: 3,
      };
    }
    if (episode.type === "bulk-up") {
      return {
        year,
        schoolYear,
        type: "physical",
        headline: `${prospect.name}, 벌크업 성공`,
        body: `체중이 ${episode.weightGain}kg가량 늘었고 파워와 구속 쪽 지표가 함께 움직였다. 단, 민첩성 유지 여부는 계속 확인해야 한다.`,
        importance: 3,
      };
    }
    if (episode.type === "defensive-position-change") {
      return {
        year,
        schoolYear,
        type: "position-change",
        headline: `${prospect.name}, ${positionName(episode.from)}에서 ${positionName(episode.to)}로 이동`,
        body: "체형 변화와 팀 사정이 겹치며 수비 위치가 바뀌었다. 새 포지션에서 수비 부담과 타격 가치의 균형을 다시 봐야 한다.",
        importance: 4,
      };
    }
    if (episode.type === "pitching-role-change") {
      return {
        year,
        schoolYear,
        type: "position-change",
        headline: `${prospect.name}, ${positionName(episode.to)} 역할 재분류`,
        body: episode.to === "SP"
          ? "이닝 소화와 구종 구성이 좋아지며 선발 가능성을 다시 테스트받기 시작했다."
          : "선발 경쟁보다 짧은 이닝에서 구위를 살리는 방향으로 평가가 옮겨갔다.",
        importance: 3,
      };
    }
    if (episode.type === "pitcher-to-hitter") {
      return {
        year,
        schoolYear,
        type: "position-change",
        headline: `${prospect.name}, 투수에서 야수로 전향`,
        body: `${positionName(episode.to)}로 방향을 바꾸며 타격 재능을 본격적으로 평가받기 시작했다. 전향 초기라 표본 신뢰도는 낮다.`,
        importance: 5,
      };
    }
    return {
      year,
      schoolYear,
      type: "position-change",
      headline: `${prospect.name}, 야수에서 투수로 전향`,
      body: `${positionName(episode.to)}로 마운드 테스트를 시작했다. 팔 재능은 흥미롭지만 투구 완성도는 아직 넓은 오차범위에 있다.`,
      importance: 5,
    };
  });
}

function createHighSchoolActualEventLogs(
  prospect: Prospect,
  schoolYear: SchoolYear,
  year: number,
  event: HighSchoolIssueEvent,
  nextSchool?: SchoolProfile,
): HighSchoolCareerLogEntry[] {
  if (event.type === "none") return [];
  if (event.type === "injury") {
    return [{
      year,
      schoolYear,
      type: "injury",
      headline: `${prospect.name}, 부상으로 출전 관리`,
      body: "결장 기간이 생겼고 남은 시즌은 컨디션 관리와 복귀 후 움직임 확인이 핵심 관찰 포인트가 됐다.",
      importance: 3,
    }];
  }
  if (event.type === "long-rehab") {
    return [{
      year,
      schoolYear,
      type: "long-rehab",
      headline: `${prospect.name}, 장기 재활 돌입`,
      body: "재활 기간이 길어지면서 기록 표본과 현재 평가가 크게 흔들렸다. 잠재력은 남아 있지만 지명 리스크가 분명해졌다.",
      importance: 5,
    }];
  }
  if (event.type === "repeat-year") {
    return [{
      year,
      schoolYear,
      type: "repeat-year",
      headline: `${prospect.name}, 부상 유급으로 드래프트 연도 조정`,
      body: `${prospect.draftEligibleYear}년 드래프트 대상에서 한 해 밀렸다. 다음 시즌 회복 여부에 따라 평가가 다시 갈릴 수 있다.`,
      importance: 5,
    }];
  }
  if (event.type === "transfer") {
    return [{
      year,
      schoolYear,
      type: "transfer",
      headline: `${prospect.name}, ${nextSchool ? `${nextSchool.name} 전학` : "전학 확정"}`,
      body: nextSchool
        ? `${prospect.school}에서 ${nextSchool.name}로 학교를 옮겼다. 리그 수준과 출전 경쟁이 함께 바뀌어 이전 기록 해석에 보정이 필요하다.`
        : "학교를 옮기며 출전 환경이 바뀌었다. 이전 기록과 새 리그 기록을 분리해서 봐야 한다.",
      importance: 4,
    }];
  }
  if (event.type === "college-risk") {
    return [{
      year,
      schoolYear,
      type: "college-risk",
      headline: `${prospect.name}, 대학 진학 변수 확대`,
      body: "프로 지명 의사보다 진학 가능성이 더 강하게 관측됐다. 순번 계산에서는 계약 가능성을 함께 봐야 한다.",
      importance: 4,
    }];
  }
  return [{
    year,
    schoolYear,
    type: "position-change",
    headline: `${prospect.name}, 포지션 전환 검토`,
    body: "현재 포지션 유지보다 다른 수비 위치에서 가치가 살아날 수 있다는 현장 의견이 늘었다.",
    importance: 3,
  }];
}

function createHighSchoolPromotionLogs(prospect: Prospect, schoolYear: SchoolYear, year: number, growth: number, physical: PhysicalProfile, pitcherStats?: PitcherStats): HighSchoolCareerLogEntry[] {
  const logs: HighSchoolCareerLogEntry[] = [];
  const growthType = growth >= 4 ? "growth" : growth <= -1 ? "decline" : growth < 1 ? "stall" : "growth";
  logs.push({
    year,
    schoolYear,
    type: growthType,
    headline: growth >= 4 ? `${prospect.name}, ${schoolYear}학년 진급 후 평가 상승` : growth <= -1 ? `${prospect.name}, 진급 후 평가 보류` : `${prospect.name}, ${schoolYear}학년 관찰 지속`,
    body: growth >= 4
      ? "출전 비중이 늘면서 신체와 경기 감각이 함께 올라왔다는 평가가 붙었다."
      : growth <= -1
        ? "기대만큼 역할이 커지지 않았고 공개 평가도 보수적으로 조정됐다."
        : "성장 곡선은 유지되고 있지만 아직 순위를 크게 움직일 만한 표본은 부족하다.",
    importance: growth >= 4 ? 4 : growth <= -1 ? 3 : 2,
  });
  if (physical.heightCm > prospect.physical.heightCm || physical.weightKg - prospect.physical.weightKg >= 5) {
    logs.push({
      year,
      schoolYear,
      type: "physical",
      headline: `${prospect.name}, 신체 변화 확인`,
      body: `${prospect.physical.heightCm}cm/${prospect.physical.weightKg}kg에서 ${physical.heightCm}cm/${physical.weightKg}kg로 변화했다. 체격 변화가 포지션 평가에 반영될 수 있다.`,
      importance: 2,
    });
  }
  if (pitcherStats?.maxVelocityKph && prospect.pitcherStats?.maxVelocityKph && pitcherStats.maxVelocityKph - prospect.pitcherStats.maxVelocityKph >= 2) {
    logs.push({
      year,
      schoolYear,
      type: "velocity",
      headline: `${prospect.name}, 최고 구속 상승`,
      body: `최고 구속이 ${prospect.pitcherStats.maxVelocityKph}km/h에서 ${pitcherStats.maxVelocityKph}km/h로 올라왔다. 아직 제구와 이닝 소화는 별도 확인이 필요하다.`,
      importance: 3,
    });
  }
  if (growth > -3) logs.push(...createHighSchoolIssuePrepLogs(prospect, schoolYear, year, growth));
  return logs;
}

function createHighSchoolIssuePrepLogs(prospect: Prospect, schoolYear: SchoolYear, year: number, growth: number): HighSchoolCareerLogEntry[] {
  const logs: HighSchoolCareerLogEntry[] = [];
  const injurySignal = prospect.trueTalent.injuryRisk >= 0.62 && growth <= 0;
  if (injurySignal) {
    logs.push({
      year,
      schoolYear,
      type: prospect.trueTalent.injuryRisk >= 0.78 && growth <= -2 ? "long-rehab" : "injury",
      headline: prospect.trueTalent.injuryRisk >= 0.78 && growth <= -2 ? `${prospect.name}, 재활 변수 관찰` : `${prospect.name}, 컨디션 관리 필요`,
      body: prospect.trueTalent.injuryRisk >= 0.78 && growth <= -2
        ? "부상 이력과 성장 정체가 겹치며 장기 재활 가능성을 확인해야 하는 선수로 분류됐다."
        : "큰 결장으로 확정된 것은 아니지만 등판/출전 간격 관리가 필요하다는 리포트가 붙었다.",
      importance: prospect.trueTalent.injuryRisk >= 0.78 && growth <= -2 ? 4 : 3,
    });
  }
  if (prospect.schoolTier === "small" && prospect.visible.publicRank <= 120 && schoolYear <= 2) {
    logs.push({
      year,
      schoolYear,
      type: "transfer",
      headline: `${prospect.name}, 전학 가능성 관찰`,
      body: "더 강한 리그와 출전 기회를 찾아 학교를 옮길 수 있다는 스카우트 메모가 붙었다. 실제 전학 여부는 다음 시즌 확인 대상이다.",
      importance: 2,
    });
  }
  if (prospect.collegeCommitRisk >= 68 && schoolYear >= 2) {
    logs.push({
      year,
      schoolYear,
      type: "college-risk",
      headline: `${prospect.name}, 진학 변수 확대`,
      body: "프로 지명 가능성은 있지만 대학 진학 의사가 평가와 지명 순위에 변수로 남아 있다.",
      importance: 3,
    });
  }
  if (growth <= -4 && prospect.schoolYear <= 2) {
    logs.push({
      year,
      schoolYear,
      type: "repeat-year",
      headline: `${prospect.name}, 유급 가능성 체크`,
      body: "부상 또는 출전 공백이 길어질 경우 드래프트 예정 시점이 밀릴 가능성을 확인해야 한다. 아직 확정 이벤트는 아니다.",
      importance: 3,
    });
  }
  return logs;
}

function createHighSchoolSnapshot(prospect: Pick<Prospect, "schoolYear" | "visible" | "physical" | "hitterStats" | "pitcherStats">, year: number, note: string): HighSchoolYearSnapshot {
  return {
    year,
    schoolYear: prospect.schoolYear,
    publicRank: prospect.visible.publicRank,
    scoutGrade: prospect.visible.scoutGrade,
    confidence: prospect.visible.confidence,
    heightCm: prospect.physical.heightCm,
    weightKg: prospect.physical.weightKg,
    primaryStat: highSchoolPrimaryStat(prospect),
    note,
    hitterStats: prospect.hitterStats,
    pitcherStats: prospect.pitcherStats,
  };
}

function createInitialHighSchoolLog(prospect: Prospect, year: number): HighSchoolCareerLogEntry {
  const body = prospect.schoolYear === 1
    ? "주전 출전보다 관찰 리포트 중심으로 이름이 올라온 단계다. 표본이 작아 평가 변동 폭이 크다."
    : prospect.schoolYear === 2
      ? "2학년 단계에서 스카우트 관찰망에 들어왔다. 내년 역할 확대 여부가 중요하다."
      : "올해 드래프트 대상자로 주요 기록과 리포트가 정리됐다.";
  return {
    year,
    schoolYear: prospect.schoolYear,
    type: "role",
    headline: `${prospect.name}, ${prospect.schoolYear}학년 관찰 시작`,
    body,
    importance: prospect.schoolYear === 3 ? 3 : 2,
  };
}

function createInitialHighSchoolHistory(prospect: Prospect, year: number): { snapshots: HighSchoolYearSnapshot[]; logs: HighSchoolCareerLogEntry[] } {
  const snapshots: HighSchoolYearSnapshot[] = [];
  const logs: HighSchoolCareerLogEntry[] = [];
  for (let schoolYear = 1; schoolYear <= prospect.schoolYear; schoolYear += 1) {
    const typedSchoolYear = schoolYear as SchoolYear;
    const snapshotYear = year - (prospect.schoolYear - typedSchoolYear);
    const isCurrentYear = typedSchoolYear === prospect.schoolYear;
    snapshots.push(isCurrentYear
      ? createHighSchoolSnapshot(prospect, snapshotYear, initialHighSchoolSnapshotNote(prospect))
      : createRetroHighSchoolSnapshot(prospect, snapshotYear, typedSchoolYear));
    logs.push(isCurrentYear
      ? createInitialHighSchoolLog(prospect, snapshotYear)
      : createRetroHighSchoolLog(prospect, snapshotYear, typedSchoolYear));
  }
  return { snapshots, logs };
}

function createRetroHighSchoolSnapshot(prospect: Prospect, year: number, schoolYear: SchoolYear): HighSchoolYearSnapshot {
  const rankPenalty = schoolYear === 1 ? 95 : 38;
  const confidencePenalty = schoolYear === 1 ? 0.24 : 0.12;
  const heightPenalty = schoolYear === 1 ? 4 : 2;
  const weightPenalty = schoolYear === 1 ? 9 : 5;
  const hitterStats = prospect.hitterStats ? createRetroHitterStats(prospect.hitterStats, schoolYear) : undefined;
  const pitcherStats = prospect.pitcherStats ? createRetroPitcherStats(prospect.pitcherStats, schoolYear) : undefined;
  return {
    year,
    schoolYear,
    publicRank: Math.round(clamp(prospect.visible.publicRank + rankPenalty, 1, 400)),
    scoutGrade: retroScoutGrade(prospect.visible.scoutGrade, schoolYear),
    confidence: clamp(prospect.visible.confidence - confidencePenalty, 0.14, 0.78),
    heightCm: Math.max(155, prospect.physical.heightCm - heightPenalty),
    weightKg: Math.max(55, prospect.physical.weightKg - weightPenalty),
    primaryStat: highSchoolPrimaryStat({ hitterStats, pitcherStats }),
    note: schoolYear === 1 ? "소급 기록: 제한 출전 관찰" : "소급 기록: 역할 확대 전 관찰",
    hitterStats,
    pitcherStats,
  };
}

function createRetroHitterStats(stats: HitterStats, schoolYear: SchoolYear): HitterStats {
  const scale = schoolYear === 1 ? 0.34 : 0.62;
  const performancePenalty = schoolYear === 1 ? 0.075 : 0.032;
  const next = { ...stats, reliability: { ...stats.reliability } };
  next.games = Math.max(3, Math.round(stats.games * scale));
  next.plateAppearances = Math.max(8, Math.round(stats.plateAppearances * scale));
  if (next.average !== null) next.average = roundTo(clamp(next.average - performancePenalty, 0.145, 0.45), 3);
  if (next.onBase !== null) next.onBase = roundTo(clamp(next.onBase - performancePenalty, 0.17, 0.55), 3);
  if (next.slugging !== null) next.slugging = roundTo(clamp(next.slugging - performancePenalty * 1.45, 0.2, 0.82), 3);
  if (next.ops !== null) next.ops = roundTo((next.onBase ?? 0) + (next.slugging ?? 0), 3);
  if (next.homeRuns !== null) next.homeRuns = Math.max(0, Math.round(next.homeRuns * scale * (schoolYear === 1 ? 0.58 : 0.78)));
  if (next.doubles !== null) next.doubles = Math.max(0, Math.round(next.doubles * scale));
  if (next.stolenBases !== null) next.stolenBases = Math.max(0, Math.round(next.stolenBases * scale));
  if (next.strikeoutRate !== null) next.strikeoutRate = roundTo(clamp(next.strikeoutRate + (schoolYear === 1 ? 0.035 : 0.016), 0.045, 0.38), 3);
  if (next.walkRate !== null) next.walkRate = roundTo(clamp(next.walkRate - (schoolYear === 1 ? 0.018 : 0.008), 0.01, 0.22), 3);
  if (next.defensiveGrade !== null) next.defensiveGrade = roundGrade(next.defensiveGrade - (schoolYear === 1 ? 5 : 2));
  if (next.athleticismGrade !== null) next.athleticismGrade = roundGrade(next.athleticismGrade - (schoolYear === 1 ? 4 : 2));
  return next;
}

function createRetroPitcherStats(stats: PitcherStats, schoolYear: SchoolYear): PitcherStats {
  const scale = schoolYear === 1 ? 0.3 : 0.58;
  const next = { ...stats, reliability: { ...stats.reliability } };
  next.games = Math.max(2, Math.round(stats.games * scale));
  if (next.innings !== null) next.innings = roundTo(Math.max(3, next.innings * scale), 1);
  if (next.era !== null) next.era = roundTo(clamp(next.era + (schoolYear === 1 ? 0.72 : 0.32), 0.45, 8.2), 2);
  if (next.maxVelocityKph !== null) next.maxVelocityKph = Math.max(120, next.maxVelocityKph - (schoolYear === 1 ? 5 : 2));
  if (next.averageVelocityKph !== null) next.averageVelocityKph = Math.max(116, next.averageVelocityKph - (schoolYear === 1 ? 4 : 2));
  if (next.strikeoutsPerNine !== null) next.strikeoutsPerNine = roundTo(clamp(next.strikeoutsPerNine - (schoolYear === 1 ? 1.1 : 0.45), 2.2, 17.4), 1);
  if (next.walksPerNine !== null) next.walksPerNine = roundTo(clamp(next.walksPerNine + (schoolYear === 1 ? 0.7 : 0.28), 0.8, 9), 1);
  if (next.whip !== null) next.whip = roundTo(clamp(next.whip + (schoolYear === 1 ? 0.18 : 0.08), 0.68, 2.2), 2);
  if (next.pitchCount !== null) next.pitchCount = Math.max(1, next.pitchCount - (schoolYear === 1 ? 1 : 0));
  if (next.pitchArsenal) {
    const targetCount = next.pitchCount ?? next.pitchArsenal.length;
    next.pitchArsenal = next.pitchArsenal
      .map((pitch) => ({ ...pitch, grade: roundGrade(pitch.grade - (schoolYear === 1 ? 6 : 3)) }))
      .sort((left, right) => right.grade - left.grade)
      .slice(0, targetCount)
      .sort((left, right) => pitchDisplayOrder(left.type) - pitchDisplayOrder(right.type));
    next.outPitch = strongestPitch(next.pitchArsenal);
  }
  if (next.commandGrade !== null) next.commandGrade = roundGrade(next.commandGrade - (schoolYear === 1 ? 5 : 2));
  if (next.starterChance !== null) next.starterChance = Math.round(clamp(next.starterChance - (schoolYear === 1 ? 13 : 5), 1, 98));
  return next;
}

function createRetroHighSchoolLog(prospect: Prospect, year: number, schoolYear: SchoolYear): HighSchoolCareerLogEntry {
  return {
    year,
    schoolYear,
    type: "role",
    headline: `${prospect.name}, ${schoolYear}학년 시점 관찰 기록`,
    body: schoolYear === 1
      ? "당시에는 주전 기회가 제한적이어서 신체 조건과 짧은 출전 장면 위주로만 추적됐다."
      : "출전 비중이 늘기 전 단계였고, 스카우트 평가는 다음 시즌 역할 확대 여부를 기다리는 쪽에 가까웠다.",
    importance: 2,
  };
}

function retroScoutGrade(grade: ScoutGrade, schoolYear: SchoolYear): ScoutGrade {
  const grades: ScoutGrade[] = ["E", "D", "C", "B", "A", "S"];
  const index = grades.indexOf(grade);
  const penalty = schoolYear === 1 ? 2 : 1;
  return grades[Math.max(0, index - penalty)] ?? grade;
}

function retroPrimaryStat(prospect: Prospect, schoolYear: SchoolYear): string {
  if (prospect.pitcherStats) {
    const velocity = prospect.pitcherStats.maxVelocityKph === null ? "최고구속 -" : `${Math.max(120, prospect.pitcherStats.maxVelocityKph - (schoolYear === 1 ? 5 : 2))}km/h`;
    const innings = prospect.pitcherStats.innings === null ? "이닝 -" : `${Math.max(4, Math.round(prospect.pitcherStats.innings * (schoolYear === 1 ? 0.28 : 0.56)))}이닝`;
    return `${innings} / ${velocity}`;
  }
  if (prospect.hitterStats) {
    const games = Math.max(3, Math.round(prospect.hitterStats.games * (schoolYear === 1 ? 0.35 : 0.62)));
    const ops = prospect.hitterStats.ops === null ? "OPS -" : `OPS ${roundTo(Math.max(0.45, prospect.hitterStats.ops - (schoolYear === 1 ? 0.09 : 0.04)), 3).toFixed(3)}`;
    return `${games}경기 / ${ops}`;
  }
  return "제한 표본";
}

function initialHighSchoolSnapshotNote(prospect: Prospect): string {
  if (prospect.schoolYear === 1) return "제한 표본 관찰";
  if (prospect.schoolYear === 2) return "역할 확대 전 관찰";
  return "드래프트 대상 시즌";
}

function highSchoolSnapshotNote(growth: number, schoolYear: SchoolYear, event: HighSchoolIssueEvent = NO_HIGH_SCHOOL_EVENT): string {
  if (event.type === "long-rehab") return `${schoolYear}학년 장기 재활`;
  if (event.type === "repeat-year") return `${schoolYear}학년 유급`;
  if (event.type === "transfer") return `${schoolYear}학년 전학`;
  if (event.type === "injury") return `${schoolYear}학년 부상 관리`;
  if (event.type === "college-risk") return `${schoolYear}학년 진학 변수`;
  if (event.type === "position-change") return `${schoolYear}학년 포지션 전환 검토`;
  if (growth >= 4) return `${schoolYear}학년 평가 상승`;
  if (growth <= -1) return `${schoolYear}학년 평가 보류`;
  return `${schoolYear}학년 추적 유지`;
}

function highSchoolPrimaryStat(prospect: Pick<Prospect, "hitterStats" | "pitcherStats">): string {
  if (prospect.pitcherStats) {
    const era = prospect.pitcherStats.era === null ? "ERA -" : `ERA ${prospect.pitcherStats.era.toFixed(2)}`;
    const velocity = prospect.pitcherStats.maxVelocityKph === null ? "최고구속 -" : `${prospect.pitcherStats.maxVelocityKph}km/h`;
    return `${era} / ${velocity}`;
  }
  if (prospect.hitterStats) {
    const ops = prospect.hitterStats.ops === null ? "OPS -" : `OPS ${prospect.hitterStats.ops.toFixed(3)}`;
    const homeRuns = prospect.hitterStats.homeRuns === null ? "HR -" : `HR ${prospect.hitterStats.homeRuns}`;
    return `${ops} / ${homeRuns}`;
  }
  return "기록 표본 부족";
}

function createMilestoneAccolades(publicRank: number, position: Position, hitterStats?: HitterStats, pitcherStats?: PitcherStats, schoolYear: SchoolYear = 3): ProspectAccolade[] {
  const accolades: ProspectAccolade[] = [];
  if (pitcherStats && (pitcherStats.maxVelocityKph ?? 0) >= 150) accolades.push(findAccolade("club-150"));
  if (hitterStats && schoolYear === 3 && (hitterStats.homeRuns ?? 0) >= 10 && publicRank <= 120 && ["1B", "3B", "LF", "RF", "C"].includes(position)) {
    accolades.push(findAccolade("career-20hr"));
  }
  return accolades;
}

function applyQuotaAccoladesToClass(prospects: Prospect[], year: number): Prospect[] {
  const awarded = new Map<ProspectId, ProspectAccolade[]>();
  const add = (prospect: Prospect | undefined, accoladeId: string) => {
    if (!prospect) return;
    const current = awarded.get(prospect.id) ?? [];
    if (!current.some((accolade) => accolade.id === accoladeId) && !prospect.accolades.some((accolade) => accolade.id === accoladeId)) {
      awarded.set(prospect.id, [...current, findAccolade(accoladeId)]);
    }
  };
  const byScore = (score: (prospect: Prospect) => number, pool = prospects) => [...pool].sort((left, right) => score(right) - score(left));
  const hitters = prospects.filter((prospect) => prospect.hitterStats);
  const pitchers = prospects.filter((prospect) => prospect.pitcherStats);
  const olderEligible = prospects.filter((prospect) => prospect.schoolYear >= 2);
  add(byScore(hitterAwardScore, hitters)[0], "lee-youngmin");
  add(byScore(hitterAwardScore, hitters.filter((prospect) => (prospect.hitterStats?.average ?? 0) >= 0.32))[0], "emart-batting");
  add(byScore((prospect) => (prospect.hitterStats?.homeRuns ?? 0) * 9 + (prospect.hitterStats?.slugging ?? 0) * 90, hitters)[0], "phoenix-hr-king");
  add(byScore(pitcherAwardScore, pitchers)[0], "choi-dongwon");
  add(byScore(pitcherAwardScore, pitchers.filter((prospect) => (prospect.pitcherStats?.innings ?? 0) >= 35))[0], "blue-dragon-pitcher");
  add(byScore(tournamentMvpScore, prospects)[0], "golden-lion-mvp");
  byScore(pitcherAwardScore, pitchers.filter((prospect) => prospect.primaryPosition === "SP" && (prospect.pitcherStats?.innings ?? 0) >= 40)).slice(0, 2).forEach((prospect) => add(prospect, "final-starter"));
  add(byScore((prospect) => (prospect.hitterStats?.defensiveGrade ?? 0) * 1.2 + (prospect.visible.publicRank <= 120 ? 14 : 0), hitters.filter((prospect) => prospect.primaryPosition === "C"))[0], "national-catcher");
  add(byScore((prospect) => (prospect.hitterStats?.defensiveGrade ?? 0) * 1.4 + (prospect.hitterStats?.athleticismGrade ?? 0) * 0.4, hitters.filter((prospect) => prospect.primaryPosition === "SS"))[0], "ss-defense");

  byScore(nationalTeamScore, olderEligible).slice(0, prospects[0]?.schoolYear === 2 ? 14 : 24).forEach((prospect) => add(prospect, "u18-national"));
  byScore(showcaseScore, olderEligible).slice(0, prospects[0]?.schoolYear === 2 ? 24 : 36).forEach((prospect) => add(prospect, "college-hs-allstar"));

  return prospects.map((prospect) => applyAccoladesToProspect(prospect, awarded.get(prospect.id) ?? [], year));
}

function applyVisibilityEventsToClass(rng: Rng, prospects: Prospect[], year: number): Prospect[] {
  const bySchool = new Map<string, Prospect[]>();
  for (const prospect of prospects) {
    bySchool.set(prospect.schoolId, [...(bySchool.get(prospect.schoolId) ?? []), prospect]);
  }

  const mediaAccolades = new Map<ProspectId, ProspectAccolade[]>();
  for (const schoolProspects of bySchool.values()) {
    const school = schoolProspects[0];
    const schoolChance =
      school.schoolTier === "elite" ? 0.09 :
      school.schoolTier === "strong" ? 0.065 :
      school.schoolTier === "normal" ? 0.038 :
      0.022;
    if (rng.next() >= schoolChance) continue;
    const breakout = weightedPick(rng, schoolProspects.map((prospect) => ({
      value: prospect,
      weight: 1 + Math.max(0, 180 - prospect.visible.publicRank) / 28 + prospect.reputation / 35 + prospect.draftHype / 45,
    })));
    for (const prospect of schoolProspects) {
      mediaAccolades.set(prospect.id, [
        ...(mediaAccolades.get(prospect.id) ?? []),
        findAccolade(prospect.id === breakout.id ? "baseball-variety-breakout" : "baseball-variety"),
      ]);
    }
  }

  return prospects.map((prospect) => {
    let next = applyAccoladesToProspect(prospect, mediaAccolades.get(prospect.id) ?? [], year);
    next = maybeApplyReputationRiskEvent(rng, next, year);
    next = maybeApplyMlbDirectEvent(rng, next, year);
    return next;
  });
}

function maybeApplyMlbDirectEvent(rng: Rng, prospect: Prospect, year: number): Prospect {
  if (prospect.schoolYear < 2) return prospect;
  const internationalSignal = mlbDirectSignalScore(prospect);
  const interestChance = clamp((internationalSignal - 70) / 850, 0, prospect.schoolYear === 3 ? 0.075 : 0.028);
  if (rng.next() >= interestChance) return prospect;

  const interestLevel = Math.round(clamp(internationalSignal + randomFloat(rng, -7, 11), 45, 100));
  const signingChance = prospect.schoolYear === 3 ? clamp((interestLevel - 82) / 95, 0.012, 0.18) : 0;
  const signed = rng.next() < signingChance;
  const accoladeId = signed ? "mlb-direct-signing" : "mlb-direct-interest";
  const withAccolade = applyAccoladesToProspect(prospect, [findAccolade(accoladeId)], year);
  const riskTags = withAccolade.visible.riskTags.includes("signability")
    ? withAccolade.visible.riskTags
    : [...withAccolade.visible.riskTags, "signability" as ProspectRiskTag];
  const visible: VisibleScoutingReport = {
    ...withAccolade.visible,
    publicRank: Math.round(clamp(withAccolade.visible.publicRank - (signed ? 0 : 10), 1, 400)),
    confidence: clamp(withAccolade.visible.confidence + (signed ? 0.02 : 0.04), 0.12, 0.98),
    riskTags,
    summary: signed
      ? `MLB 직행 계약으로 국내 드래프트 지명 대상에서 빠졌다. ${withAccolade.visible.summary}`
      : `MLB 구단 관심이 확인되며 국내 구단들은 계약 가능성과 해외 이탈 변수를 함께 검토한다. ${withAccolade.visible.summary}`,
  };
  return {
    ...withAccolade,
    highSchoolStatus: signed ? "graduated" : withAccolade.highSchoolStatus,
    mlbDirectStatus: signed ? "signed" : "interest",
    mlbInterestLevel: interestLevel,
    collegeCommitRisk: Math.round(clamp(withAccolade.collegeCommitRisk + (signed ? 30 : 16), 0, 99)),
    reputation: Math.round(clamp(withAccolade.reputation + (signed ? 8 : 4), 0, 100)),
    draftHype: Math.round(clamp(withAccolade.draftHype + (signed ? 12 : 8), 0, 100)),
    visible,
    highSchoolCareerLog: [
      ...withAccolade.highSchoolCareerLog,
      {
        year,
        schoolYear: withAccolade.schoolYear,
        type: "showcase",
        headline: signed ? `${withAccolade.name}, MLB 직행 계약` : `${withAccolade.name}, MLB 구단 관심 확인`,
        body: signed
          ? "해외 구단과 계약하며 국내 드래프트 보드에서 빠졌다. 상위권 후보군을 다시 짜야 하는 대형 변수다."
          : "복수 구단 관심과 공개 쇼케이스 평가가 겹치며 해외 이탈 가능성이 스카우트 회의 안건으로 올라왔다.",
        importance: signed ? 5 : 4,
      },
    ],
    highSchoolSnapshots: replaceCurrentSnapshot({ ...withAccolade, visible }, year, signed ? "MLB 직행 계약" : "MLB 관심 반영"),
  };
}

function mlbDirectSignalScore(prospect: Prospect): number {
  const velocity = prospect.pitcherStats?.maxVelocityKph ?? 0;
  const hitterPower = (prospect.hitterStats?.homeRuns ?? 0) * 3 + (prospect.hitterStats?.slugging ?? 0) * 45;
  const middlePositionBonus = ["SP", "SS", "C", "CF"].includes(prospect.primaryPosition) ? 8 : 0;
  const toolSignal = prospect.playerGroup === "pitcher"
    ? Math.max(0, velocity - 140) * 4 + (prospect.pitcherStats?.strikeoutsPerNine ?? 0) * 2.2
    : hitterPower + (prospect.hitterStats?.athleticismGrade ?? 40) * 0.35;
  const attentionSignal = Math.max(0, 120 - prospect.visible.publicRank) * 0.32 + prospect.reputation * 0.34 + prospect.draftHype * 0.44;
  const teamInterestSignal = prospect.visible.teamInterest.length * 5;
  const accoladeSignal = prospect.accolades.some((accolade) => accolade.id === "u18-national") ? 10 : prospect.accolades.length * 2.5;
  return toolSignal + attentionSignal + teamInterestSignal + accoladeSignal + middlePositionBonus;
}

function maybeApplyReputationRiskEvent(rng: Rng, prospect: Prospect, year: number): Prospect {
  const baseChance = prospect.schoolYear === 1 ? 0.0015 : prospect.schoolYear === 2 ? 0.0025 : 0.0035;
  const attentionBonus = prospect.reputation >= 70 || prospect.draftHype >= 70 ? 0.0015 : 0;
  if (rng.next() >= baseChance + attentionBonus) return prospect;
  const riskTags = prospect.visible.riskTags.includes("reputation-risk")
    ? prospect.visible.riskTags
    : [...prospect.visible.riskTags, "reputation-risk" as ProspectRiskTag];
  const visible: VisibleScoutingReport = {
    ...prospect.visible,
    publicRank: Math.round(clamp(prospect.visible.publicRank + 8, 1, 400)),
    confidence: clamp(prospect.visible.confidence - 0.025, 0.12, 0.98),
    riskTags,
    summary: `학교생활 관련 논란이 불거지며 여론 변수가 생겼다. 사실관계 확인과 구단 내부 기준 검토가 필요하다. ${prospect.visible.summary}`,
  };
  return {
    ...prospect,
    reputation: Math.round(clamp(prospect.reputation + 5, 0, 100)),
    draftHype: Math.round(clamp(prospect.draftHype + 7, 0, 100)),
    visible,
    highSchoolCareerLog: [
      ...prospect.highSchoolCareerLog,
      {
        year,
        schoolYear: prospect.schoolYear,
        type: "reputation-risk",
        headline: `${prospect.name}, 학교생활 논란으로 여론 변수`,
        body: "인지도는 크게 올랐지만 팬 여론과 구단 평판 리스크 평가에는 감점 요인으로 남았다.",
        importance: 4,
      },
    ],
    highSchoolSnapshots: replaceCurrentSnapshot({ ...prospect, visible }, year, "평판 리스크 반영"),
  };
}

function findAccolade(id: string): ProspectAccolade {
  return ACCOLADES.find((accolade) => accolade.id === id) ?? ACCOLADES[0];
}

function applyAccoladesToProspect(prospect: Prospect, quotaAccolades: ProspectAccolade[], year: number): Prospect {
  if (quotaAccolades.length === 0) return prospect;
  const accolades = [...prospect.accolades, ...quotaAccolades];
  const hitterStats = prospect.hitterStats ? applyAccoladeHitterEffects(prospect.hitterStats, quotaAccolades) : undefined;
  const pitcherStats = prospect.pitcherStats ? applyAccoladePitcherEffects(prospect.pitcherStats, quotaAccolades) : undefined;
  const reputationBoost = quotaAccolades.reduce((total, accolade) => total + accolade.reputationBoost, 0);
  const hypeBoost = quotaAccolades.reduce((total, accolade) => total + accolade.hypeBoost, 0);
  const visible: VisibleScoutingReport = {
    ...prospect.visible,
    confidence: clamp(prospect.visible.confidence + quotaAccolades.length * 0.025, 0.16, 0.98),
    publicRank: Math.round(clamp(prospect.visible.publicRank - Math.min(28, Math.round(hypeBoost / 2.4)), 1, 400)),
    summary: `${quotaAccolades.map((accolade) => accolade.label).join(", ")} 이력이 추가됐다. ${prospect.visible.summary}`,
    teamInterest: mergeTeamInterest(prospect.visible.teamInterest, quotaAccolades),
  };
  const updated: Prospect = {
    ...prospect,
    hitterStats,
    pitcherStats,
    accolades,
    reputation: Math.round(clamp(prospect.reputation + reputationBoost, 0, 100)),
    draftHype: Math.round(clamp(prospect.draftHype + hypeBoost, 0, 100)),
    visible,
    highSchoolCareerLog: [
      ...prospect.highSchoolCareerLog,
      ...quotaAccolades.map((accolade): HighSchoolCareerLogEntry => ({
        year,
        schoolYear: prospect.schoolYear,
        type: accolade.id === "u18-national" ? "national-team" : accolade.id === "college-hs-allstar" ? "showcase" : "accolade",
        headline: `${prospect.name}, ${accolade.label}`,
        body: accolade.meaning,
        importance: accolade.id === "u18-national" || accolade.id === "golden-lion-mvp" || accolade.id === "lee-youngmin" || accolade.id === "choi-dongwon" ? 4 : 3,
      })),
    ],
  };
  return {
    ...updated,
    highSchoolSnapshots: replaceCurrentSnapshot(updated, year, `${quotaAccolades[0].label} 반영`),
  };
}

function replaceCurrentSnapshot(prospect: Prospect, year: number, note: string): HighSchoolYearSnapshot[] {
  const snapshots = prospect.highSchoolSnapshots.filter((snapshot) => !(snapshot.year === year && snapshot.schoolYear === prospect.schoolYear));
  return [...snapshots, createHighSchoolSnapshot(prospect, year, note)].sort((left, right) => left.year - right.year || left.schoolYear - right.schoolYear);
}

function mergeTeamInterest(current: string[], accolades: ProspectAccolade[]): string[] {
  const bonusCount = accolades.some((accolade) => accolade.id === "u18-national" || accolade.id === "golden-lion-mvp") ? 3 : 2;
  return Array.from(new Set([...current, ...["서울", "부산", "인천", "대구", "광주"].slice(0, bonusCount)])).slice(0, 6);
}

function hitterAwardScore(prospect: Prospect): number {
  const stats = prospect.hitterStats;
  if (!stats) return -999;
  return (stats.ops ?? 0) * 120 + (stats.average ?? 0) * 80 + (stats.homeRuns ?? 0) * 4 + (stats.walkRate ?? 0) * 80 - prospect.visible.publicRank * 0.05;
}

function pitcherAwardScore(prospect: Prospect): number {
  const stats = prospect.pitcherStats;
  if (!stats) return -999;
  return (7 - (stats.era ?? 6)) * 22 + (stats.strikeoutsPerNine ?? 0) * 5 - (stats.walksPerNine ?? 5) * 4 + (stats.innings ?? 0) * 0.35 + (stats.maxVelocityKph ?? 130) * 0.4 - prospect.visible.publicRank * 0.04;
}

function tournamentMvpScore(prospect: Prospect): number {
  const performance = prospect.pitcherStats ? pitcherAwardScore(prospect) : hitterAwardScore(prospect);
  return performance + (prospect.schoolTier === "elite" ? 10 : prospect.schoolTier === "strong" ? 6 : 0) + (prospect.visible.publicRank <= 40 ? 12 : 0);
}

function nationalTeamScore(prospect: Prospect): number {
  const middlePositionBonus = ["SP", "C", "SS", "CF"].includes(prospect.primaryPosition) ? 12 : 0;
  const performance = prospect.pitcherStats ? pitcherAwardScore(prospect) : hitterAwardScore(prospect);
  return performance + middlePositionBonus + (prospect.visible.publicRank <= 60 ? 18 : 0) + prospect.reputation * 0.4;
}

function showcaseScore(prospect: Prospect): number {
  const performance = prospect.pitcherStats ? pitcherAwardScore(prospect) : hitterAwardScore(prospect);
  return performance + prospect.draftHype * 0.55 + prospect.reputation * 0.35 - prospect.collegeCommitRisk * 0.08;
}

function applyAccoladeHitterEffects(stats: HitterStats, accolades: ProspectAccolade[]): HitterStats {
  const hitting = accolades.filter((accolade) => accolade.category === "hitting" || accolade.category === "tournament").length;
  const defense = accolades.some((accolade) => accolade.id === "ss-defense" || accolade.id === "national-catcher");
  if (hitting === 0 && !defense) return stats;

  const next = { ...stats };
  if (next.average !== null) next.average = roundTo(clamp(next.average + hitting * 0.012, 0.185, 0.48), 3);
  if (next.onBase !== null) next.onBase = roundTo(clamp(next.onBase + hitting * 0.014, 0.2, 0.58), 3);
  if (next.slugging !== null) next.slugging = roundTo(clamp(next.slugging + hitting * 0.024, 0.28, 0.84), 3);
  if (next.ops !== null) next.ops = roundTo((next.onBase ?? 0) + (next.slugging ?? 0), 3);
  if (next.strikeoutRate !== null) next.strikeoutRate = roundTo(clamp(next.strikeoutRate - hitting * 0.006, 0.045, 0.34), 3);
  if (next.defensiveGrade !== null && defense) next.defensiveGrade = roundGrade(next.defensiveGrade + 5);
  return next;
}

function applyAccoladePitcherEffects(stats: PitcherStats, accolades: ProspectAccolade[]): PitcherStats {
  const pitching = accolades.filter((accolade) => accolade.category === "pitching" || accolade.category === "tournament").length;
  const velocity = accolades.some((accolade) => accolade.id === "club-150");
  if (pitching === 0 && !velocity) return stats;

  const next = { ...stats };
  if (next.era !== null) next.era = roundTo(clamp(next.era - pitching * 0.18, 0.35, 6.8), 2);
  if (next.strikeoutsPerNine !== null) next.strikeoutsPerNine = roundTo(clamp(next.strikeoutsPerNine + pitching * 0.35, 3.1, 17.2), 1);
  if (next.maxVelocityKph !== null && velocity) next.maxVelocityKph = Math.min(next.armSlot === "submarine" ? 151 : next.armSlot === "sidearm" ? 153 : 159, Math.max(150, next.maxVelocityKph + 1));
  if (next.averageVelocityKph !== null && velocity) next.averageVelocityKph = Math.min(153, next.averageVelocityKph + 1);
  if (next.commandGrade !== null && pitching) next.commandGrade = roundGrade(next.commandGrade + 3);
  return next;
}

function polishHighSchoolSpecialHitterStats(stats: HitterStats, rng: Rng, position: Position): HitterStats {
  const powerPosition = ["1B", "3B", "LF", "RF"].includes(position);
  const speedPosition = ["SS", "2B", "CF"].includes(position);
  const next = { ...stats };
  next.games = Math.max(next.games, randomInt(rng, 26, 34));
  next.plateAppearances = Math.max(next.plateAppearances, randomInt(rng, 105, 148));
  next.average = roundTo(Math.max(next.average ?? 0, randomFloat(rng, 0.345, 0.418)), 3);
  next.onBase = roundTo(Math.max(next.onBase ?? 0, (next.average ?? 0.35) + randomFloat(rng, 0.075, 0.14)), 3);
  next.slugging = roundTo(Math.max(next.slugging ?? 0, randomFloat(rng, powerPosition ? 0.64 : 0.54, powerPosition ? 0.86 : 0.74)), 3);
  next.ops = roundTo((next.onBase ?? 0) + (next.slugging ?? 0), 3);
  next.homeRuns = Math.max(next.homeRuns ?? 0, randomInt(rng, powerPosition ? 8 : 4, powerPosition ? 15 : 10));
  next.doubles = Math.max(next.doubles ?? 0, randomInt(rng, 12, 22));
  next.stolenBases = Math.max(next.stolenBases ?? 0, randomInt(rng, speedPosition ? 14 : 4, speedPosition ? 30 : 14));
  next.strikeoutRate = roundTo(Math.min(next.strikeoutRate ?? 1, randomFloat(rng, powerPosition ? 0.105 : 0.075, powerPosition ? 0.19 : 0.145)), 3);
  next.walkRate = roundTo(Math.max(next.walkRate ?? 0, randomFloat(rng, 0.105, 0.18)), 3);
  next.defensiveGrade = roundGrade(Math.max(next.defensiveGrade ?? 0, ["C", "SS", "CF"].includes(position) ? randomInt(rng, 60, 75) : randomInt(rng, 52, 68)));
  next.athleticismGrade = roundGrade(Math.max(next.athleticismGrade ?? 0, randomInt(rng, 58, 78)));
  return next;
}

function polishHighSchoolSpecialPitcherStats(stats: PitcherStats, rng: Rng, position: Position): PitcherStats {
  const starter = position === "SP";
  const next = { ...stats };
  next.games = Math.max(next.games, randomInt(rng, starter ? 13 : 20, starter ? 20 : 32));
  next.innings = roundTo(Math.max(next.innings ?? 0, randomFloat(rng, starter ? 62 : 34, starter ? 92 : 58)), 1);
  next.era = roundTo(Math.min(next.era ?? 9, randomFloat(rng, 0.72, starter ? 2.08 : 2.18)), 2);
  next.strikeoutsPerNine = roundTo(Math.max(next.strikeoutsPerNine ?? 0, randomFloat(rng, starter ? 10.2 : 11.4, starter ? 14.8 : 16.2)), 1);
  next.walksPerNine = roundTo(Math.min(next.walksPerNine ?? 9, randomFloat(rng, 1.35, 3.25)), 1);
  next.whip = roundTo(Math.min(next.whip ?? 2, randomFloat(rng, 0.72, 1.08)), 2);
  next.pitchCount = Math.max(next.pitchCount ?? 0, starter ? randomInt(rng, 4, 5) : randomInt(rng, 3, 5));
  if (next.pitchArsenal) {
    next.pitchArsenal = next.pitchArsenal.map((pitch) => ({
      ...pitch,
      grade: roundGrade(pitch.grade + (["four-seam", "two-seam", "sinker", "cutter", "fastball"].includes(pitch.type) ? randomFloat(rng, 2, 7) : randomFloat(rng, 1, 5))),
    }));
    next.outPitch = strongestPitch(next.pitchArsenal);
  }
  next.commandGrade = roundGrade(Math.max(next.commandGrade ?? 0, randomInt(rng, 55, 75)));
  next.starterChance = starter ? Math.max(next.starterChance ?? 0, randomInt(rng, 72, 96)) : next.starterChance;
  return next;
}

function pickPosition(rng: Rng, school: SchoolProfile): Position {
  return weightedPick(rng, [
    { value: "SP", weight: 24 + (school.positionBias.SP ?? 0) },
    { value: "RP", weight: 8 + (school.positionBias.RP ?? 0) },
    { value: "C", weight: 8 + (school.positionBias.C ?? 0) },
    { value: "1B", weight: 7 + (school.positionBias["1B"] ?? 0) },
    { value: "2B", weight: 8 + (school.positionBias["2B"] ?? 0) },
    { value: "3B", weight: 8 + (school.positionBias["3B"] ?? 0) },
    { value: "SS", weight: 10 + (school.positionBias.SS ?? 0) },
    { value: "LF", weight: 8 + (school.positionBias.LF ?? 0) },
    { value: "CF", weight: 10 + (school.positionBias.CF ?? 0) },
    { value: "RF", weight: 9 + (school.positionBias.RF ?? 0) },
  ]);
}

function pickHighSchoolSpecialPosition(rng: Rng, school: SchoolProfile): Position {
  return weightedPick(rng, [
    { value: "SP", weight: 26 + (school.positionBias.SP ?? 0) },
    { value: "C", weight: 10 + (school.positionBias.C ?? 0) },
    { value: "SS", weight: 13 + (school.positionBias.SS ?? 0) },
    { value: "CF", weight: 10 + (school.positionBias.CF ?? 0) },
    { value: "3B", weight: 8 + (school.positionBias["3B"] ?? 0) },
    { value: "RF", weight: 8 + (school.positionBias.RF ?? 0) },
    { value: "2B", weight: 7 + (school.positionBias["2B"] ?? 0) },
    { value: "RP", weight: 4 + (school.positionBias.RP ?? 0) },
    { value: "1B", weight: 4 + (school.positionBias["1B"] ?? 0) },
    { value: "LF", weight: 4 + (school.positionBias.LF ?? 0) },
  ]);
}

function createHiddenTalent(rng: Rng, publicRank: number, dataTier: ProspectDataTier, school: SchoolProfile, classQuality: DraftClassQualityProfile, position: Position): HiddenTalentProfile {
  const polishBonus = school.developmentBias === "polished" ? 3 : school.tier === "elite" ? 2 : 0;
  const rawPenalty = school.developmentBias === "raw" || school.tier === "small" ? -2 : 0;
  const classRankShift = publicRank <= 40 ? classQuality.topTalentShift : publicRank >= 101 ? classQuality.depthTalentShift : classQuality.currentAbilityShift;
  const visibleRankQuality = clamp(82 - publicRank * 0.155 + randomFloat(rng, -10, 9) + polishBonus + rawPenalty + classQuality.currentAbilityShift + classRankShift * 0.4, 22, 78);
  const sleeperChance =
    dataTier === "rank-101-180" ? 0.04 : dataTier === "rank-181-260" ? 0.075 : dataTier === "rank-261-360" ? 0.055 : 0.015;
  const schoolSleeperBoost = school.tier === "small" || school.developmentBias === "raw" ? 0.035 : 0;
  const hiddenSleeperBonus = rng.next() < Math.max(0.004, sleeperChance + schoolSleeperBoost + classQuality.sleeperChanceBoost)
    ? randomFloat(rng, dataTier === "rank-261-360" ? 18 : 12, dataTier === "rank-261-360" ? 32 : 25)
    : 0;
  const overPerformerPenalty = publicRank <= 100 && rng.next() < 0.21 + classQuality.overhypeChanceBoost ? randomFloat(rng, 8, 21) : 0;
  const currentAbility = clamp(visibleRankQuality + randomFloat(rng, -8, 6), 20, 79);
  const potential = clamp(currentAbility + randomFloat(rng, 3, 20) + hiddenSleeperBonus - overPerformerPenalty + classQuality.potentialShift + (publicRank <= 40 ? classQuality.topTalentShift : publicRank >= 101 ? classQuality.depthTalentShift : 0), 28, 88);
  const maxInjuryRisk = dataTier === "top-40" ? 0.65 : dataTier === "rank-41-100" ? 0.72 : dataTier === "rank-261-360" ? 0.9 : 0.84;
  const minVolatility = dataTier === "top-40" ? 0.12 : dataTier === "rank-41-100" ? 0.18 : dataTier === "rank-101-180" ? 0.25 : 0.32;
  const maxVolatility = dataTier === "rank-261-360" ? 0.98 : dataTier === "rank-181-260" ? 0.94 : 0.84;

  const roundedCurrent = Math.round(currentAbility);
  const roundedPotential = Math.round(Math.max(potential, currentAbility + randomInt(rng, 1, 6)));
  const pitcher = position === "SP" || position === "RP";

  return {
    currentAbility: roundedCurrent,
    potential: roundedPotential,
    hitterTools: pitcher ? undefined : createHitterDevelopmentTools(rng, roundedCurrent, roundedPotential, position),
    pitcherTools: pitcher ? createPitcherDevelopmentTools(rng, roundedCurrent, roundedPotential, position) : undefined,
    growthRate: clamp(randomFloat(rng, 0.15, 0.95) + classQuality.growthRateShift, 0.08, 0.98),
    injuryRisk: randomFloat(rng, 0.02, maxInjuryRisk),
    volatility: clamp(randomFloat(rng, minVolatility, maxVolatility) + classQuality.volatilityShift, 0.08, 0.99),
    proAdaptation: randomFloat(rng, 0.12, 0.95),
    workEthic: randomFloat(rng, 0.18, 0.98),
    truePositionFit: {},
  };
}

function adjustForkSplitterInjuryRisk(talent: HiddenTalentProfile, pitcherStats?: PitcherStats): HiddenTalentProfile {
  const forkSplitter = pitcherStats?.pitchArsenal?.filter((pitch) => pitch.type === "forkball" || pitch.type === "splitter") ?? [];
  if (forkSplitter.length === 0) return talent;
  const riskAdd = forkSplitter.reduce((total, pitch) => total + (pitch.type === "splitter" ? 0.035 : 0.024) + Math.max(0, pitch.grade - 45) * 0.0018, 0);
  return {
    ...talent,
    injuryRisk: clamp(talent.injuryRisk + riskAdd, 0.03, 0.96),
  };
}

function createHighSchoolSpecialTalent(rng: Rng, publicRank: number, dataTier: ProspectDataTier, school: SchoolProfile, classQuality: DraftClassQualityProfile, position: Position): HiddenTalentProfile {
  const currentAbility = randomInt(rng, 75, classQuality.id === "bumper" || publicRank <= 3 ? 79 : 78);
  const potential = Math.round(clamp(currentAbility + randomFloat(rng, 5, 13) + classQuality.topTalentShift * 0.35, 80, 90));
  const pitcher = position === "SP" || position === "RP";
  return {
    currentAbility,
    potential,
    hitterTools: pitcher ? undefined : createHitterDevelopmentTools(rng, currentAbility, potential, position),
    pitcherTools: pitcher ? createPitcherDevelopmentTools(rng, currentAbility, potential, position) : undefined,
    growthRate: clamp(randomFloat(rng, 0.34, 0.88) + classQuality.growthRateShift * 0.5, 0.18, 0.96),
    injuryRisk: randomFloat(rng, 0.03, dataTier === "top-40" ? 0.55 : 0.66),
    volatility: clamp(randomFloat(rng, 0.14, 0.68) + classQuality.volatilityShift * 0.5, 0.08, 0.82),
    proAdaptation: randomFloat(rng, 0.3, 0.92),
    workEthic: randomFloat(rng, 0.36, 0.98),
    truePositionFit: {},
  };
}

function createHighSchoolSpecialVisibleReport(report: ReturnType<typeof createVisibleScoutingReport>, currentAbility: number): ReturnType<typeof createVisibleScoutingReport> {
  return {
    ...report,
    scoutGrade: "S",
    confidence: clamp(report.confidence + 0.08, 0.78, 0.97),
    projectedRound: { min: 1, max: 1 },
    expectedOverallRange: {
      min: Math.max(70, Math.min(75, currentAbility - 4)),
      max: Math.max(75, Math.min(80, currentAbility + 3)),
    },
    riskLevel: report.riskLevel === "high" ? "medium" : report.riskLevel,
    growthProjection: "입단 직후부터 1군 전력 계산에 넣을 수 있는 고교 특급 자원. 다만 프로 적응과 건강 변수는 여전히 확인해야 한다.",
    oneLine: `고교특급. 현재 완성도가 이미 1라운드 상단 기준을 넘는 선수로, 즉시 전력 기대치와 장기 고점이 함께 붙는다.`,
  };
}

function exposeDraftEligibleHighSchoolSpecial(report: VisibleScoutingReport, currentAbility: number, schoolYear: SchoolYear, highSchoolSpecial: boolean): VisibleScoutingReport {
  if (!highSchoolSpecial || schoolYear !== 3) return report;
  const exposedRank = currentAbility >= 78 ? 3 : currentAbility >= 76 ? 8 : 15;
  const publicRank = Math.min(report.publicRank, exposedRank);
  const dataTier = dataTierFromPublicRank(publicRank);
  return {
    ...report,
    dataTier,
    visibility: "full",
    publicRank,
    scoutGrade: "S",
    confidence: clamp(report.confidence + 0.12, 0.88, 0.98),
    projectedRound: { min: 1, max: 1 },
    expectedOverallRange: {
      min: Math.max(report.expectedOverallRange.min, Math.max(70, currentAbility - 4)),
      max: Math.max(report.expectedOverallRange.max, Math.min(80, currentAbility + 3)),
    },
    teamInterest: mergeTeamInterest(report.teamInterest, [findAccolade("u18-national"), findAccolade("golden-lion-mvp")]),
    growthProjection: "3학년 시점에는 전국 단위 검증과 구단 크로스체크가 붙은 고교특급으로 분류된다. 성공을 보장하지는 않지만 더 이상 숨은 후보로 보기는 어렵다.",
    oneLine: "고교특급. 3학년 드래프트 시점에는 전국권 상위 후보로 공개 평가가 정리된 선수다.",
    summary: `3학년 들어 전국 단위 추적 대상이 확정됐다. ${report.summary}`,
  };
}

function exposePromotedHighSchoolSpecial(prospect: Prospect, year: number): Prospect {
  if (!isDraftEligibleHighSchoolSpecialSignal(prospect)) return prospect;
  const exposureAccolades = ["u18-national", "college-hs-allstar"]
    .filter((id) => !prospect.accolades.some((accolade) => accolade.id === id))
    .map(findAccolade);
  const withExposure = applyAccoladesToProspect(prospect, exposureAccolades, year);
  const visible = exposeDraftEligibleHighSchoolSpecial(withExposure.visible, withExposure.trueTalent.currentAbility, withExposure.schoolYear, true);
  const next: Prospect = {
    ...withExposure,
    archetype: withExposure.archetype === "고교특급" ? withExposure.archetype : "고교특급",
    reputation: Math.max(withExposure.reputation, 72),
    draftHype: Math.max(withExposure.draftHype, 76),
    visible,
    highSchoolCareerLog: [
      ...withExposure.highSchoolCareerLog,
      {
        year,
        schoolYear: withExposure.schoolYear,
        type: "ranking",
        headline: `${withExposure.name}, 3학년 전국구 고교특급 평가 확정`,
        body: "저학년 때부터 관찰되던 재능이 3학년 기록과 대표·쇼케이스 노출을 거치며 최상위 드래프트 후보군으로 공개 정리됐다.",
        importance: 5,
      },
    ],
  };
  return {
    ...next,
    highSchoolSnapshots: replaceCurrentSnapshot(next, year, "3학년 고교특급 공개 평가 확정"),
  };
}

function isDraftEligibleHighSchoolSpecialSignal(prospect: Prospect): boolean {
  if (prospect.schoolYear !== 3) return false;
  if (prospect.archetype === "고교특급") return true;
  return (
    prospect.trueTalent.currentAbility >= 78 &&
    prospect.trueTalent.potential >= 84 &&
    prospect.visible.scoutGrade === "S" &&
    prospect.visible.publicRank <= 12 &&
    (prospect.reputation >= 68 || prospect.draftHype >= 72)
  );
}

function createSchoolYearVisibleReport(report: ReturnType<typeof createVisibleScoutingReport>, schoolYear: SchoolYear, highSchoolSpecial: boolean): ReturnType<typeof createVisibleScoutingReport> {
  if (schoolYear === 3) return report;
  const confidencePenalty = schoolYear === 1 ? 0.22 : 0.12;
  const widthBump = schoolYear === 1 ? 2 : 1;
  const yearText =
    schoolYear === 1
      ? "1학년이라 공식전 표본과 주전 출전 기회가 제한적이다. 현재 평가는 툴, 신체 성장 여지, 짧은 출전 장면을 함께 본 초기 관찰값이다."
      : "2학년 기준으로는 노출이 있는 편이지만 아직 풀타임 주전 검증은 끝나지 않았다. 내년 기록 변화와 역할 확대를 함께 추적해야 한다.";
  const prefix = highSchoolSpecial && schoolYear === 1
    ? "극히 드문 1학년 전국권 관찰 대상. "
    : highSchoolSpecial
      ? "동학년 기준 빠르게 이름이 도는 상위 관찰 대상. "
      : "";

  return {
    ...report,
    confidence: clamp(report.confidence - confidencePenalty, 0.16, highSchoolSpecial ? 0.86 : 0.74),
    projectedRound: {
      min: Math.max(1, report.projectedRound.min),
      max: Math.min(11, report.projectedRound.max + widthBump),
    },
    expectedOverallRange: {
      min: Math.max(20, report.expectedOverallRange.min - widthBump * 2),
      max: Math.min(80, report.expectedOverallRange.max + widthBump),
    },
    summary: `${prefix}${yearText} ${report.summary}`,
    growthProjection: `${yearText} ${report.growthProjection}`,
    oneLine: `${prefix}${schoolYear}학년 관찰 후보. ${report.oneLine}`,
    teamInterest: schoolYear === 1 ? report.teamInterest.slice(0, highSchoolSpecial ? 3 : 1) : report.teamInterest.slice(0, highSchoolSpecial ? 4 : 2),
  };
}

function applyUnderclassHitterUsage(stats: HitterStats, rng: Rng, schoolYear: SchoolYear, highSchoolSpecial: boolean): HitterStats {
  if (schoolYear === 3) return stats;
  const next = { ...stats };
  const gameRange = schoolYear === 1
    ? highSchoolSpecial ? [12, 24] : [4, 16]
    : highSchoolSpecial ? [22, 32] : [12, 26];
  next.games = Math.min(next.games, randomInt(rng, gameRange[0], gameRange[1]));
  next.plateAppearances = Math.min(next.plateAppearances, randomInt(rng, next.games * 2, Math.max(next.games * 2 + 4, next.games * 4)));
  if (schoolYear === 1 && !highSchoolSpecial) {
    next.homeRuns = next.homeRuns === null ? null : Math.min(next.homeRuns, randomInt(rng, 0, 3));
    next.doubles = next.doubles === null ? null : Math.min(next.doubles, randomInt(rng, 1, 7));
    next.stolenBases = next.stolenBases === null ? null : Math.min(next.stolenBases, randomInt(rng, 0, 8));
  }
  return next;
}

function applyUnderclassPitcherUsage(stats: PitcherStats, rng: Rng, schoolYear: SchoolYear, highSchoolSpecial: boolean, position: Position): PitcherStats {
  if (schoolYear === 3) return stats;
  const next = { ...stats };
  const starter = position === "SP";
  const gameRange = schoolYear === 1
    ? highSchoolSpecial ? [8, 17] : [3, 12]
    : highSchoolSpecial ? [12, 22] : [8, 18];
  const inningRange = schoolYear === 1
    ? highSchoolSpecial ? [18, 48] : [6, 28]
    : highSchoolSpecial ? [36, 68] : [18, 52];
  next.games = Math.min(next.games, randomInt(rng, gameRange[0], gameRange[1]));
  next.innings = next.innings === null ? null : roundTo(Math.min(next.innings, randomFloat(rng, inningRange[0], starter ? inningRange[1] : inningRange[1] * 0.72)), 1);
  if (schoolYear === 1 && !highSchoolSpecial) {
    next.starterChance = next.starterChance === null ? null : Math.min(next.starterChance, randomInt(rng, 12, 48));
  }
  return next;
}

function createHitterDevelopmentTools(rng: Rng, currentAbility: number, potential: number, position: Position): HitterDevelopmentTools {
  const base = (bias = 0) => Math.round(clamp(currentAbility + randomFloat(rng, -9, 9) + bias, 20, Math.min(90, potential + 8)));
  const middleDefense = ["C", "2B", "SS", "CF"].includes(position) ? 7 : position === "1B" ? -5 : 0;
  const speedBias = ["SS", "CF", "2B"].includes(position) ? 7 : ["1B", "C"].includes(position) ? -6 : 0;
  const powerBias = ["1B", "3B", "LF", "RF"].includes(position) ? 8 : ["SS", "2B", "CF"].includes(position) ? -2 : 0;

  return {
    contact: base(position === "2B" || position === "SS" ? 3 : 0),
    discipline: base(0),
    speed: base(speedBias),
    power: base(powerBias),
    defense: base(middleDefense),
    mentality: base(1),
  };
}

function createPitcherDevelopmentTools(rng: Rng, currentAbility: number, potential: number, position: Position): PitcherDevelopmentTools {
  const base = (bias = 0) => Math.round(clamp(currentAbility + randomFloat(rng, -9, 9) + bias, 20, Math.min(90, potential + 8)));
  return {
    command: base(position === "SP" ? 2 : -1),
    stuff: base(position === "RP" ? 4 : 1),
    velocity: base(position === "RP" ? 5 : 0),
    stamina: base(position === "SP" ? 7 : -8),
    mentality: base(1),
  };
}

function createHitterStats(rng: Rng, talent: HiddenTalentProfile, tier: ProspectDataTier, position: Position, leagueLevel: LeagueLevel): HitterStats {
  const production = visibleProductionScore(rng, talent, leagueLevel);
  const average = roundTo(clamp(0.215 + production / 420 + randomFloat(rng, -0.035, 0.035), 0.185, 0.455), 3);
  const onBase = roundTo(clamp(average + randomFloat(rng, 0.045, 0.115), average + 0.015, 0.56), 3);
  const slugging = roundTo(clamp(average + randomFloat(rng, 0.095, 0.31), 0.28, 0.79), 3);
  const reliability = reliabilityForTier(
    tier,
    [
      "average",
      "onBase",
      "slugging",
      "ops",
      "homeRuns",
      "doubles",
      "stolenBases",
      "strikeoutRate",
      "walkRate",
      "defensiveGrade",
      "athleticismGrade",
      "positionalValue",
    ],
  );

  return applyHitterDensity(
    rng,
    {
      games: randomInt(rng, 18, 34),
      plateAppearances: randomInt(rng, 62, 138),
      average,
      onBase,
      slugging,
      ops: roundTo(onBase + slugging, 3),
      homeRuns: randomInt(rng, Math.max(0, Math.floor((slugging - 0.35) * 14)), Math.max(2, Math.floor((slugging - 0.28) * 36))),
      doubles: randomInt(rng, 4, 18),
      stolenBases: randomInt(rng, 0, position === "CF" || position === "SS" ? 24 : 12),
      strikeoutRate: roundTo(clamp(0.08 + (70 - production) / 320 + randomFloat(rng, -0.035, 0.045), 0.05, 0.34), 3),
      walkRate: roundTo(clamp(0.045 + production / 900 + randomFloat(rng, -0.02, 0.035), 0.025, 0.19), 3),
      defensiveGrade: roundGrade(35 + POSITIONAL_VALUE[position] * 3 + randomFloat(rng, -8, 14)),
      athleticismGrade: roundGrade(35 + talent.potential * 0.35 + randomFloat(rng, -10, 12)),
      positionalValue: POSITIONAL_VALUE[position],
      reliability,
    },
    tier,
  );
}

function createPitcherStats(rng: Rng, talent: HiddenTalentProfile, tier: ProspectDataTier, position: Position, leagueLevel: LeagueLevel, physical: PhysicalProfile): PitcherStats {
  const production = visibleProductionScore(rng, talent, leagueLevel);
  const armSlot = pickPitchingArmSlot(rng);
  const maxVelocityKph = createMaxVelocityKph(rng, talent, armSlot, physical.throws);
  const averageVelocityKph = Math.round(maxVelocityKph - randomFloat(rng, 4, 8));
  const pitchArsenal = createPitchArsenal(rng, talent, position, maxVelocityKph);
  const outPitch = strongestPitch(pitchArsenal);
  const reliability = reliabilityForTier(
    tier,
    [
      "innings",
      "armSlot",
      "era",
      "maxVelocityKph",
      "averageVelocityKph",
      "strikeoutsPerNine",
      "walksPerNine",
      "whip",
      "pitchCount",
      "outPitch",
      "commandGrade",
      "starterChance",
    ],
  );

  return applyPitcherDensity(
    rng,
    {
      games: randomInt(rng, position === "SP" ? 8 : 12, position === "SP" ? 18 : 28),
      armSlot,
      innings: roundTo(randomFloat(rng, position === "SP" ? 42 : 18, position === "SP" ? 86 : 48), 1),
      era: roundTo(clamp(5.1 - production / 27 + randomFloat(rng, -0.45, 0.65), 0.42, 6.8), 2),
      maxVelocityKph,
      averageVelocityKph,
      strikeoutsPerNine: roundTo(clamp(4.2 + production / 9 + randomFloat(rng, -1.2, 1.8), 3.1, 16.4), 1),
      walksPerNine: roundTo(clamp(5.6 - talent.currentAbility / 22 + randomFloat(rng, -0.8, 1.1), 1.1, 7.8), 1),
      whip: roundTo(clamp(1.75 - production / 95 + randomFloat(rng, -0.11, 0.16), 0.72, 1.95), 2),
      pitchCount: pitchArsenal.length,
      outPitch,
      pitchArsenal,
      commandGrade: roundGrade(30 + talent.currentAbility * 0.45 + talent.proAdaptation * 10 + randomFloat(rng, -8, 8)),
      starterChance: position === "SP" ? randomInt(rng, 45, 92) : randomInt(rng, 8, 42),
      reliability,
    },
    tier,
  );
}

function createPitchArsenal(rng: Rng, talent: HiddenTalentProfile, position: Position, maxVelocityKph: number): PitchArsenalEntry[] {
  const tools = talent.pitcherTools;
  const stuff = tools?.stuff ?? talent.currentAbility;
  const command = tools?.command ?? talent.currentAbility;
  const velocity = tools?.velocity ?? talent.currentAbility;
  const arsenalSignal = stuff * 0.42 + command * 0.18 + talent.proAdaptation * 14 + talent.workEthic * 10 + (position === "SP" ? 4 : 0);
  const velocityBonus = clamp((maxVelocityKph - 137) * 1.1, -7, 16);
  const fastballBase = 40 + velocity * 0.28 + talent.currentAbility * 0.14 + velocityBonus + randomFloat(rng, -5, 7);
  const breakingBase = 27 + stuff * 0.24 + talent.currentAbility * 0.08 + command * 0.06 + randomFloat(rng, -8, 7);
  const primaryFastball: PitchType = weightedPick(rng, [
    { value: "four-seam", weight: 72 },
    { value: "two-seam", weight: 28 },
  ]);
  const secondaryPitch = weightedSecondaryPitch(rng);
  const arsenal: PitchArsenalEntry[] = [
    { type: primaryFastball, grade: roundGrade(fastballBase) },
    { type: secondaryPitch, grade: roundGrade(breakingBase + secondaryPitchBias(secondaryPitch)) },
  ];

  const extraFastballChance = clamp((arsenalSignal - 51) / 42, 0.04, 0.72);
  if (rng.next() < extraFastballChance) {
    const remainingFastballs = (["four-seam", "two-seam", "sinker", "cutter"] as PitchType[]).filter((type) => !arsenal.some((pitch) => pitch.type === type));
    const type = weightedPick(rng, remainingFastballs.map((value) => ({ value, weight: value === "four-seam" || value === "two-seam" ? 28 : value === "sinker" ? 18 : 14 })));
    arsenal.push({ type, grade: roundGrade(fastballBase - randomFloat(rng, 2, 10) + fastballPitchBias(type)) });
  }

  const secondaryTarget =
    arsenalSignal >= 72 && position === "SP"
      ? 3
      : arsenalSignal >= 62
        ? rng.next() < 0.7 ? 3 : 2
        : arsenalSignal >= 52
          ? rng.next() < 0.42 ? 2 : 1
          : 1;
  while (secondaryPitchCount(arsenal) < secondaryTarget) {
    const remaining = (["curveball", "slider", "changeup", "forkball", "splitter"] as PitchType[]).filter((type) => !arsenal.some((pitch) => pitch.type === type));
    if (remaining.length === 0) break;
    const type = weightedPick(rng, remaining.map((value) => ({ value, weight: secondaryPitchWeight(value) })));
    arsenal.push({ type, grade: roundGrade(breakingBase + secondaryPitchBias(type) - randomFloat(rng, 3, 12)) });
  }

  return arsenal.sort((left, right) => pitchDisplayOrder(left.type) - pitchDisplayOrder(right.type));
}

function weightedSecondaryPitch(rng: Rng): PitchType {
  return weightedPick(rng, [
    { value: "curveball", weight: 36 },
    { value: "slider", weight: 31 },
    { value: "changeup", weight: 19 },
    { value: "forkball", weight: 9 },
    { value: "splitter", weight: 5 },
  ]);
}

function secondaryPitchWeight(type: PitchType): number {
  if (type === "curveball") return 36;
  if (type === "slider") return 31;
  if (type === "changeup") return 19;
  if (type === "forkball") return 9;
  if (type === "splitter") return 5;
  return 1;
}

function secondaryPitchBias(type: PitchType): number {
  if (type === "curveball") return 4;
  if (type === "slider") return 2;
  if (type === "changeup") return -2;
  if (type === "forkball") return -5;
  if (type === "splitter") return -7;
  return 0;
}

function fastballPitchBias(type: PitchType): number {
  if (type === "four-seam") return 2;
  if (type === "two-seam") return 0;
  if (type === "sinker") return -3;
  if (type === "cutter") return -5;
  return 0;
}

function secondaryPitchCount(arsenal: PitchArsenalEntry[]): number {
  return arsenal.filter((pitch) => ["slider", "changeup", "splitter", "forkball", "curveball"].includes(pitch.type)).length;
}

function strongestPitch(arsenal: PitchArsenalEntry[]): PitchType | null {
  return [...arsenal].sort((left, right) => right.grade - left.grade)[0]?.type ?? null;
}

function pitchDisplayOrder(type: PitchType): number {
  return {
    "four-seam": 0,
    "two-seam": 1,
    sinker: 2,
    cutter: 3,
    curveball: 4,
    slider: 5,
    changeup: 6,
    forkball: 7,
    splitter: 8,
    fastball: 9,
  }[type];
}

function visibleProductionScore(rng: Rng, talent: HiddenTalentProfile, leagueLevel: LeagueLevel): number {
  const proMismatch = talent.proAdaptation < 0.35 && talent.currentAbility >= 52 ? randomFloat(rng, 8, 18) : 0;
  const lateBloomerDrag = talent.potential - talent.currentAbility >= 18 ? randomFloat(rng, 4, 14) : 0;
  const leagueInflation = leagueLevel === "약한 리그" ? randomFloat(rng, 3, 8) : leagueLevel === "정보 부족" ? randomFloat(rng, 0, 6) : leagueLevel === "전국권" ? randomFloat(rng, -2, 3) : 0;
  return clamp(talent.currentAbility + proMismatch - lateBloomerDrag + leagueInflation + randomFloat(rng, -9, 10), 20, 82);
}

function pickPitchingArmSlot(rng: Rng): PitchingArmSlot {
  return weightedPick(rng, [
    { value: "three-quarter", weight: 62 },
    { value: "overhand", weight: 22 },
    { value: "low-three-quarter", weight: 9 },
    { value: "sidearm", weight: 5 },
    { value: "submarine", weight: 2 },
  ]);
}

function createMaxVelocityKph(rng: Rng, talent: HiddenTalentProfile, armSlot: PitchingArmSlot, throws: "L" | "R"): number {
  const leftPenalty = throws === "L" ? 2.4 : 0;
  const baseline = 129 + talent.potential * 0.23 + talent.currentAbility * 0.06;
  const regularVelocity = baseline + randomFloat(rng, -3.6, 4.4) - armSlotVelocityPenalty(armSlot) - leftPenalty;
  const eliteChance = talent.potential >= 72 ? (throws === "L" ? 0.012 : 0.035) : throws === "L" ? 0.003 : 0.008;
  const eliteBonus = rng.next() < eliteChance ? randomFloat(rng, throws === "L" ? 2.5 : 3.0, throws === "L" ? 4.8 : 6.2) : 0;
  const cap = throws === "L" ? 155 : 159;
  return Math.round(clamp(regularVelocity + eliteBonus, 126, cap));
}

function armSlotVelocityPenalty(armSlot: PitchingArmSlot): number {
  if (armSlot === "low-three-quarter") return 2.2;
  if (armSlot === "sidearm") return 4.2;
  if (armSlot === "submarine") return 6.4;
  return 0;
}

function applyHitterDensity(rng: Rng, stats: HitterStats, tier: ProspectDataTier): HitterStats {
  if (tier === "top-40") return stats;

  const sparseKeys: (keyof HitterStats)[] =
    tier === "rank-41-100"
      ? ["walkRate", "strikeoutRate", "defensiveGrade"]
      : tier === "rank-101-180"
        ? ["onBase", "walkRate", "strikeoutRate", "athleticismGrade"]
        : ["onBase", "slugging", "ops", "strikeoutRate", "walkRate", "defensiveGrade", "athleticismGrade", "positionalValue"];
  const missingRate = tier === "rank-41-100" ? 0.26 : tier === "rank-101-180" ? 0.38 : tier === "rank-181-260" ? 0.58 : 0.72;

  return sparseKeys.reduce(
    (next, key) => {
      if (rng.next() < missingRate) {
        return { ...next, [key]: null };
      }
      return next;
    },
    { ...stats },
  );
}

function applyPitcherDensity(rng: Rng, stats: PitcherStats, tier: ProspectDataTier): PitcherStats {
  if (tier === "top-40") return stats;

  const sparseKeys: (keyof PitcherStats)[] =
    tier === "rank-41-100"
      ? ["whip", "averageVelocityKph", "commandGrade"]
    : tier === "rank-101-180"
      ? ["innings", "whip", "averageVelocityKph", "starterChance"]
      : ["innings", "averageVelocityKph", "strikeoutsPerNine", "walksPerNine", "whip", "pitchCount", "outPitch", "commandGrade", "starterChance"];
  const missingRate = tier === "rank-41-100" ? 0.24 : tier === "rank-101-180" ? 0.36 : tier === "rank-181-260" ? 0.56 : 0.7;

  return sparseKeys.reduce(
    (next, key) => {
      if (rng.next() < missingRate) {
        return { ...next, [key]: null };
      }
      return next;
    },
    { ...stats },
  );
}

function reliabilityForTier<T extends string>(tier: ProspectDataTier, keys: T[]): Partial<Record<T, MetricQuality>> {
  const quality = tier === "top-40" || tier === "rank-41-100" ? "verified" : tier === "rank-101-180" ? "estimated" : "missing";
  return Object.fromEntries(keys.map((key) => [key, quality])) as Partial<Record<T, MetricQuality>>;
}

function pickLeagueLevel(rng: Rng, publicRank: number, school: SchoolProfile): LeagueLevel {
  if (school.leagueStrength >= 82) return rng.next() < 0.82 ? "전국권" : "상위권";
  if (school.leagueStrength >= 68) return weightedPick(rng, [
    { value: "전국권", weight: 3 },
    { value: "상위권", weight: 6 },
    { value: "보통", weight: 2 },
  ]);
  if (school.leagueStrength <= 42) return weightedPick(rng, [
    { value: "약한 리그", weight: 5 },
    { value: "정보 부족", weight: school.tier === "small" ? 4 : 2 },
    { value: "보통", weight: 2 },
  ]);
  if (publicRank <= 40) {
    return weightedPick(rng, [
      { value: "전국권", weight: 8 },
      { value: "상위권", weight: 3 },
      { value: "보통", weight: 1 },
    ]);
  }
  if (publicRank <= 100) {
    return weightedPick(rng, [
      { value: "전국권", weight: 4 },
      { value: "상위권", weight: 5 },
      { value: "보통", weight: 2 },
      { value: "약한 리그", weight: 1 },
    ]);
  }
  if (publicRank <= 180) {
    return weightedPick(rng, [
      { value: "상위권", weight: 3 },
      { value: "보통", weight: 5 },
      { value: "약한 리그", weight: 2 },
      { value: "정보 부족", weight: 1 },
    ]);
  }
  return weightedPick(rng, [
    { value: "보통", weight: 4 },
    { value: "약한 리그", weight: 4 },
    { value: "정보 부족", weight: 3 },
    { value: "상위권", weight: 1 },
  ]);
}

function leagueReputationBonus(level: LeagueLevel): number {
  if (level === "전국권") return 10;
  if (level === "상위권") return 5;
  if (level === "약한 리그") return -3;
  if (level === "정보 부족") return -5;
  return 0;
}

function createCollegeCommitRisk(rng: Rng, publicRank: number, tier: ProspectDataTier, accolades: ProspectAccolade[]): number {
  const base = tier === "rank-261-360" ? randomFloat(rng, 28, 86) : tier === "rank-181-260" ? randomFloat(rng, 18, 72) : randomFloat(rng, 4, 52);
  const reputationDrag = publicRank <= 80 ? -8 : 0;
  const allStarBoost = accolades.some((accolade) => accolade.id === "college-hs-allstar") ? 10 : 0;
  return Math.round(clamp(base + reputationDrag + allStarBoost + randomFloat(rng, -8, 8), 0, 95));
}

function createArchetype(
  rng: Rng,
  publicRank: number,
  position: Position,
  physical: PhysicalProfile,
  talent: HiddenTalentProfile,
  leagueLevel: LeagueLevel,
  collegeCommitRisk: number,
  hitterStats?: HitterStats,
  pitcherStats?: PitcherStats,
  accolades: ProspectAccolade[] = [],
): string {
  if (publicRank >= 181 && hasLateRoundHook(publicRank, position, physical, talent, leagueLevel, collegeCommitRisk, hitterStats, pitcherStats)) return "하위 라운드 관찰 후보";
  if (collegeCommitRisk >= 74 && publicRank > 120) return "진학 변수 보유 후보";
  if (talent.injuryRisk >= 0.7 && talent.potential >= 66) return "재활 이력 관찰 후보";
  if ((leagueLevel === "약한 리그" || leagueLevel === "정보 부족") && ((hitterStats?.ops ?? 0) >= 0.95 || (pitcherStats?.era ?? 9) <= 2.4)) return "리그 수준 보정 필요 후보";
  if (publicRank > 180 && talent.potential >= 70) return "지역권 성장형 후보";
  if (accolades.some((accolade) => accolade.id === "golden-lion-mvp") && talent.volatility >= 0.58) return "전국대회 활약형 후보";

  if (pitcherStats) {
    const maxVelocity = pitcherStats.maxVelocityKph ?? 0;
    const walks = pitcherStats.walksPerNine ?? 0;
    if (maxVelocity >= 150 && walks >= 4.1) return "강속구 개발형 투수";
    if (publicRank <= 40 && position === "SP") return "전국구 에이스 투수";
    if (physical.throws === "L" && talent.potential >= 68 && talent.currentAbility < 56) return "좌완 성장형 투수";
    if (position === "RP" && talent.currentAbility >= 50) return "불펜 즉전감 후보";
    if ((pitcherStats.pitchCount ?? 0) >= 4 && ["slider", "curveball", "splitter", "changeup"].includes(pitcherStats.outPitch ?? "")) return "변화구 특화 투수";
    if (pitcherStats.armSlot === "sidearm" || pitcherStats.armSlot === "submarine" || pitcherStats.armSlot === "low-three-quarter") return "릴리스 각도 특화 투수";
    if (walks <= 2.7 && position === "SP") return physical.throws === "R" ? "완성형 우완" : "완성형 좌완";
    return "고교 투수 유망주";
  }

  if (hitterStats) {
    if (physical.heightCm <= 176 && ((hitterStats.homeRuns ?? 0) >= 6 || (hitterStats.slugging ?? 0) >= 0.5)) return "체격 대비 장타형 후보";
    if (physical.weightKg >= 90 && ((hitterStats.stolenBases ?? 0) >= 8 || (hitterStats.athleticismGrade ?? 0) >= 55)) return "체격 대비 운동능력형 후보";
    if (physical.weightKg <= 74 && ((hitterStats.stolenBases ?? 0) >= 10 || (hitterStats.athleticismGrade ?? 0) >= 58)) return "경량 순발력형 후보";
    if (rng.next() < 0.025 && talent.potential >= 66) return "투수/야수 겸업 후보";
    if (position === "C" && (hitterStats.defensiveGrade ?? 0) >= 58) return "수비형 포수";
    if (position === "C" && (hitterStats.ops ?? 0) >= 0.9) return "공격형 포수";
    if (position === "SS" && (hitterStats.defensiveGrade ?? 0) >= 58) return "수비형 유격수";
    if (["1B", "LF", "RF"].includes(position) && (hitterStats.homeRuns ?? 0) >= 8 && (hitterStats.defensiveGrade ?? 80) <= 45) return "수비 포지션 검토형 장타자";
    if (position === "1B" && (hitterStats.homeRuns ?? 0) >= 7) return "장타형 1루수";
    if (["2B", "3B", "SS"].includes(position) && (hitterStats.average ?? 0) >= 0.32 && (hitterStats.strikeoutRate ?? 1) <= 0.15) return "컨택형 내야수";
    if (["LF", "CF", "RF"].includes(position) && (hitterStats.athleticismGrade ?? 0) >= 58) return "운동능력형 외야수";
    if (["LF", "CF", "RF"].includes(position) && (hitterStats.stolenBases ?? 0) >= 14) return "발 빠른 대수비 외야수";
  }

  return "고교 야수 유망주";
}

function hasLateRoundHook(
  publicRank: number,
  position: Position,
  physical: PhysicalProfile,
  talent: HiddenTalentProfile,
  leagueLevel: LeagueLevel,
  collegeCommitRisk: number,
  hitterStats?: HitterStats,
  pitcherStats?: PitcherStats,
): boolean {
  if (collegeCommitRisk >= 68 || talent.injuryRisk >= 0.68) return true;
  if (publicRank >= 241 && talent.potential >= 64) return true;
  if (pitcherStats) {
    if ((pitcherStats.maxVelocityKph ?? 0) >= 147 && (pitcherStats.walksPerNine ?? 0) >= 4.0) return true;
    if ((pitcherStats.maxVelocityKph ?? 200) <= 141 && (pitcherStats.walksPerNine ?? 99) <= 2.4) return true;
    if ((pitcherStats.pitchCount ?? 0) <= 2 && pitcherStats.outPitch !== null) return true;
    if (physical.heightCm >= 190 && talent.potential >= 62) return true;
    if (pitcherStats.armSlot === "sidearm" || pitcherStats.armSlot === "submarine" || pitcherStats.armSlot === "low-three-quarter") return true;
  }
  if (hitterStats) {
    if (position === "C" && ((hitterStats.defensiveGrade ?? 0) >= 58 || physical.throws === "R")) return true;
    if (position === "SS" && (hitterStats.defensiveGrade ?? 0) >= 58 && (hitterStats.ops ?? 1) < 0.78) return true;
    if (["LF", "CF", "RF"].includes(position) && ((hitterStats.stolenBases ?? 0) >= 13 || (hitterStats.athleticismGrade ?? 0) >= 58)) return true;
    if (["1B", "LF", "RF"].includes(position) && (hitterStats.homeRuns ?? 0) >= 7) return true;
    if ((hitterStats.strikeoutRate ?? 0) >= 0.24 && (hitterStats.slugging ?? 0) >= 0.48) return true;
    if (leagueLevel === "전국권" && (hitterStats.ops ?? 1) < 0.74) return true;
    if ((leagueLevel === "약한 리그" || leagueLevel === "정보 부족") && (hitterStats.ops ?? 0) >= 0.88) return true;
    if ((hitterStats.defensiveGrade ?? 0) <= 42 && (hitterStats.slugging ?? 0) >= 0.5) return true;
  }
  return false;
}

function secondaryPositionsFor(rng: Rng, position: Position): Position[] {
  if (position === "SP") return rng.next() < 0.22 ? ["RP"] : [];
  if (position === "RP") return rng.next() < 0.16 ? ["SP"] : [];
  if (position === "C") return rng.next() < 0.25 ? ["1B"] : [];
  if (position === "SS") return rng.next() < 0.55 ? [pickOne(rng, ["2B", "3B", "CF"])] : [];
  if (position === "CF") return rng.next() < 0.5 ? [pickOne(rng, ["LF", "RF"])] : [];
  if (position === "LF" || position === "RF") return rng.next() < 0.35 ? ["CF"] : [];
  return rng.next() < 0.35 ? [pickOne(rng, ["1B", "2B", "3B", "SS"])] : [];
}

function heightForPosition(rng: Rng, position: Position): number {
  if (position === "SP" || position === "RP") return randomInt(rng, 180, 196);
  if (position === "C") return randomInt(rng, 176, 188);
  if (position === "SS" || position === "2B" || position === "CF") return randomInt(rng, 173, 188);
  return randomInt(rng, 176, 193);
}

function weightForPosition(rng: Rng, position: Position): number {
  if (position === "SP" || position === "RP") return randomInt(rng, 76, 100);
  if (position === "C" || position === "1B") return randomInt(rng, 82, 106);
  if (position === "SS" || position === "2B" || position === "CF") return randomInt(rng, 68, 88);
  return randomInt(rng, 73, 98);
}

function positionName(position: Position): string {
  return POSITION_NAMES[position] ?? position;
}
