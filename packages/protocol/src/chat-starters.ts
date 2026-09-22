/**
 * The starter prompts an empty composer offers in a chat that has no project.
 *
 * One owner for both clients. iOS draws them as a horizontal card rail and the
 * web app draws them above the composer field, and each client keeps its own
 * icon names because SF Symbols and Lucide do not share a vocabulary. The
 * label, the description and above all the PROMPT must not drift: the prompt
 * is the text the project-builder skill in the chat workspace is written to
 * answer, so a reworded prompt silently changes what the agent does.
 */
export type ChatStarterId = "website" | "app" | "api" | "image";

export type ChatStarter = {
  /** Stable id. Client test ids and icon maps key off this, not the label. */
  id: ChatStarterId;
  label: string;
  description: string;
  /** Sent verbatim, and immediately, as the first message of a new chat. */
  prompt: string;
};

export const CHAT_STARTERS: readonly ChatStarter[] = [
  {
    id: "website",
    label: "Website",
    description: "Design and publish a site",
    prompt: "Help me create a website.",
  },
  {
    id: "app",
    label: "App",
    description: "Build a mobile or web app",
    prompt: "Help me create an app.",
  },
  {
    id: "api",
    label: "API",
    description: "Create an endpoint or service",
    prompt: "Help me create an API.",
  },
  {
    id: "image",
    label: "Image",
    description: "Generate a custom visual",
    prompt: "Help me create an image.",
  },
];
