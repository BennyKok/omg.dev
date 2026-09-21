import type { OmgMessage } from "@omg-dev/client";
export type SessionArtifact = OmgMessage & { id: string; sessionId: string };

/** Include output outside the loaded transcript window. The server owns this index. */
export async function loadSessionArtifacts(
  request: <T>(path: string) => Promise<T>, sessionId: string | undefined, active: () => boolean = () => true,
): Promise<SessionArtifact[]> {
  const found = new Map<string, SessionArtifact>();
  let offset = 0;
  while (active()) {
    const page = await request<{ artifacts: SessionArtifact[]; total?: number }>(`/api/artifacts?limit=500&offset=${offset}`);
    for (const artifact of page.artifacts) {
      if (!sessionId || artifact.sessionId === sessionId) found.set(artifact.id, artifact);
    }
    offset += page.artifacts.length;
    if (!page.artifacts.length || offset >= (page.total ?? offset)) break;
  }
  return [...found.values()];
}
