/** Simulator-only project registration fixture. No hosting or agent calls. */
import { enableProjectCreationFixture } from "../src/omg/demo-data";
enableProjectCreationFixture();
require("./no-project-e2e-entry");
