import { defineSchema } from "@omg-dev/schema";

// The app stores its data on the phone (src/lib/tasks.ts), so there are no
// hosted collections and the deploy is a static web build.
//
// Add a hosted collection only together with sign-in (@omg-dev/sdk), and mark
// it `.scoped("user")`. A collection without sign-in answers the phone with
// 401 "Authentication required".
export default defineSchema({
  collections: {},
});
