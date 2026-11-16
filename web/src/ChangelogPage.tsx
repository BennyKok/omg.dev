import changelogMarkdown from "../../CHANGELOG.md?raw";
import { MessageResponse } from "@/components/ai-elements/message";

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-xl space-y-5 pb-10">
      {/* A phone names the page in its header bar, so the document's own
          "Changelog" heading is hidden there. */}
      <article className="markdown rounded-2xl border border-border bg-card/40 px-4 py-4 max-md:[&_h1]:hidden">
        <MessageResponse>{changelogMarkdown}</MessageResponse>
      </article>
    </div>
  );
}
