/** Build the read-only artifact URL understood by the hosted session proxy. */
export function signedArtifactUrl(origin: string, path: string, grant: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${origin.replace(/\/+$/, "")}${normalized}`);
  url.searchParams.set("__omg_grant", grant);
  return url.toString();
}
