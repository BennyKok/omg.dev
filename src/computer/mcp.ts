// The omg.dev Computer MCP — a LOCAL, separate MCP server for the desktop.
//
// Deliberately NOT part of the omg MCP in src/commands/mcp.ts. That catalog is
// the hosted product's contract and ships to cloud sessions, where there is no
// X display, no x11vnc and no Chrome to drive; adding desktop tools there would
// advertise capabilities most sessions cannot use and pay for their schemas in
// every context window. The Computer is a property of THIS box, so it gets its
// own server that an operator attaches only where a desktop actually exists.
//
// Tool names are `computer_*`, not `omg_*`. The omg server rewrites inbound
// `lfg_*` to `omg_*` at the wire boundary, and a separate prefix keeps the two
// catalogs from ever colliding if both are attached to one agent.
//
// Every tool goes through the local serve process over HTTP rather than
// importing desktop.ts directly. This is the important structural choice: the
// desktop's lifecycle state is a module singleton owned by serve, so a tool
// that imported it here (a separate stdio process) would start a SECOND desktop
// on the same display and ports, and neither process would see the other's.
// One owner, reached over the same API the web UI uses.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { localServeBaseUrl } from "../config.ts";

// Mirrors the constant in commands/mcp.ts; there is no shared version module.
const VERSION = "0.1.21";

const COMPUTER_MCP_INSTRUCTIONS = `This server controls the Computer: one shared desktop on this machine, with a real browser running on it.

The desktop is shared, not per-session. A person may be watching it in the omg.dev Computer tab while you work, and they see exactly what you do -- your browsing happens in a visible window on their screen. Call computer_status first; if it is not running, call computer_start.

Browser actions act on one visible tab. Prefer computer_click with a CSS selector over raw coordinates: the selector form waits for the element to be attached, visible, stable and unobscured, while coordinates are a guess about layout. Use computer_read to see page text and computer_screenshot when you need to look at the page.`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${localServeBaseUrl()}${path}`, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

export function buildComputerMcpServer(): McpServer {
  const server = new McpServer(
    { name: "omg-computer", version: VERSION },
    { instructions: COMPUTER_MCP_INSTRUCTIONS },
  );

  server.registerTool(
    "computer_status",
    {
      title: "Computer Status",
      description:
        "Whether the shared desktop is running, its screen size, and which session currently holds it. Also reports missing system packages and the exact command that installs them. Call this before any other computer tool.",
      inputSchema: {},
    },
    async () => result(await api("/api/computer/status")),
  );

  server.registerTool(
    "computer_start",
    {
      title: "Start The Computer",
      description:
        "Bring up the shared desktop: a virtual display, a window manager, the screen stream, and a browser. Idempotent — starting an already-running computer returns its current status rather than a second desktop.",
      inputSchema: {
        width: z.number().int().min(640).max(3840).optional().describe("Screen width in pixels."),
        height: z.number().int().min(480).max(2160).optional().describe("Screen height in pixels."),
        proxy: z
          .string()
          .optional()
          .describe("Upstream proxy for the browser, e.g. http://user:pass@host:port."),
      },
    },
    async (args) => result(await post("/api/computer/start", args)),
  );

  server.registerTool(
    "computer_stop",
    {
      title: "Stop The Computer",
      description:
        "Shut the desktop down and free its resources. Anything open on the screen is lost, so prefer leaving it running if a person may still be watching.",
      inputSchema: {},
    },
    async () => result(await post("/api/computer/stop")),
  );

  server.registerTool(
    "computer_navigate",
    {
      title: "Open A Page",
      description:
        "Point the browser on the desktop at a URL and wait for it to load. Returns the final URL and page title. The tab is brought to the front, so a person watching the screen sees the page you opened.",
      inputSchema: {
        url: z.string().min(1).describe("Absolute URL, including the scheme."),
      },
    },
    async ({ url }) => result(await post("/api/computer/browser/navigate", { url })),
  );

  server.registerTool(
    "computer_click",
    {
      title: "Click In The Page",
      description:
        "Click an element. Prefer `selector`: it waits for the element to be attached, visible, stable for two frames and not covered by anything, and fails loudly when that never happens. Use x and y only when no selector can identify the target. Clicks arrive as real, trusted browser events.",
      inputSchema: {
        selector: z.string().optional().describe("CSS selector for the element to click."),
        x: z.number().optional().describe("Viewport x, only when no selector fits."),
        y: z.number().optional().describe("Viewport y, only when no selector fits."),
      },
    },
    async (args) => result(await post("/api/computer/browser/click", args)),
  );

  server.registerTool(
    "computer_type",
    {
      title: "Type Text",
      description:
        "Type into whatever currently has focus. Click the field first. This inserts text directly rather than simulating individual keystrokes, so use computer_press for Enter, Tab and other named keys.",
      inputSchema: { text: z.string().min(1).describe("Text to insert.") },
    },
    async ({ text }) => result(await post("/api/computer/browser/type", { text })),
  );

  server.registerTool(
    "computer_paste",
    {
      title: "Paste Text",
      description:
        "Paste text into whatever currently has focus. Unlike computer_type this goes through the real clipboard with a trusted Ctrl+V, so paste handlers fire — use it for long text and for fields that react to paste, such as verification-code inputs that split the digits. Click the field first. Plain-http pages block clipboard writes; use computer_type there.",
      inputSchema: { text: z.string().min(1).describe("Text to paste.") },
    },
    async ({ text }) => result(await post("/api/computer/browser/paste", { text })),
  );

  server.registerTool(
    "computer_press",
    {
      title: "Press A Key",
      description:
        "Press a named key, for example Enter, Tab, Escape, Backspace or an arrow key. Use this to submit a form or move focus after computer_type.",
      inputSchema: { key: z.string().min(1).describe("Key name, e.g. Enter or Tab.") },
    },
    async ({ key }) => result(await post("/api/computer/browser/press", { key })),
  );

  server.registerTool(
    "computer_read",
    {
      title: "Read The Page",
      description:
        "The visible text of the current page. Cheaper and more reliable than a screenshot when you need content rather than layout; take a screenshot when you need to see how something looks or where it sits.",
      inputSchema: {},
    },
    async () => result(await post("/api/computer/browser/text")),
  );

  server.registerTool(
    "computer_screenshot",
    {
      title: "Screenshot The Page",
      description:
        "A PNG of the current page, returned as an image you can look at. Use when layout, rendering or the position of an element matters.",
      inputSchema: {},
    },
    async () => {
      const res = await fetch(`${localServeBaseUrl()}/api/computer/browser/screenshot`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`screenshot failed: ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        content: [
          { type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" },
        ],
      };
    },
  );

  return server;
}

/** `omg computer-mcp` — the stdio entry point for the Computer MCP. */
export async function cmdComputerMcp() {
  const server = buildComputerMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`omg computer MCP connected to ${localServeBaseUrl()}`);
}
