-- Slutspel brackets (A/B/C-slutspel etc.)
-- Each KO match now belongs to exactly one bracket, identified by a single
-- letter ('A', 'B', 'C', ...). Group matches keep bracket = NULL.
--
-- Existing tournaments already in flight ran on the old single-bracket model
-- where 1st- and 2nd-place finishers shared one bracket. Backfill them as
-- bracket 'A' so the new code paths render and advance them correctly without
-- a re-seed.

alter table tournament_matches
  add column if not exists bracket text null;

update tournament_matches
  set bracket = 'A'
  where stage in ('quarter_final', 'semi_final', 'bronze', 'final')
    and bracket is null;

create index if not exists tournament_matches_bracket_idx
  on tournament_matches (tournament_id, bracket);
