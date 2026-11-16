import { describe, expect, test } from "bun:test";
import { groupByComputer, hasSeveralComputers, readClosedComputers, writeClosedComputers } from "./computer-groups";

type Row = { id: string; peer?: { id: string; name: string } };
const peerOf = (row: Row) => row.peer ?? null;
const studio = { id: "p1", name: "studio" };
const laptop = { id: "p2", name: "laptop" };

describe("groupByComputer", () => {
  test("a list with only local chats is one group, so it gains no level", () => {
    const groups = groupByComputer<Row>([{ id: "a" }, { id: "b" }], peerOf, "This computer");
    expect(groups.map((g) => g.id)).toEqual(["local"]);
    expect(hasSeveralComputers(groups)).toBe(false);
  });

  test("this computer is first, then linked computers by name, each with its own chats in order", () => {
    const rows: Row[] = [{ id: "s1", peer: studio }, { id: "a" }, { id: "l1", peer: laptop }, { id: "s2", peer: studio }, { id: "b" }];
    const groups = groupByComputer(rows, peerOf, "This computer");
    expect(groups.map((g) => [g.name, g.items.map((r) => r.id)])).toEqual([
      ["This computer", ["a", "b"]],
      ["laptop", ["l1"]],
      ["studio", ["s1", "s2"]],
    ]);
    expect(hasSeveralComputers(groups)).toBe(true);
  });

  test("this computer keeps its place when it has no chats, and a nameless computer shows its id", () => {
    const groups = groupByComputer<Row>([{ id: "x", peer: { id: "p9", name: "" } }], peerOf, "This computer");
    expect(groups.map((g) => [g.name, g.items.length])).toEqual([["This computer", 0], ["p9", 1]]);
  });
});

describe("closed computers", () => {
  test("the choice survives a reload, and a broken value reads as nothing closed", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect([...readClosedComputers(storage)]).toEqual([]);
    writeClosedComputers(storage, new Set(["p2", "local"]));
    expect([...readClosedComputers(storage)].sort()).toEqual(["local", "p2"]);
    store.set("lfg_computer_groups_closed", "{not json");
    expect([...readClosedComputers(storage)]).toEqual([]);
    expect([...readClosedComputers(null)]).toEqual([]);
  });
});
