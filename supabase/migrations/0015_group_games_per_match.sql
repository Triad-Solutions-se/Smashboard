-- Per-group games-per-match override. When set, scoring/validation for that
-- group's matches uses this value instead of tournaments.games_per_match.
-- Null means "use the tournament-level value" (legacy behaviour).
--
-- Use case: uneven group sizes — a 5-team group plays fewer matches per team
-- than a 6-team group, so the host can lengthen the 5-team group's matches
-- to balance total court time per player.

alter table tournament_groups
  add column if not exists games_per_match integer;
