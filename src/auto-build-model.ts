import { isMachineMessage } from "../packages/protocol/src/machine-message.ts";
import { OMG_AUTO_MODEL, OMG_BUILD_MODEL } from "./omg-models.ts";

/**
 * Auto: the first build of a new app runs on the build model, later changes
 * run on Auto (Benny, 2026-10-24).
 *
 * A new-app session (firstRun, or newApp from the composer's no-project
 * Create path) that asks for Auto launches on OMG_BUILD_MODEL
 * and remembers OMG_AUTO_MODEL as the model to move to. The build is
 * everything the agent does for the first message. When the person sends
 * their second message, the session moves to Auto before that message runs.
 * The hosted router resolves both aliases per person, so which concrete
 * models they mean can change without an lfg release.
 */
export function planAutoBuildLaunch(input: {
  agent: string;
  model: string | undefined;
  firstRun: boolean;
  spawnedBy?: string;
}): { model: string | undefined; autoNextModel?: string } {
  const omgAgent = input.agent === "omg" || input.agent === "opencode";
  if (omgAgent && input.firstRun && input.spawnedBy !== "subagent" && input.model === OMG_AUTO_MODEL) {
    return { model: OMG_BUILD_MODEL, autoNextModel: OMG_AUTO_MODEL };
  }
  return { model: input.model };
}

/**
 * The model to switch to before this message runs, or null. Only a message
 * from the person ends the build: agent updates, task notices and
 * marker-prefixed machine messages (for example "[omg builder] ...") do not.
 */
export function autoBuildSwitch(
  record: { autoNextModel?: string } | undefined,
  text: string,
  fromPerson: boolean,
): string | null {
  if (!record?.autoNextModel || !fromPerson || isMachineMessage(text)) return null;
  return record.autoNextModel;
}
