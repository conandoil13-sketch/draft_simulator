# Phase 0 Architecture

## Goal

This project is a desktop-first high school baseball draft simulation. The UI should behave more like a scouting database, stock screener, or baseball statistics site than a sports game screen. Phase 0 defines the folder structure, data model, and pure game logic boundaries before any UI implementation.

## Folder Structure

```text
src/
  game/
    constants/
      league.ts              Static league/team/draft constants.
    draft/
      draftOrder.ts          Draft order and pick ownership.
      draftRunner.ts         Pick execution and draft completion.
      pickTrades.ts          Low-probability draft-pick trade events.
    generation/
      names.ts               Korean-style fictional name pools.
      prospects.ts           Yearly high school prospect generation.
      scouting.ts            Visible report quality, uncertainty, and tags.
      random.ts              Seeded RNG helpers.
    news/
      newsGenerator.ts       Debut, injury, release, award, and milestone news.
    season/
      development.ts         Player growth/decline after draft.
      standings.ts           Team strength and yearly standings simulation.
    selectors/
      prospects.ts           Sort/filter/compare helpers for table-heavy UI.
      teams.ts               Derived team views and draft assets.
    simulation/
      gameLoop.ts            Advance draft, offseason, and season phases.
    storage/
      localStorage.ts        Save/load/migrate GameState.
    types/
      common.ts              Shared IDs, grades, ranges, enums.
      draft.ts               Draft classes, picks, boards, results.
      game.ts                Whole persisted game state.
      news.ts                Newsfeed event types.
      player.ts              Prospect/player/scouting types.
      team.ts                Team and roster strength types.
    utils/
      math.ts                Clamp, weighted choice, percentile helpers.
    index.ts                 Public game-core exports.
```

## Design Principles

- Keep the game core as pure TypeScript functions so React components only render state and dispatch actions.
- Persist one `GameState` object in `localStorage`.
- Store hidden talent separately from visible scouting data.
- Make uncertainty first-class: limited-info prospects should be playable and risky, not incomplete objects.
- Treat draft picks as owned assets so future pick trades can add or remove picks without rewriting draft order logic.
- Use derived selectors for sorting, filtering, and comparison instead of baking UI concerns into entities.

## Game State Shape

`GameState` is the single persisted root:

```text
GameState
  meta/version/seed
  phase
  currentYear
  userTeamId
  teams[]
  draftClassesByYear
  draftedPlayersById
  draftHistory[]
  seasonHistory[]
  newsFeed[]
  settings
```

## Year Loop

1. Generate 220 high school prospects for the current draft class.
2. Generate visible scouting quality and uncertainty for each prospect.
3. Build draft order from previous season standings plus traded picks.
4. User drafts for their team; CPU teams draft from rankings and needs.
5. Reveal only initial overall for drafted players.
6. Simulate development, debuts, injuries, releases, awards, and standings.
7. Save newsfeed and season results.
8. Use standings to determine next year's draft order.
9. Roll rare draft-pick trades.

## Hidden Vs Visible Data

Hidden data exists only in `Prospect.trueTalent` before a player is drafted:

- ceiling
- floor
- growth curve
- volatility
- injury proneness
- adaptability
- true position fit

Visible data exists in `Prospect.visible`:

- physical profile
- school stats
- expected rank range
- report confidence
- tool grades with uncertainty
- risk tags
- scout summary

After draft, `DraftedPlayer.revealed.initialOverall` is added, but future ceiling remains hidden.

## UI Boundary

Phase 0 does not implement UI. Later React screens should consume selectors such as:

- `getProspectTableRows`
- `filterProspects`
- `sortProspects`
- `compareProspects`
- `getTeamDraftAssets`
- `getCurrentDraftBoard`
- `getNewsFeedForTeam`

The initial UI can then be dense tables, sortable columns, compact filters, and comparison panels without changing simulation logic.
