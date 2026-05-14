import { describe, it, expect } from "vitest";
import { loadTuning } from "../src/tuning.js";
import { isVisible, filterObject, filterPlayers } from "../src/visibility.js";

const tuning = loadTuning();

describe("visibility", () => {
  it("Admin sees admin-only fields; Standard does not", () => {
    expect(isVisible(tuning, "Admin", "company.fairValue")).toBe(true);
    expect(isVisible(tuning, "Admin", "company.qualityScore")).toBe(true);
    expect(isVisible(tuning, "Admin", "session.rngCursor")).toBe(true);

    expect(isVisible(tuning, "Standard", "company.fairValue")).toBe(false);
    expect(isVisible(tuning, "Standard", "company.qualityScore")).toBe(false);
    expect(isVisible(tuning, "Standard", "session.rngCursor")).toBe(false);
  });

  it("Standard sees public fields", () => {
    expect(isVisible(tuning, "Standard", "company.price")).toBe(true);
    expect(isVisible(tuning, "Standard", "company.volume")).toBe(true);
    expect(isVisible(tuning, "Standard", "leaderboard.basic")).toBe(true);
    expect(isVisible(tuning, "Standard", "events.publicFeed")).toBe(true);
  });

  it("unknown roles see nothing (deny by default)", () => {
    expect(isVisible(tuning, "Mystery", "company.price")).toBe(false);
  });

  it("unknown fields are hidden by default", () => {
    expect(isVisible(tuning, "Standard", "company.unspecifiedField")).toBe(false);
    expect(isVisible(tuning, "Admin", "company.unspecifiedField")).toBe(false);
  });

  it("filterObject strips hidden keys, keeps structural ones", () => {
    const company = {
      symbol: "ACME",       // structural — no path mapping
      price: 100,
      fairValue: 95,
      qualityScore: 0.7,
    };
    const std = filterObject(tuning, "Standard", company, {
      symbol: "" as never, // not used
      price: "company.price",
      fairValue: "company.fairValue",
      qualityScore: "company.qualityScore",
    } as Record<keyof typeof company & string, string>);
    // Note: symbol mapped to "" is treated as a valid path (and missing from
    // visibility map → hidden). Use the no-mapping form by omitting the key:
    const std2 = filterObject(tuning, "Standard", company, {
      price: "company.price",
      fairValue: "company.fairValue",
      qualityScore: "company.qualityScore",
    } as Record<string, string>);
    expect(std2).toEqual({ symbol: "ACME", price: 100 });
    expect(std).not.toHaveProperty("fairValue");
  });

  it("filterPlayers gives Standard their own slice but not others'", () => {
    const players = [
      { playerId: "p1", cash: 100 },
      { playerId: "p2", cash: 200 },
      { playerId: "p3", cash: 300 },
    ];
    const stdView = filterPlayers(tuning, { role: "Standard", playerId: "p2" }, players);
    expect(stdView).toEqual([{ playerId: "p2", cash: 200 }]);

    const adminView = filterPlayers(tuning, { role: "Admin", playerId: "p2" }, players);
    expect(adminView).toHaveLength(3);
  });
});
