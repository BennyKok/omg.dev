/**
 * Read an omg sign-in code from the test mailbox.
 *
 * Reuses the mail MCP's own Gmail credentials (~/.config/mail-mcp), so there is
 * exactly one place a Gmail refresh token lives on this box. The MCP is a
 * stdio server, which a script cannot call, so this imports its library code
 * directly from where the MCP is installed.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const MAIL_MCP = process.env.OMG_MAIL_MCP_DIR ?? join(homedir(), ".local/share/mail-mcp/src");

export type OtpMail = { code: string; date: string };

export async function readSignInCode(
  mailbox: string,
  to: string,
  opts: { notBefore: Date; timeoutMs?: number; intervalMs?: number } = { notBefore: new Date() },
): Promise<OtpMail> {
  const { getAccount } = await import(join(MAIL_MCP, "accounts.ts"));
  const { searchMessages } = await import(join(MAIL_MCP, "gmail.ts"));
  const rec = getAccount(mailbox);
  if (!rec) throw new Error(`Mailbox ${mailbox} is not linked in mail-mcp. Run: bun ${MAIL_MCP}/cli.ts auth --email ${mailbox}`);
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  const interval = opts.intervalMs ?? 8_000;
  for (;;) {
    const found = await searchMessages(rec, `to:${to} subject:"sign-in code" newer_than:1h`, 3);
    const messages: { subject?: string | null; date?: string | null }[] = Array.isArray(found) ? found : (found?.messages ?? []);
    for (const m of messages) {
      const when = m.date ? new Date(m.date) : null;
      const code = m.subject?.match(/\b(\d{6})\b/)?.[1];
      // Only a code sent for THIS run counts. An older one is a previous run's.
      if (code && when && when.getTime() >= opts.notBefore.getTime() - 60_000) {
        return { code, date: m.date! };
      }
    }
    if (Date.now() >= deadline) throw new Error(`No sign-in code for ${to} within ${Math.round((opts.timeoutMs ?? 120_000) / 1000)}s.`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
