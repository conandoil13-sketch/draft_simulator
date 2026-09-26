import type {
  HiddenTalentProfile,
  HitterStats,
  PhysicalProfile,
  PitcherStats,
  PlayerGroup,
  LeagueLevel,
  ProspectAccolade,
  ProspectDataTier,
  ProspectRiskTag,
  ScoutGrade,
  ScoutingVisibility,
  VisibleScoutingReport,
} from "../types/player";
import type { Position } from "../types/common";
import type { SchoolDevelopmentBias, SchoolTier, SchoolTrait } from "../types/school";
import { clamp, roundGrade, toRange } from "../utils/math";
import { pickOne, randomInt, uniquePicks, type Rng } from "./random";

type ScoutingContext = {
  position: Position;
  physical: PhysicalProfile;
  hitterStats?: HitterStats;
  pitcherStats?: PitcherStats;
  accolades?: ProspectAccolade[];
  reputation?: number;
  draftHype?: number;
  archetype?: string;
  leagueLevel?: LeagueLevel;
  collegeCommitRisk?: number;
  schoolTier?: SchoolTier;
  schoolTraits?: SchoolTrait[];
  schoolDevelopmentBias?: SchoolDevelopmentBias;
  schoolReportReliabilityBase?: number;
};

const RISK_TAGS: ProspectRiskTag[] = [
  "injury-history",
  "small-sample",
  "weak-competition",
  "position-uncertainty",
  "late-bloomer",
  "signability",
  "mechanics",
  "plate-discipline",
  "command",
  "defensive-home",
  "breaking-ball",
  "low-record-trust",
];

const INTERESTED_TEAMS = ["서울", "부산", "인천", "대구", "대전", "광주", "수원", "창원", "울산", "제주"];

const STRENGTHS_BY_GROUP: Record<PlayerGroup, string[]> = {
  pitcher: ["후반까지 살아있는 직구", "헛스윙 유도 능력", "이닝 후반 구위 유지", "완성도 높은 구종 구성", "공격적인 승부"],
  catcher: ["안정적인 포구", "빠른 송구 전환", "장타성 타구 생산", "빠른 공 대처", "침착한 경기 운영"],
  infielder: ["빠른 첫 발", "컨택 능력", "좋은 수비 리듬", "다양한 송구 각도", "라인드라이브 타구"],
  outfielder: ["넓은 수비 범위", "송구의 힘", "주루 압박", "당겨치는 장타력", "타구 판단"],
};

const WEAKNESSES_BY_GROUP: Record<PlayerGroup, string[]> = {
  pitcher: ["제구 기복", "변화구 완성도 기복", "투구폼 힘 소모", "선발 경험 부족"],
  catcher: ["블로킹 기복", "스윙 궤적이 김", "민첩성 의문", "타격 표본 부족"],
  infielder: ["유인구 대처", "송구 정확도", "장타 성장성", "움직임 중 밸런스"],
  outfielder: ["타구 추적 경로", "변화구 인식", "코너 외야 한정 위험", "타구 질 기복"],
};

export function dataTierFromPublicRank(publicRank: number): ProspectDataTier {
  if (publicRank <= 40) return "top-40";
  if (publicRank <= 100) return "rank-41-100";
  if (publicRank <= 180) return "rank-101-180";
  if (publicRank <= 260) return "rank-181-260";
  return "rank-261-360";
}

export function createVisibleScoutingReport(
  rng: Rng,
  talent: HiddenTalentProfile,
  publicRank: number,
  group: PlayerGroup,
  context: ScoutingContext,
): VisibleScoutingReport {
  const dataTier = dataTierFromPublicRank(publicRank);
  const visibility = visibilityForTier(dataTier);
  const confidence = confidenceForTier(rng, dataTier, context.schoolReportReliabilityBase);
  const uncertainty = uncertaintyForTier(dataTier);
  const hype = context.draftHype ?? 0;
  const reputation = context.reputation ?? 0;
  const awardCount = context.accolades?.length ?? 0;
  const visibleOverall = clamp(talent.currentAbility + reputation * 0.08 + hype * 0.1 + randomInt(rng, -uncertainty, uncertainty), 20, 80);
  const hypeRoundBoost = publicRank <= 100 ? Math.floor(hype / 42) : Math.floor(hype / 58);
  const projectedRoundCenter = clamp(projectedRoundFromRank(publicRank) - hypeRoundBoost, 1, 11);
  const interestCountBoost = Math.min(3, Math.floor((reputation + hype) / 32));
  const width = projectedRoundWidth(dataTier);

  return {
    dataTier,
    visibility,
    publicRank,
    scoutGrade: gradeFromVisibleOverall(visibleOverall, publicRank),
    confidence: clamp(confidence + awardCount * 0.03, 0.2, 0.96),
    projectedRound: toRange(projectedRoundCenter, width, 1, 11),
    expectedOverallRange: toRange(visibleOverall, uncertainty, 20, 80),
    trend: pickOne(rng, ["rising", "steady", "falling"]),
    tools: {},
    riskLevel:
      talent.volatility > 0.74 || talent.injuryRisk > 0.72
        ? "high"
        : talent.volatility > 0.5 || talent.proAdaptation < 0.34
          ? "medium"
          : "low",
    riskTags: createRiskTags(rng, dataTier, context),
    strengths: createStrengths(rng, group, dataTier, context),
    weaknesses: createWeaknesses(rng, group, dataTier, context),
    growthProjection: growthProjection(talent, context),
    teamInterest: teamInterestForTier(rng, dataTier, interestCountBoost),
    oneLine: createOneLineReport(talent, publicRank, context),
    summary: createSummary(dataTier, context),
  };
}

function visibilityForTier(tier: ProspectDataTier): ScoutingVisibility {
  if (tier === "top-40") return "full";
  if (tier === "rank-41-100" || tier === "rank-101-180") return "standard";
  if (tier === "rank-181-260") return "limited";
  return "thin";
}

function confidenceForTier(rng: Rng, tier: ProspectDataTier, schoolReliability = 55): number {
  const tierBase =
    tier === "top-40"
      ? randomInt(rng, 80, 95)
      : tier === "rank-41-100"
        ? randomInt(rng, 62, 84)
        : tier === "rank-101-180"
          ? randomInt(rng, 46, 70)
          : tier === "rank-181-260"
            ? randomInt(rng, 30, 56)
            : randomInt(rng, 18, 42);
  return clamp(tierBase * 0.72 + schoolReliability * 0.28, 16, 96) / 100;
}

function uncertaintyForTier(tier: ProspectDataTier): number {
  if (tier === "top-40") return 5;
  if (tier === "rank-41-100") return 8;
  if (tier === "rank-101-180") return 13;
  if (tier === "rank-181-260") return 18;
  return 24;
}

function gradeFromVisibleOverall(visibleOverall: number, publicRank: number): ScoutGrade {
  const rankBonus = publicRank <= 10 ? 4 : publicRank <= 40 ? 2 : publicRank <= 100 ? 0 : publicRank <= 180 ? -1 : -2;
  const score = roundGrade(visibleOverall + rankBonus);
  if (score >= 70) return "S";
  if (score >= 60) return "A";
  if (score >= 50) return "B";
  if (score >= 45) return "C";
  if (score >= 40) return "D";
  return "E";
}

function riskTagCountForTier(rng: Rng, tier: ProspectDataTier): number {
  if (tier === "top-40") return randomInt(rng, 1, 3);
  if (tier === "rank-41-100") return randomInt(rng, 1, 2);
  if (tier === "rank-101-180") return randomInt(rng, 1, 3);
  if (tier === "rank-181-260") return randomInt(rng, 0, 3);
  return randomInt(rng, 0, 2);
}

function createRiskTags(rng: Rng, dataTier: ProspectDataTier, context: ScoutingContext): ProspectRiskTag[] {
  let tags = uniquePicks(rng, RISK_TAGS, riskTagCountForTier(rng, dataTier));
  const add = (tag: ProspectRiskTag) => {
    if (!tags.includes(tag)) tags = [...tags, tag];
  };
  const has = (id: string) => context.accolades?.some((accolade) => accolade.id === id);

  if (has("golden-lion-mvp") && rng.next() < 0.38) add("small-sample");
  if (has("choi-dongwon") && rng.next() < 0.42) add("injury-history");
  if (has("club-150") && (context.pitcherStats?.walksPerNine ?? 0) >= 4.0) add("command");
  if (context.pitcherStats?.pitchArsenal?.some((pitch) => pitch.type === "forkball" || pitch.type === "splitter")) {
    const maxForkSplitGrade = Math.max(...context.pitcherStats.pitchArsenal.filter((pitch) => pitch.type === "forkball" || pitch.type === "splitter").map((pitch) => pitch.grade));
    if (rng.next() < (maxForkSplitGrade >= 50 ? 0.58 : 0.34)) add("injury-history");
  }
  if ((context.draftHype ?? 0) >= 45 && rng.next() < 0.32) add("low-record-trust");
  if ((context.collegeCommitRisk ?? 0) >= 68) add("signability");
  if (context.leagueLevel === "약한 리그" || context.leagueLevel === "정보 부족") add("weak-competition");
  return tags;
}

function reportItemsForTier(rng: Rng, items: string[], tier: ProspectDataTier, maxTop = 3): string[] {
  if (tier === "top-40") return uniquePicks(rng, items, maxTop);
  if (tier === "rank-41-100") return uniquePicks(rng, items, 2);
  if (tier === "rank-101-180") return uniquePicks(rng, items, 1);
  if (tier === "rank-181-260") return rng.next() < 0.56 ? uniquePicks(rng, items, 1) : [];
  return [];
}

function createStrengths(rng: Rng, group: PlayerGroup, tier: ProspectDataTier, context: ScoutingContext): string[] {
  const items = [...STRENGTHS_BY_GROUP[group]];

  if (context.pitcherStats) {
    if ((context.pitcherStats.maxVelocityKph ?? 0) >= 150) items.push("상위권 최고 구속");
    if ((context.pitcherStats.strikeoutsPerNine ?? 0) >= 10.5) items.push("탈삼진 생산력");
    if ((context.pitcherStats.walksPerNine ?? 99) <= 2.5) items.push("볼넷 억제");
    if ((context.pitcherStats.starterChance ?? 0) >= 70) items.push("선발 잔류 가능성");
    if (context.physical.heightCm >= 190 && context.physical.weightKg <= 86) items.push("장신 마른 체형의 증량 여지");
    if (context.physical.heightCm <= 180 && (context.pitcherStats.maxVelocityKph ?? 0) >= 145) items.push("작은 체구 대비 팔 스피드");
  }

  if (context.hitterStats) {
    if ((context.hitterStats.ops ?? 0) >= 0.95) items.push("중심타선급 생산력");
    if ((context.hitterStats.homeRuns ?? 0) >= 8) items.push("고교 단계 장타 실적");
    if ((context.hitterStats.strikeoutRate ?? 1) <= 0.12) items.push("낮은 헛스윙 비율");
    if ((context.hitterStats.defensiveGrade ?? 0) >= 60) items.push("수비 기여도");
    if ((context.hitterStats.stolenBases ?? 0) >= 12) items.push("주루 압박");
    if (context.physical.heightCm <= 176 && ((context.hitterStats.homeRuns ?? 0) >= 6 || (context.hitterStats.slugging ?? 0) >= 0.5)) items.push("작은 체구 대비 장타 생산");
    if (context.physical.weightKg >= 90 && ((context.hitterStats.stolenBases ?? 0) >= 8 || (context.hitterStats.athleticismGrade ?? 0) >= 55)) items.push("체격 대비 움직임");
    if (context.physical.weightKg <= 74 && ((context.hitterStats.stolenBases ?? 0) >= 10 || (context.hitterStats.athleticismGrade ?? 0) >= 58)) items.push("가벼운 체형 대비 순발력");
    if (context.position === "C" && context.physical.weightKg >= 86 && (context.hitterStats.defensiveGrade ?? 0) >= 55) items.push("포수 체형과 수비 안정감");
  }

  context.accolades?.forEach((accolade) => {
    if (accolade.category === "hitting") items.push(`${accolade.label} 이력`);
    if (accolade.category === "pitching") items.push(`${accolade.label} 이력`);
    if (accolade.category === "defense") items.push(`${accolade.label} 이력`);
    if (accolade.category === "reputation") items.push("대표/올스타 노출 경험");
  });

  if (context.archetype) items.push(context.archetype);
  if (context.leagueLevel === "전국권") items.push("전국 단위 검증 표본");
  if (context.schoolTraits?.includes("high-data")) items.push("학교 리포트 표본 풍부");
  if (context.schoolDevelopmentBias === "pitching") items.push("투수 육성 이력");
  if (context.schoolDevelopmentBias === "catcher") items.push("포수 육성 이력");
  if (context.schoolDevelopmentBias === "infield-defense") items.push("내야 수비 육성 이력");
  if (context.schoolDevelopmentBias === "power") items.push("장타자 배출 이력");
  if (context.schoolDevelopmentBias === "speed-outfield") items.push("외야수 운동능력 평가 표본");
  if (context.schoolDevelopmentBias === "polished") items.push("완성형 선수 배출 경향");
  if (context.schoolDevelopmentBias === "raw") items.push("원석형 선수 배출 경향");
  if (context.physical.heightCm >= 190) items.push("큰 체격에서 나오는 확장성");
  return reportItemsForTier(rng, items, tier);
}

function createWeaknesses(rng: Rng, group: PlayerGroup, tier: ProspectDataTier, context: ScoutingContext): string[] {
  const items = [...WEAKNESSES_BY_GROUP[group]];

  if (context.pitcherStats) {
    if ((context.pitcherStats.walksPerNine ?? 0) >= 4.2) items.push("볼넷 허용 증가");
    if ((context.pitcherStats.averageVelocityKph ?? 200) - (context.pitcherStats.maxVelocityKph ?? 0) < -9) items.push("평균 구속 유지 확인 필요");
    if ((context.pitcherStats.pitchCount ?? 0) <= 2) items.push("구종 다양성 부족");
    if ((context.pitcherStats.whip ?? 0) >= 1.45) items.push("주자 누적 위험");
    if (context.accolades?.some((accolade) => accolade.id === "choi-dongwon")) items.push("고교 단계 투구 부담 누적 여부");
    if (context.accolades?.some((accolade) => accolade.id === "club-150") && (context.pitcherStats.walksPerNine ?? 0) >= 4.0) items.push("구속 대비 제구 완성도");
    if (context.pitcherStats.pitchArsenal?.some((pitch) => pitch.type === "forkball" || pitch.type === "splitter")) items.push("포크/스플리터 구사에 따른 팔 부담");
    if (context.physical.heightCm >= 190 && context.physical.weightKg <= 82) items.push("증량 후 밸런스 유지 확인");
    if (context.physical.heightCm <= 178 && (context.pitcherStats.maxVelocityKph ?? 0) <= 140) items.push("체격 대비 구위 상단 확인");
  }

  if (context.hitterStats) {
    if ((context.hitterStats.strikeoutRate ?? 0) >= 0.24) items.push("삼진 비율 부담");
    if ((context.hitterStats.walkRate ?? 1) <= 0.06) items.push("출루 과정 단조로움");
    if ((context.hitterStats.defensiveGrade ?? 80) <= 45) items.push("수비 위치 불확실성");
    if ((context.hitterStats.ops ?? 1) < 0.75) items.push("상위권 투수 상대 생산력 확인 필요");
    if ((context.draftHype ?? 0) >= 45) items.push("수상 경력 대비 실제 툴 검증");
    if (context.physical.heightCm <= 174 && (context.hitterStats.homeRuns ?? 0) <= 2) items.push("작은 체구에서 공격 임팩트 확인 필요");
    if (context.physical.weightKg >= 96 && (context.hitterStats.stolenBases ?? 0) <= 2 && (context.hitterStats.athleticismGrade ?? 80) <= 45) items.push("체중 대비 수비 범위 확인");
    if (context.position === "C" && context.physical.weightKg <= 76) items.push("포수 포지션 내구성 확인");
  }

  if ((context.collegeCommitRisk ?? 0) >= 68) items.push("대학 진학 가능성 변수");
  if (context.leagueLevel === "약한 리그" || context.leagueLevel === "정보 부족") items.push("리그 수준 보정 필요");
  if (context.schoolTraits?.includes("low-report")) items.push("학교 리포트 표본 제한");
  if (context.schoolTier === "small") items.push("스카우트 노출 표본 부족");
  if (context.physical.weightKg < 72) items.push("근력 보강 필요");
  return reportItemsForTier(rng, items, tier);
}

function growthProjection(talent: HiddenTalentProfile, context: ScoutingContext): string {
  if (context.pitcherStats) {
    if (context.accolades?.some((accolade) => accolade.id === "club-150") && (context.pitcherStats.walksPerNine ?? 0) >= 4) return "구속만 보면 상위 라운드 재료지만 제구가 동반되지 않으면 오버픽 위험이 있다.";
    if ((context.pitcherStats.maxVelocityKph ?? 0) >= 150 && context.physical.heightCm >= 185) return "구속과 체격 조건이 좋아 선발/불펜 양쪽에서 추가 관찰 가치가 있다.";
    if ((context.pitcherStats.walksPerNine ?? 99) <= 2.7) return "제구 안정성이 먼저 보이는 유형이라 상위 레벨 적응 과정을 차분히 볼 수 있다.";
  }

  if (context.hitterStats) {
    if (context.physical.heightCm <= 176 && ((context.hitterStats.homeRuns ?? 0) >= 6 || (context.hitterStats.slugging ?? 0) >= 0.5)) return "체구는 크지 않지만 장타 지표가 살아 있어 타구 질을 따로 확인할 가치가 있다.";
    if (context.physical.weightKg >= 90 && ((context.hitterStats.stolenBases ?? 0) >= 8 || (context.hitterStats.athleticismGrade ?? 0) >= 55)) return "체형에 비해 움직임이 가볍게 나와 수비 위치와 주루 활용 폭을 함께 볼 수 있다.";
    if ((context.draftHype ?? 0) >= 48 && (context.hitterStats.strikeoutRate ?? 0) >= 0.22) return "수상 경력으로 관심은 높지만 컨택 지표를 함께 보지 않으면 과대평가 위험이 있다.";
    if ((context.hitterStats.ops ?? 0) >= 0.95 && (context.hitterStats.strikeoutRate ?? 1) <= 0.16) return "타격 결과와 컨택 지표가 같이 따라와 상위 라운드 검토 가치가 있다.";
    if ((context.hitterStats.defensiveGrade ?? 0) >= 60) return "방망이가 늦게 올라와도 수비로 버틸 수 있는 프로필이다.";
  }

  if (talent.volatility >= 0.72) return "관찰 표본이 더 쌓이면 평가 폭이 크게 움직일 수 있는 유형이다.";
  return "현재 기록과 신체 조건을 함께 보면 무리한 확정보다는 추가 추적이 필요한 선수다.";
}

function createOneLineReport(talent: HiddenTalentProfile, publicRank: number, context: ScoutingContext): string {
  const archetypePrefix = context.archetype ? `${context.archetype}. ` : "";
  if (context.pitcherStats) {
    const velocity = context.pitcherStats.maxVelocityKph ? `최고 ${context.pitcherStats.maxVelocityKph}㎞/시` : "구속 정보가 제한적";
    const control = context.pitcherStats.walksPerNine ? `볼넷/9 ${context.pitcherStats.walksPerNine}` : "제구 표본 제한";
    if (publicRank > 120 && talent.potential >= 68) return `${archetypePrefix}${velocity}, ${control}. 순위보다 특성이 먼저 눈에 들어오는 투수.`;
    return `${archetypePrefix}${velocity}, 탈삼/9 ${formatNullable(context.pitcherStats.strikeoutsPerNine)}. ${accoladeNote(context)}구위와 제구의 균형을 더 확인해야 한다.`;
  }

  if (context.hitterStats) {
    const ops = context.hitterStats.ops ? `출루장타 ${context.hitterStats.ops.toFixed(3)}` : "중심 지표 일부 미확인";
    const strikeouts = context.hitterStats.strikeoutRate ? `삼진율 ${Math.round(context.hitterStats.strikeoutRate * 100)}%` : "삼진율 표본 제한";
    if (publicRank > 120 && talent.potential >= 68) return `${archetypePrefix}${ops}, ${strikeouts}. 기록보다 툴과 신체 조건을 같이 봐야 하는 야수.`;
    return `${archetypePrefix}${ops}, ${strikeouts}. ${accoladeNote(context)}타격 결과와 접근법을 함께 확인할 필요가 있다.`;
  }

  return "기록 표본이 제한적이라 추가 관찰이 필요한 선수.";
}

function createSummary(tier: ProspectDataTier, context: ScoutingContext): string {
  const contextText = `${context.leagueLevel ?? "보통"} 리그 표본, 대학 진학 가능성 ${context.collegeCommitRisk ?? 0}% 기준. `;
  if (tier === "top-40") {
    if (context.pitcherStats) {
      return `상세 관찰 기록 확보. ${contextText}${context.pitcherStats.innings ?? "-"}이닝 동안 평균자책 ${formatNullable(context.pitcherStats.era)}, 최고구속 ${formatKph(context.pitcherStats.maxVelocityKph)}를 기록했다. ${summaryAccoladeText(context)}구종 수와 결정구, 볼넷 억제 여부를 같이 봐야 한다.`;
    }
    return `상세 관찰 기록 확보. ${contextText}타율 ${formatAverage(context.hitterStats?.average)}, 출루장타 ${formatAverage(context.hitterStats?.ops)}, 홈런 ${formatNullable(context.hitterStats?.homeRuns)}개를 기록했다. ${summaryAccoladeText(context)}수비 위치와 삼진율이 지명 판단의 핵심 변수다.`;
  }

  if (tier === "rank-41-100" || tier === "rank-101-180") {
    if (context.pitcherStats) {
      return `부분 리포트 확보. ${contextText}최고구속 ${formatKph(context.pitcherStats.maxVelocityKph)}, 탈삼/9 ${formatNullable(context.pitcherStats.strikeoutsPerNine)}는 확인됐지만 일부 세부 지표는 추정치다.`;
    }
    return `부분 리포트 확보. ${contextText}출루장타 ${formatAverage(context.hitterStats?.ops)}, 홈런 ${formatNullable(context.hitterStats?.homeRuns)}개 정도의 생산성은 보이나 일부 지표는 추정치다.`;
  }

  if (context.pitcherStats) {
    return `제한 리포트. ${contextText}신체조건 ${context.physical.heightCm}㎝/${context.physical.weightKg}㎏, 최고구속 ${formatKph(context.pitcherStats.maxVelocityKph)} 정도만 확실하다.`;
  }
  return `제한 리포트. ${contextText}신체조건 ${context.physical.heightCm}㎝/${context.physical.weightKg}㎏, 포지션과 짧은 기록 표본을 중심으로 추적 중이다.`;
}

function projectedRoundFromRank(publicRank: number): number {
  if (publicRank <= 40) return clamp(Math.ceil(publicRank / 20), 1, 2);
  if (publicRank <= 80) return clamp(2 + Math.ceil((publicRank - 40) / 14), 3, 5);
  if (publicRank <= 100) return clamp(6 + Math.ceil((publicRank - 80) / 10), 6, 8);
  if (publicRank <= 140) return clamp(8 + Math.ceil((publicRank - 100) / 20), 9, 10);
  if (publicRank <= 220) return 11;
  return 11;
}

function projectedRoundWidth(tier: ProspectDataTier): number {
  if (tier === "top-40") return 0;
  if (tier === "rank-41-100") return 1;
  if (tier === "rank-101-180") return 1;
  if (tier === "rank-181-260") return 2;
  return 1;
}

function teamInterestForTier(rng: Rng, tier: ProspectDataTier, boost: number): string[] {
  if (tier === "top-40") return uniquePicks(rng, INTERESTED_TEAMS, Math.min(7, randomInt(rng, 3, 6) + boost));
  if (tier === "rank-41-100") return uniquePicks(rng, INTERESTED_TEAMS, Math.min(5, randomInt(rng, 1, 3) + boost));
  if (tier === "rank-101-180") return uniquePicks(rng, INTERESTED_TEAMS, Math.min(3, randomInt(rng, 0, 2) + boost));
  if (tier === "rank-181-260") return boost > 0 ? uniquePicks(rng, INTERESTED_TEAMS, 1) : [];
  return boost > 1 ? uniquePicks(rng, INTERESTED_TEAMS, 1) : [];
}

function accoladeNote(context: ScoutingContext): string {
  if (!context.accolades?.length) return "";
  const top = context.accolades[0];
  return `${top.label} 이력으로 관심이 붙었지만, `;
}

function summaryAccoladeText(context: ScoutingContext): string {
  if (!context.accolades?.length) return "";
  return `수상 이력(${context.accolades.map((accolade) => accolade.label).join(", ")}) 때문에 평판은 높지만 프로 성공 보장은 아니다. `;
}

function formatNullable(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : String(value);
}

function formatAverage(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : value.toFixed(3);
}

function formatKph(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${value}㎞/시`;
}
