import type { ComponentProps } from "react";
import { Card, SectionLabel } from "../components";
import { ConnectionPingRow } from "./connection-ping-row";
import { ConnectionTimingsRow } from "./connection-timings-row";

export function ConnectionDebugSection(props: ComponentProps<typeof ConnectionPingRow>) {
  return <>
    <SectionLabel>Debug</SectionLabel>
    <Card>
      <ConnectionPingRow {...props} />
      <ConnectionTimingsRow active={props.active} />
    </Card>
  </>;
}
