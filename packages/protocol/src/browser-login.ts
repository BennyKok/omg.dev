/** Public login state. Cookie values and claim tokens never appear here. */
export interface BrowserLoginRequest {
  id: string;
  sessionId: string;
  url: string;
  origin: string;
  computerName: string;
  reason: string;
  status: "pending" | "in_progress" | "importing" | "imported" | "cancelled" | "expired" | "failed";
  createdAt: number;
  expiresAt: number;
  cookieCount?: number;
  agentNotified?: boolean;
  message?: string;
}

export interface BrowserLoginSnapshot {
  requests: BrowserLoginRequest[];
  iosAvailable: boolean;
  desktopAvailable: boolean;
}

/** Sent only by the approved native sheet over the computer transport. */
export interface BrowserLoginCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number;
  sameSite?: "Strict" | "Lax" | "None";
}
