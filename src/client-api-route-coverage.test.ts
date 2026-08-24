// A general guard: every /api path the browser bundle can request must be a
// path this server actually routes.
//
// The bug that produced this test: 8841a1a ("refactor(serve): delete dead HTTP
// routes and their subsystems") removed POST /api/evlog on the stated grounds
// that it had zero callers. web/src had 16. Because the client posts
// fire-and-forget and swallows the rejection, the only symptom was a 404 in the
// network panel, twelve of them in one browser session, and nothing failed for
// three weeks.
//
// Nothing else in the suite compares the two sides of the HTTP contract, so a
// route deletion is invisible to CI. This closes that gap for every route, not
// only for evlog.
//
// How the comparison works. Both sides are reduced to the literal head of a
// path, because neither side's dynamic segment is knowable from source.
//   Client: every "/api/..." string or template literal in web/src, truncated
//           at the first interpolation, query string, or fragment.
//   Server: every literal route string in serve.ts, plus the literal head of
//           every /^\/api\/.../ route pattern (for example
//           /^\/api\/bots\/([a-z0-9_-]+)$/ contributes "/api/bots/").
// A client path is served when it is a literal route, or when it sits on either
// side of a route pattern's head. That last rule is deliberately permissive
// about the value of a dynamic segment and strict about everything before it,
// which is exactly the level at which a deleted route shows up.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const SRC = dirname(new URL(import.meta.url).pathname);
const WEB_SRC = join(SRC, "..", "web", "src");
const SERVE = readFileSync(join(SRC, "commands", "serve.ts"), "utf8");

// Paths the local server answers from somewhere other than serve.ts's router.
// Keep this empty unless there is a real second owner, and name that owner here.
const ROUTED_ELSEWHERE = new Set<string>();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "dist-lib") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|release-check)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const WEB_FILES = walk(WEB_SRC);

function rel(file: string): string {
  return file.slice(WEB_SRC.length + 1);
}

// Truncate at the first thing that is not literal path text: a template
// interpolation, a `{id}`-style placeholder in prose, a query string, or a
// fragment. Then drop any trailing slash so "/api/sessions/" and
// "/api/sessions" compare equal.
function pathKey(raw: string): string {
  return raw.split(/\$\{|\{|\?|#/)[0].replace(/\/+$/, "");
}

function clientApiPaths(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of WEB_FILES) {
    for (const match of readFileSync(file, "utf8").matchAll(/["'`](\/api\/[^"'`\n]*)["'`]/g)) {
      const key = pathKey(match[1]);
      // "/api" on its own carries no route information.
      if (key.length <= "/api/".length) continue;
      if (!found.has(key)) found.set(key, new Set());
      found.get(key)!.add(rel(file));
    }
  }
  return found;
}

function serverLiteralRoutes(): Set<string> {
  const out = new Set<string>();
  for (const match of SERVE.matchAll(/["'`](\/api\/[a-zA-Z0-9/_-]*)["'`]/g)) out.add(pathKey(match[1]));
  return out;
}

// The literal head of each route pattern, always ending in "/", e.g.
// /^\/api\/coding-agents\/([a-z0-9_-]+)\/auth$/ gives "/api/coding-agents/".
function serverPatternHeads(): Set<string> {
  const out = new Set<string>();
  for (const match of SERVE.matchAll(/\/\^\\\/api[^\n]*?\$\//g)) {
    const plain = match[0].slice(1, -1).replace(/\\\//g, "/").replace(/^\^/, "");
    const head = plain.split(/[([{|+*?]/)[0];
    if (head.endsWith("/")) out.add(head);
  }
  return out;
}

describe("client API paths are all served", () => {
  const paths = clientApiPaths();
  const literals = serverLiteralRoutes();
  const heads = serverPatternHeads();

  function isServed(key: string): boolean {
    if (literals.has(key)) return true;
    const withSlash = `${key}/`;
    // The client path sits under a route pattern, or names the pattern's
    // parent collection.
    for (const head of heads) {
      if (withSlash.startsWith(head) || head.startsWith(withSlash)) return true;
    }
    return false;
  }

  // A refactor that hid every fetch behind a helper, or a regex that stopped
  // matching, would silently empty this test. Fail loudly rather than pass on
  // nothing.
  test("the scan finds both sides of the contract", () => {
    expect(paths.size).toBeGreaterThan(15);
    expect(literals.size).toBeGreaterThan(40);
    expect(heads.size).toBeGreaterThan(5);
  });

  test("every /api path in web/src has a matching route in serve.ts", () => {
    const missing: string[] = [];
    for (const [key, files] of [...paths].sort()) {
      if (ROUTED_ELSEWHERE.has(key)) continue;
      if (!isServed(key)) missing.push(`${key}  (used in ${[...files].sort().join(", ")})`);
    }
    expect(missing, `client paths with no server route:\n${missing.join("\n")}`).toEqual([]);
  });

  // Proves the guard can still fail. Without this, a broken matcher would make
  // the test above pass forever.
  test("the guard rejects a path the server does not route", () => {
    expect(isServed("/api/definitely-not-a-route")).toBe(false);
    expect(isServed("/api/evlog-not-a-route")).toBe(false);
  });
});

// The specific regression, pinned separately so a failure names its cause
// instead of being one line in a list.
describe("POST /api/evlog", () => {
  test("the server routes it", () => {
    const at = SERVE.indexOf('if (path === "/api/evlog")');
    expect(at, "no /api/evlog route in serve.ts").toBeGreaterThanOrEqual(0);
    const handler = SERVE.slice(at, at + 1500);
    expect(handler).toContain('if (req.method !== "POST") return err(405, "method not allowed")');
    expect(handler).toContain("evlog(event, {");
  });

  test("the client helper has exactly one owner", () => {
    const definitions = WEB_FILES.filter((f) => /function evlog\s*\(/.test(readFileSync(f, "utf8"))).map(rel);
    expect(definitions).toEqual([join("lib", "evlog.ts")]);
  });

  test("nothing in web/src posts to /api/evlog except that one owner", () => {
    const posters = WEB_FILES.filter((f) => readFileSync(f, "utf8").includes("/api/evlog")).map(rel);
    expect(posters).toEqual([join("lib", "evlog.ts")]);
  });
});
