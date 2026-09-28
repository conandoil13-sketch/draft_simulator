import type { Position } from "../types/common";
import type { ProspectRiskTag, ScoutGrade } from "../types/player";
import type { SchoolDevelopmentBias, SchoolTier, SchoolTrait } from "../types/school";
import type { CareerYearBucket, FilterPreset, MainTab, NewsGrade, NewsScope, PlayerTypeFilter, TrackingStatus } from "../types/app";

export const POSITIONS: Position[] = ["SP", "RP", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
export const TEAM_ROSTER_LIMIT = 80;
export const ROOKIE_ROSTER_EXEMPT_YEARS = 1;
export const MIN_POSITION_DEPTH_FOR_CUTS: Record<Position, number> = {
  SP: 8,
  RP: 8,
  C: 3,
  "1B": 3,
  "2B": 3,
  "3B": 3,
  SS: 3,
  LF: 3,
  CF: 3,
  RF: 3,
};

export const ROUNDS = Array.from({ length: 11 }, (_, index) => index + 1);
export const RISK_TAGS: ProspectRiskTag[] = ["injury-history", "command", "breaking-ball", "position-uncertainty", "low-record-trust", "small-sample", "weak-competition", "signability", "reputation-risk"];

export const RISK_LABELS: Record<ProspectRiskTag, string> = {
  "injury-history": "부상 의심",
  "small-sample": "표본 부족",
  "weak-competition": "상대 약함",
  "position-uncertainty": "포지션 불안",
  "late-bloomer": "늦은 성장",
  signability: "계약 변수",
  mechanics: "폼 리스크",
  "plate-discipline": "선구안",
  command: "제구 불안",
  "defensive-home": "수비 위치",
  "breaking-ball": "변화구 약점",
  "low-record-trust": "기록 신뢰도 낮음",
  "reputation-risk": "평판 리스크",
};

export const TENDENCY_LABELS = {
  "prep-pitcher": "고졸 투수 선호",
  "defense-first": "수비형 야수 선호",
  "catcher-premium": "포수 프리미엄",
  upside: "고점픽 선호",
  safe: "안정픽 선호",
  "injury-risk-tolerant": "부상 리스크 감수",
  physical: "피지컬 선호",
  "quick-impact": "즉전감 선호",
};

export const GRADE_WEIGHT: Record<ScoutGrade, number> = { S: 6, A: 5, B: 4, C: 3, D: 2, E: 1 };
export const PLAYER_TYPE_LABELS: Record<PlayerTypeFilter, string> = {
  all: "전체",
  hitters: "타자",
  pitchers: "투수",
};
export const TRACKING_STATUS_LABELS: Record<TrackingStatus, string> = {
  auto: "자동 추적",
  follow: "상세 추적",
  summary: "요약 추적",
  archived: "추적 종료",
};
export const NEWS_GRADE_LABELS: Record<NewsGrade, string> = {
  headline: "헤드라인",
  major: "주요",
  normal: "일반",
  archive: "기록용",
};
export const NEWS_SCOPE_LABELS: Record<NewsScope, string> = {
  "user-team": "자팀",
  watched: "자팀+관심",
  league: "전체 리그",
};
export const YEAR_BUCKET_LABELS: Record<CareerYearBucket, string> = {
  all: "전체 연차",
  "year-1": "1년차",
  "year-2-3": "2~3년차",
  "year-4-5": "4~5년차",
  "year-6-10": "6~10년차",
  "year-11-15": "11~15년차",
  "year-16-20": "16~20년차",
  "year-20-plus": "20년차 이상",
};
export const SCHOOL_TIER_LABELS: Record<SchoolTier, string> = {
  elite: "전국구 명문",
  strong: "지역 강호",
  normal: "일반",
  small: "소규모",
};
export const SCHOOL_TRAIT_LABELS: Record<SchoolTrait, string> = {
  pitching: "투수 명문",
  catcher: "포수 명문",
  "infield-defense": "수비형 내야",
  power: "장타자 배출",
  "speed-outfield": "발 빠른 외야",
  "two-way": "투타겸업",
  polished: "완성형 배출",
  raw: "원석형 배출",
  "high-data": "데이터 신뢰도 높음",
  "low-report": "리포트 표본 제한",
};
export const SCHOOL_BIAS_LABELS: Record<SchoolDevelopmentBias, string> = {
  pitching: "투수 명문",
  catcher: "포수 명문",
  "infield-defense": "수비형 내야수 명문",
  power: "장타자 배출",
  "speed-outfield": "발 빠른 외야수 배출",
  "two-way": "투타겸업 선수 배출",
  polished: "완성형 선수 배출",
  raw: "원석형 선수 배출",
};
export const POSITION_LABELS: Record<Position, string> = {
  SP: "선발",
  RP: "불펜",
  C: "포수",
  "1B": "1루",
  "2B": "2루",
  "3B": "3루",
  SS: "유격",
  LF: "좌익",
  CF: "중견",
  RF: "우익",
};
export const GRADE_LABELS: Record<ScoutGrade, string> = {
  S: "최상",
  A: "상",
  B: "중상",
  C: "중",
  D: "하",
  E: "최하",
};
export const ROUND_LABELS: Record<string, string> = {
  "11": "미지명권",
};
export const FILTER_PRESETS: { id: FilterPreset; label: string }[] = [
  { id: "team-needs", label: "우리 팀 니즈" },
  { id: "top-available", label: "남은 최고 랭커" },
  { id: "upside", label: "고점픽" },
  { id: "safe", label: "안정픽" },
  { id: "premium-defense", label: "수비형 포지션" },
  { id: "pitcher-lottery", label: "성장형 투수" },
  { id: "late-sleepers", label: "하위 숨은 후보" },
  { id: "low-risk", label: "리스크 낮음" },
  { id: "high-risk-upside", label: "고위험 고점" },
  { id: "awarded", label: "수상 경력" },
  { id: "college-risk", label: "대학 리스크" },
];
export const MAIN_TABS: { id: MainTab; label: string; description: string }[] = [
  { id: "draft-room", label: "드래프트룸", description: "현재 픽, 보드, 남은 선수 테이블" },
  { id: "foreign-recruitment", label: "용병 스카우트", description: "오퍼, 경합, 계약 현황" },
  { id: "scouting", label: "선수 탐색", description: "정렬, 필터, 상세 리포트, 비교" },
  { id: "team", label: "구단 상황", description: "팀 니즈, 팬 모의지명, 여론" },
  { id: "review", label: "결과/회고", description: "지명 결과, 직후 반응, 회고 평가" },
  { id: "tracking", label: "선수 추적", description: "뉴스피드, 성장 로그, 추적 관리" },
  { id: "league-history", label: "리그 히스토리", description: "시즌 순위, 지명권, 리그 회고" },
];
