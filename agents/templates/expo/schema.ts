import { collection, defineSchema, fields } from "@omg-dev/schema";

// The phone app has no sign-in, so every collection here is `.scoped("global")`.
// A collection without it is per-user, and the hosted data API then answers
// the app with 401 "Authentication required".

export default defineSchema({
  collections: {
    tasks: collection({
      fields: {
        title: fields.string(),
        done: fields.boolean(),
      },
    }).scoped("global"),
  },
});
