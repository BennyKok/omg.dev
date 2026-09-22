import { collection, defineSchema, fields } from "@omg-dev/schema";

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
