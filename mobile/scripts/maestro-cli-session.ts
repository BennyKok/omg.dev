import type { McpSession } from "./maestro-mcp";

/** MCP currently drops --driver-host-port. Use the CLI when isolation is needed. */
export function isolatedMaestroSession(host: string, remoteEnv: string, deviceId: string, port: number): McpSession {
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const command = `maestro --driver-host-port ${port} --udid ${quote(deviceId)}`;
  let sequence = 0;
  async function ssh(script: string, input?: string) {
    const child = Bun.spawn(["ssh", "-o", "BatchMode=yes", host, `${remoteEnv} ${script}`], {
      stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe",
    });
    const [out, error, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { ok: code === 0, text: out + error };
  }
  const compact = (node: any): any => {
    const a = node.attributes ?? {};
    return { a11y: a.accessibilityText || a.title || a.value, txt: a.text, val: a.value, hint: a.hintText, rid: a.resourceId,
      b: a.bounds, enabled: a.enabled !== false && a.enabled !== "false",
      focused: a.focused === true || a.focused === "true", selected: a.selected === true || a.selected === "true",
      c: (node.children ?? []).map(compact) };
  };
  return {
    async inspect() {
      const result = await ssh(`${command} hierarchy --no-reinstall-driver`);
      if (!result.ok) throw new Error(result.text.slice(-1000));
      const start = result.text.indexOf("{");
      const end = result.text.lastIndexOf("}");
      return compact(JSON.parse(result.text.slice(start, end + 1)));
    },
    async run(yaml, env) {
      const path = `/tmp/omg-maestro-${process.pid}-${++sequence}.yaml`;
      const vars = Object.entries(env ?? {}).map(([key, value]) => `-e ${quote(`${key}=${value}`)}`).join(" ");
      return ssh(`trap 'rm -f ${path}' EXIT; cat > ${path}; ${command} test --no-reinstall-driver ${vars} ${path}`, yaml);
    },
    close() {},
  };
}
