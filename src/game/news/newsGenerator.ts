import type { NewsItem } from "../types/news";
import type { DraftedPlayer } from "../types/player";
import type { NewsId } from "../types/common";

export function createDraftNews(year: number, week: number, player: DraftedPlayer): NewsItem {
  return {
    id: `news-${year}-${week}-${player.id}` as NewsId,
    year,
    week,
    type: "draft",
    teamId: player.teamId,
    playerId: player.id,
    headline: `${player.name} draft selection`,
    body: `${player.name} was selected and revealed at ${player.revealed.initialOverall} overall.`,
    importance: player.revealed.initialOverall >= 60 ? 4 : 2,
  };
}
