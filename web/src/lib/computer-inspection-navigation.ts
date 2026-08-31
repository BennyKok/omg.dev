import { omgFetch } from "./omg-client";

type InspectionFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function navigateComputerToInspectionTarget(
  pageUrl: string | null | undefined,
  fetcher: InspectionFetch = omgFetch,
): Promise<{ url: string; title: string } | null> {
  if (!pageUrl) return null;
  const url = new URL(pageUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Design Mode can only open http or https pages");
  }

  const response = await fetcher("/api/computer/browser/navigate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.toString() }),
  });
  if (!response.ok) {
    throw new Error((await response.text()) || "could not open the session page");
  }
  return (await response.json()) as { url: string; title: string };
}
