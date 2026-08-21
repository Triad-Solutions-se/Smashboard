import { describe, it, expect } from "vitest";
import { courtsForStage } from "../knockout";
import type { Court } from "../../supabase/types";

const courts: Court[] = ["a", "b", "c", "d"].map((id, i) => ({
  id,
  tenant_id: "t",
  name: `Bana ${i + 1}`,
  sort_order: i,
}));

const selection = {
  qf_court_ids: ["c", "a"],
  sf_court_ids: ["b"],
  final_court_ids: ["d"],
};

describe("courtsForStage", () => {
  it("returns the courts the host assigned to each stage", () => {
    expect(courtsForStage("quarter_final", selection, courts)?.map((c) => c.id)).toEqual(["a", "c"]);
    expect(courtsForStage("semi_final", selection, courts)?.map((c) => c.id)).toEqual(["b"]);
    expect(courtsForStage("final", selection, courts)?.map((c) => c.id)).toEqual(["d"]);
  });

  it("keeps venue court order, not the order the ids were stored in", () => {
    // qf_court_ids is ["c","a"] but court order is a,b,c,d.
    expect(courtsForStage("quarter_final", selection, courts)?.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("runs the bronze match on the final's courts", () => {
    expect(courtsForStage("bronze", selection, courts)?.map((c) => c.id)).toEqual(["d"]);
  });

  it("returns null when a stage was left blank, so callers keep their fallback", () => {
    expect(courtsForStage("quarter_final", {}, courts)).toBeNull();
    expect(courtsForStage("semi_final", { sf_court_ids: [] }, courts)).toBeNull();
    expect(courtsForStage("final", { final_court_ids: null }, courts)).toBeNull();
  });

  it("returns null when every stored court has since been deleted", () => {
    const stale = { qf_court_ids: ["gone", "also-gone"] };
    expect(courtsForStage("quarter_final", stale, courts)).toBeNull();
  });

  it("drops deleted courts but keeps the rest", () => {
    const partial = { qf_court_ids: ["a", "gone", "d"] };
    expect(courtsForStage("quarter_final", partial, courts)?.map((c) => c.id)).toEqual(["a", "d"]);
  });

  it("has nothing to say about group matches", () => {
    expect(courtsForStage("group", selection, courts)).toBeNull();
  });
});
