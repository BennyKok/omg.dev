import { connect } from "node:net";

export type IosDevice = { udid: string; name: string };

export function devicesFromUsbmux(value: unknown): IosDevice[] {
  const rows = (value as { DeviceList?: unknown[] } | null)?.DeviceList;
  if (!Array.isArray(rows)) throw new Error("The Mac did not return its connected devices.");
  const devices = new Map<string, IosDevice>();
  for (const row of rows) {
    const props = (row as { Properties?: Record<string, unknown> } | null)?.Properties;
    if (props?.ConnectionType !== "USB" || typeof props.SerialNumber !== "string") continue;
    if (!/^[A-Za-z0-9-]{1,128}$/.test(props.SerialNumber)) continue;
    const udid = props.SerialNumber.toUpperCase();
    devices.set(udid, { udid, name: "iPhone or iPad" });
  }
  return [...devices.values()];
}

export async function listUsbIosDevices(socketPath = "/var/run/usbmuxd"): Promise<IosDevice[]> {
  if (process.platform !== "darwin") return [];
  const xml = Buffer.from(`<?xml version="1.0"?><plist version="1.0"><dict><key>MessageType</key><string>ListDevices</string><key>ClientVersionString</key><string>omg.dev</string><key>ProgName</key><string>omg.dev</string><key>kLibUSBMuxVersion</key><integer>3</integer></dict></plist>`);
  const header = Buffer.alloc(16);
  header.writeUInt32LE(16 + xml.length, 0);
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(8, 8);
  header.writeUInt32LE(1, 12);
  const body = await new Promise<Buffer>((resolve, reject) => {
    const socket = connect(socketPath);
    const chunks: Buffer[] = [];
    let bytes = 0;
    let total = 0;
    const fail = () => { socket.destroy(); reject(new Error("Connect your iPhone to this Mac, then try again.")); };
    socket.setTimeout(5_000, fail);
    socket.on("error", fail);
    socket.on("end", () => { if (!total || bytes < total) fail(); });
    socket.on("connect", () => socket.write(Buffer.concat([header, xml])));
    socket.on("data", (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      bytes += chunk.length;
      if (bytes > 1024 * 1024) return fail();
      chunks.push(chunk);
      const message = Buffer.concat(chunks);
      if (!total && message.length >= 16) {
        total = message.readUInt32LE(0);
        if (total < 16 || total > 1024 * 1024 || message.readUInt32LE(4) !== 1 || message.readUInt32LE(8) !== 8) return fail();
      }
      if (total && bytes >= total) { socket.destroy(); resolve(message.subarray(16, total)); }
    });
  });
  const plutil = Bun.spawn(["/usr/bin/plutil", "-convert", "json", "-o", "-", "--", "-"], {
    stdin: body, stdout: "pipe", stderr: "ignore",
  });
  const text = await new Response(plutil.stdout).text();
  if (await plutil.exited !== 0) throw new Error("The Mac could not read its connected devices.");
  return devicesFromUsbmux(JSON.parse(text));
}
