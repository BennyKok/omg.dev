import { requireOptionalNativeModule } from "expo";
import type { BrowserLoginCookie } from "../../../packages/protocol/src/browser-login";

export const browserLoginNative = requireOptionalNativeModule<{
  open(url: string, computer: string): Promise<{ cancelled: boolean; cookies?: BrowserLoginCookie[] }>;
  close(): Promise<void>;
}>("OmgBrowserLogin");
