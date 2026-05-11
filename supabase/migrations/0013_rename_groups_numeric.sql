-- Rename existing tournament groups from letter-style (Grupp A, Grupp B, …)
-- to numeric (Grupp 1, Grupp 2, …) so the UI and DB stay consistent with
-- the new generator. sort_order is 0-indexed, so add 1 to land on Grupp N.
--
-- Idempotent: re-runs against already-numeric names are a no-op since the
-- pattern match excludes anything that isn't "Grupp <single letter>".

update tournament_groups
   set name = 'Grupp ' || (sort_order + 1)
 where name ~ '^Grupp [A-Z]$';
