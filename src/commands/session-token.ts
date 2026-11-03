import { rotateSessionTokenSecret, sessionTokenSecretStatus, SESSION_TOKEN_GRACE_MS } from "../policy/session-token-secret.ts";

export function cmdSessionToken(argv: string[]): void {
  const [action, ...flags] = argv;
  if (action === "status" && flags.length === 0) {
    console.log(JSON.stringify(sessionTokenSecretStatus(), null, 2));
    return;
  }
  if (action === "rotate" && (flags.length === 0 || (flags.length === 2 && flags[0] === "--grace-seconds"))) {
    const graceMs = flags.length ? Number(flags[1]) * 1000 : SESSION_TOKEN_GRACE_MS;
    console.log(JSON.stringify(rotateSessionTokenSecret(graceMs), null, 2));
    return;
  }
  throw new Error("Usage: omg session-token status | rotate [--grace-seconds 3600]");
}
