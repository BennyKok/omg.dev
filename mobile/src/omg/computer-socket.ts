export type ComputerSocketAccess = {
  url: string;
  protocol: string;
};

/** Build the browser websocket address without exposing URL rules to the UI. */
export function computerSocketUrl(baseUrl: string): string {
  const origin = baseUrl.replace(/\/+$/, "").replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${origin}/api/computer`;
}
