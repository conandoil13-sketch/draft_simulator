# Phase 1 Prospect Generator

## Implemented Scope

The prospect generator now creates a 220-player high school draft class with:

- Position groups: pitcher, catcher, infielder, outfielder.
- Detailed positions: SP, RP, C, 1B, 2B, 3B, SS, LF, CF, RF.
- Name, school, school year, position, bats/throws, height, weight.
- Projected round, public rank, scout grade, confidence, risk tags, and report density.
- Separate hitter and pitcher stat models.
- Hidden talent values that are not exposed through table/detail selectors.

## Data Density

- `top-50`: full visibility, richer reports, strengths, weaknesses, growth projection, and team interest.
- `rank-51-120`: partial visibility, short reports, and some estimated or missing stat fields.
- `rank-121-220`: sparse visibility, basic profile, one-line report, and a small chance of hidden upside.

## Hidden Talent

`Prospect.trueTalent` contains:

- `currentAbility`
- `potential`
- `growthRate`
- `injuryRisk`
- `volatility`
- `proAdaptation`
- `workEthic`

UI code should not read this object directly. Draft reveal and long-term simulation logic can use it.

## UI-Ready Selectors

Use `src/game/selectors/prospects.ts` for table-centered UI:

- `getProspectTableRows`
- `filterProspects`
- `sortProspects`
- `queryProspects`
- `getProspectDetailPanel`

Supported filters:

- position
- projected round
- scout grade
- school
- risk tag
- risk level
- confidence
- availability

Supported sort keys include rank, name, position, school, projected round, scout grade, risk, confidence, physical profile, and primary stat.
