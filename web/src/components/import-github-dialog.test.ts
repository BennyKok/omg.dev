// "From GitHub" accepts the short owner/repo form people copy from a GitHub
// page. The server only clones https:// and git@ addresses, so the short form
// must become a GitHub address, and a full address must pass unchanged.
import { expect, test } from "bun:test";
import { repositoryUrl } from "./import-github-dialog";

test("owner/repo becomes a GitHub address; full addresses pass through", () => {
  expect(repositoryUrl(" BennyKok/omg.dev ")).toBe("https://github.com/BennyKok/omg.dev.git");
  expect(repositoryUrl("https://github.com/a/b")).toBe("https://github.com/a/b");
  expect(repositoryUrl("git@github.com:a/b.git")).toBe("git@github.com:a/b.git");
});
