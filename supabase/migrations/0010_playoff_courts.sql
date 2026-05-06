-- Playoff court assignments per stage
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS qf_court_ids   text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sf_court_ids   text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS final_court_ids text[] DEFAULT '{}';
