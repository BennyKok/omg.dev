import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { ProjectDeployControls } = await import("./project-deploy-controls");

let ui: Mounted;

beforeEach(() => {
  ui = mount();
});

afterEach(() => {
  ui.cleanup();
});

describe("ProjectDeployControls", () => {
  test("deploys a folder, polls until ready, and shows the live URL", async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const published: Array<{ slug: string; url: string }> = [];
    const request = async <T,>(path: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ path, body });
      if (path === "/api/cloud/apps/deploy") {
        expect(body).toEqual({ cwd: "/home/user/project/hello", name: "hello", wait: false });
        return {
          slug: "hello",
          url: "https://hello.omgs.app",
          status: "building",
          projectId: "p1",
        } as T;
      }
      if (path === "/api/cloud/apps/status?slug=hello") {
        return {
          slug: "hello",
          url: "https://hello.omgs.app",
          status: "ready",
          phase: "ready",
        } as T;
      }
      throw new Error(`unexpected ${path}`);
    };

    ui.render(
      <ProjectDeployControls
        cwd="/home/user/project/hello"
        name="hello"
        request={request}
        onDeployed={(info) => published.push(info)}
      />,
    );
    expect(ui.text()).toContain("Deploy");

    await ui.flushAsync(() => (ui.query("button") as HTMLButtonElement).click());

    expect(calls.map((call) => call.path)).toEqual([
      "/api/cloud/apps/deploy",
      "/api/cloud/apps/status?slug=hello",
    ]);
    expect(published).toEqual([{ slug: "hello", url: "https://hello.omgs.app", projectId: "p1", name: "hello" }]);
    expect(ui.text()).toContain("Redeploy");
    const link = ui.query('a[href="https://hello.omgs.app"]');
    expect(link).not.toBeNull();
  });

  test("keeps an existing URL and labels the action Redeploy", async () => {
    ui.render(
      <ProjectDeployControls
        cwd="/repos/site"
        name="site"
        deploy={{ slug: "site", url: "https://site.omgs.app", projectId: "p2" }}
      />,
    );
    expect(ui.text()).toContain("Redeploy");
    expect(ui.query('a[href="https://site.omgs.app"]')).not.toBeNull();
  });
});
