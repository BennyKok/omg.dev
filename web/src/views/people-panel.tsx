/**
 * SETTINGS > PEOPLE & ROLES > PEOPLE. One row per person who uses this
 * computer: who they are, what Tailscale calls them when the server has seen
 * them sign in, and the role they have.
 *
 * The same facts used to be in three places: the profile picker ("Who are
 * you?"), the member list inside each role, and nowhere at all for Tailscale.
 * To answer "what can Angel do here" you opened every role and looked for
 * her address. This is the list by person. A role is still changed through
 * /api/roles, its one owner (src/policy/roles.ts): picking a role here edits
 * that role's member list.
 */
import { useCallback, useEffect, useState } from "react";
import { omgFetch } from "@/lib/omg-client";
import { SettingsGroup, SettingsRow, SettingsSelect } from "@/components/settings-ui";

export type Person = {
  email: string;
  name: string;
  avatar: string;
  role: { id: string; name: string };
  tailscale: { name: string | null; lastSeenAt: number } | null;
};

export type PeopleAnswer = {
  identityMode: "tailscale" | "profile";
  viewer: { login: string; name: string | null; verified: boolean } | null;
  people: Person[];
};

type RoleSummary = { id: string; name: string; members: string[] };

const OWNER = "owner";

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await omgFetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/**
 * The member-list edits that give `email` the role `roleId`. Owner is "in no
 * role", so it is one edit that removes the address from the role it is in.
 * Any other role is one edit that adds it; the server removes it elsewhere.
 */
export function roleEdits(roles: readonly RoleSummary[], email: string, roleId: string): { id: string; members: string[] }[] {
  const address = email.trim().toLowerCase();
  if (roleId === OWNER) {
    return roles
      .filter((role) => role.members.includes(address))
      .map((role) => ({ id: role.id, members: role.members.filter((member) => member !== address) }));
  }
  const target = roles.find((role) => role.id === roleId);
  if (!target || target.members.includes(address)) return [];
  return [{ id: target.id, members: [...target.members, address] }];
}

/** The line under a person's name. */
export function personDetail(person: Person, viewer: PeopleAnswer["viewer"]): string {
  const parts = [person.email];
  if (person.tailscale) parts.push(`Tailscale: ${person.tailscale.name || "signed in"}`);
  else if (viewer && viewer.login === person.email.toLowerCase()) {
    parts.push(viewer.verified ? "Tailscale: you" : "Tailscale: you (not checked on this address)");
  }
  return parts.join(" · ");
}

export function PeoplePanel() {
  const [answer, setAnswer] = useState<PeopleAnswer | null>(null);
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [people, roleList] = await Promise.all([
      getJson<PeopleAnswer>("/api/people"),
      getJson<{ roles: RoleSummary[] }>("/api/roles"),
    ]);
    setAnswer(people);
    setRoles(roleList.roles);
  }, []);
  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [load]);

  const setRole = async (person: Person, roleId: string) => {
    if (busy) return;
    setBusy(person.email);
    setError(null);
    try {
      for (const edit of roleEdits(roles, person.email, roleId)) {
        await getJson(`/api/roles/${edit.id}`, { method: "PATCH", body: JSON.stringify({ members: edit.members }) });
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6" data-testid="people-panel">
      {error ? <p role="alert" className="px-1 text-sm text-destructive">{error}</p> : null}
      <SettingsGroup
        label="People on this computer"
        footer={
          answer?.identityMode === "tailscale"
            ? "A person signs in with Tailscale. Only the people in this list can open this computer from the tailnet."
            : "Each person picks their profile in the browser. To sign people in with Tailscale, see docs/user-accounts.md."
        }
      >
        {answer === null && !error ? (
          // The list's place is kept while it loads, so the note under it does not jump.
          <SettingsRow title="Loading people…" reserveDescription />
        ) : null}
        {answer?.people.length === 0 ? <SettingsRow title="No profiles yet" description="A profile is made in the setup guide." /> : null}
        {answer?.people.map((person) => (
          <div key={person.email} data-person={person.email}>
            <SettingsRow
              icon={<img src={person.avatar} alt="" className="size-8 shrink-0 rounded-full border border-border object-cover" />}
              title={person.name || person.email}
              description={personDetail(person, answer.viewer)}
              descriptionClassName="truncate"
              trailing={
                <SettingsSelect
                  aria-label={`Role of ${person.name || person.email}`}
                  value={person.role.id}
                  disabled={busy !== null}
                  onChange={(next) => void setRole(person, next)}
                >
                  <option value={OWNER}>Owner</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </SettingsSelect>
              }
            />
          </div>
        ))}
      </SettingsGroup>
    </div>
  );
}
