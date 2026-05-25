import type {
  TournamentMatch,
  TournamentTeam,
  TournamentGroup,
  Player,
} from "./supabase/types";

export function stageLabel(
  match: TournamentMatch,
  groups: Map<string, TournamentGroup>
): string {
  switch (match.stage) {
    case "quarter_final":
      return "Kvartsfinal";
    case "semi_final":
      return "Semifinal";
    case "bronze":
      return "Bronsmatch";
    case "final":
      return "Final";
    case "group":
    default:
      return match.group_id ? (groups.get(match.group_id)?.name ?? "Grupp") : "Grupp";
  }
}

export type TeamStanding = {
  team_id: string;
  teamName: string;
  mp: number;
  gf: number;
  ga: number;
  gd: number;
};

export function teamName(
  team: TournamentTeam,
  players: Map<string, Player>
): string {
  const p1 = players.get(team.player1_id);
  const p2 = team.player2_id ? players.get(team.player2_id) : null;
  return `${p1?.name ?? "?"} & ${p2?.name ?? "?"}`;
}

export function shortName(player: Player | undefined | null): string {
  if (!player) return "?";
  const parts = player.name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function shortTeamName(
  team: TournamentTeam,
  players: Map<string, Player>
): string {
  const p2 = team.player2_id ? players.get(team.player2_id) : null;
  return `${shortName(players.get(team.player1_id))} & ${shortName(p2)}`;
}

export function computeStandings(
  teams: TournamentTeam[],
  matches: TournamentMatch[],
  players: Map<string, Player>
): TeamStanding[] {
  const map = new Map<string, TeamStanding>();
  for (const t of teams) {
    map.set(t.id, {
      team_id: t.id,
      teamName: teamName(t, players),
      mp: 0,
      gf: 0,
      ga: 0,
      gd: 0,
    });
  }
  const h2h = new Map<string, Map<string, number>>();
  const bumpH2H = (a: string, b: string, diff: number) => {
    let inner = h2h.get(a);
    if (!inner) {
      inner = new Map();
      h2h.set(a, inner);
    }
    inner.set(b, (inner.get(b) ?? 0) + diff);
  };
  for (const m of matches) {
    if (m.status !== "completed") continue;
    if (m.score_team1 == null || m.score_team2 == null) continue;
    // 0-0 has no domain meaning (no walkover feature). Treat as not played
    // so an accidental complete-without-score doesn't inflate matches-played.
    if (m.score_team1 === 0 && m.score_team2 === 0) continue;
    const t1 = map.get(m.team1_id);
    const t2 = map.get(m.team2_id);
    if (!t1 || !t2) continue;
    t1.mp++;
    t2.mp++;
    t1.gf += m.score_team1;
    t1.ga += m.score_team2;
    t2.gf += m.score_team2;
    t2.ga += m.score_team1;
    const diff = m.score_team1 - m.score_team2;
    bumpH2H(m.team1_id, m.team2_id, diff);
    bumpH2H(m.team2_id, m.team1_id, -diff);
  }
  for (const s of map.values()) {
    s.gd = s.gf - s.ga;
  }
  const headToHead = (aId: string, bId: string): number => {
    return h2h.get(aId)?.get(bId) ?? 0;
  };
  return [...map.values()].sort(
    (a, b) =>
      b.gf - a.gf ||
      b.gd - a.gd ||
      a.ga - b.ga ||
      headToHead(b.team_id, a.team_id) ||
      a.team_id.localeCompare(b.team_id)
  );
}
