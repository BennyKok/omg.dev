/**
 * The auto agents whose working folder belongs in the folder list.
 *
 * Every auto agent used to add its folder, so an agent switched off months
 * ago kept a folder such as "lfg-6cda09" or "ad-user-return" in the phone's
 * Folders page and the folder menu with nothing in it (owner, 2026-11-18).
 * A switched-off agent still lists on the Schedules page; it only stops
 * naming a folder. A running one counts even while switched off, because its
 * work is happening now.
 */
export function agentsThatNameFolders<T extends { enabled?: boolean; running?: boolean }>(agents: readonly T[]): T[] {
  return agents.filter((agent) => agent.enabled !== false || agent.running === true);
}
