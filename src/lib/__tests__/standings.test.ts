import { describe, it, expect } from "vitest";
import { computeStandings } from "../standings";
import type { TournamentMatch, TournamentTeam, Player } from "../supabase/types";

const team = (id: string): TournamentTeam =>
  ({
    id,
    player1_id: `${id}-p1`,
    player2_id: `${id}-p2`,
    tournament_id: "t1",
    group_id: "g1",
    seed: null,
  } as TournamentTeam);

const match = (
  id: string,
  t1: string,
  t2: string,
  s1: number,
  s2: number
): TournamentMatch =>
  ({
    id,
    tournament_id: "t1",
    group_id: "g1",
    round_number: 1,
    court_id: null,
    team1_id: t1,
    team2_id: t2,
    score_team1: s1,
    score_team2: s2,
    status: "completed",
    stage: "group",
    bracket: null,
    created_at: "",
  } as TournamentMatch);

const players = new Map<string, Player>();

describe("computeStandings — 0-0 completed match", () => {
  it("0-0 completed match does not count as played", () => {
    const teams = [team("A"), team("B")];
    const matches = [match("1", "A", "B", 0, 0)];
    const standings = computeStandings(teams, matches, players);
    expect(standings.find((s) => s.team_id === "A")?.mp).toBe(0);
    expect(standings.find((s) => s.team_id === "B")?.mp).toBe(0);
  });

  it("1-0 still counts (any real game played)", () => {
    const teams = [team("A"), team("B")];
    const matches = [match("1", "A", "B", 1, 0)];
    const standings = computeStandings(teams, matches, players);
    expect(standings.find((s) => s.team_id === "A")?.mp).toBe(1);
    expect(standings.find((s) => s.team_id === "B")?.mp).toBe(1);
  });
});

describe("computeStandings — GF-first sort (games-only model, intentional)", () => {
  it("ranks by gf desc, then gd desc, then ga asc", () => {
    const teams = [team("A"), team("B"), team("C")];
    const matches = [
      // A: GF=10, GA=4
      match("1", "A", "B", 5, 2),
      match("2", "A", "C", 5, 2),
      // B: GF=7, GA=8
      match("3", "B", "C", 5, 1),
      // C: GF=5, GA=15
    ];
    const standings = computeStandings(teams, matches, players);
    expect(standings.map((s) => s.team_id)).toEqual(["A", "B", "C"]);
  });
});
