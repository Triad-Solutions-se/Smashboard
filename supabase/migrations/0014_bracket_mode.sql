-- Bracket mode: 'single' = one unified bracket across all advancing teams
-- (e.g. 4 groups × 2 advance → 8-team QF). 'split' = per-rank brackets
-- (e.g. 4 groups × 4 advance → A-slutspel + B-slutspel, each with 8 teams).
--
-- Default 'single' for new tournaments. Existing rows are backfilled to
-- 'split' so already-running tournaments keep their A/B/C bracket layout
-- and don't suddenly collapse to one.

alter table tournaments
  add column if not exists bracket_mode text not null default 'single';

update tournaments
  set bracket_mode = 'split'
  where created_at < now()
    and bracket_mode = 'single'
    and exists (
      select 1 from tournament_matches tm
      where tm.tournament_id = tournaments.id
        and tm.bracket is not null
        and tm.bracket <> 'A'
    );
