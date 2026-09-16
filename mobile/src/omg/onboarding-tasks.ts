/**
 * THE ONBOARDING FLOW'S CONTENT, in one place.
 *
 * Screens 02, 03 and 05 all read from this: the interest lanes, the tool
 * badges, the three example tasks per lane, the prompt each task prefills, and
 * the word screen 05 puts in "Continue your {word}!".
 *
 * It is DATA, not components, because the copy is the part that will be
 * rewritten most and should never require touching a screen to do it. Every
 * string a person reads in steps 02 to 05 is in this file and nowhere else.
 *
 * Design: "v2_omg.dev iOS onboarding", page "Version 2 · Clean onboarding".
 */

/** A lane from step 02. The key is stable; the label is copy. */
export type InterestKey = "design" | "data" | "code" | "sales";

export type OnboardingTask = {
  /** Stable id, so a choice can be remembered across a relaunch. */
  id: string;
  /** The row in step 03. */
  label: string;
  /**
   * What step 03's editor opens with, already written out.
   *
   * Every one names its deliverables -- "a headline, caption and visual
   * direction" -- because a prompt whose result cannot be checked teaches
   * nothing on a first run. They are editable; this is a starting point, not a
   * script.
   */
  prompt: string;
};

export type InterestLane = {
  key: InterestKey;
  /** Step 02's row, and step 03's header. */
  label: string;
  /**
   * The word in "Continue your {word}!" on screen 05. Each lane has its own;
   * "chat" is the fallback for anyone who took the custom path and never
   * picked a lane.
   */
  word: string;
  /**
   * Tool badges above the tasks. They say which workflows this lane fits, and
   * are NOT connect buttons -- the example tasks use sample inputs, and an
   * account is connected only when something actually needs it.
   *
   * KEEP THIS LIST TO MARKS WE MAY ACTUALLY SHIP. The design draws each badge
   * with the vendor's logo, and that logo goes into an App Store binary. Excel
   * and Jira were dropped for exactly that reason: Microsoft and Atlassian
   * both gate those assets behind a permission or licence page, and a missing
   * badge is a smaller problem than an unlicensed one. Benny made that call.
   *
   * Before adding a name here, check the vendor publishes a mark that may be
   * used without written permission.
   */
  tools: string[];
  tasks: OnboardingTask[];
};

/** Screen 05's word when no lane was chosen -- the custom-idea path. */
export const FALLBACK_WORD = "chat";

export const INTEREST_LANES: InterestLane[] = [
  {
    key: "design",
    label: "Design & content",
    word: "design",
    tools: ["Figma", "Canva", "Google Drive", "Paper"],
    tasks: [
      {
        id: "design-ads",
        label: "Create 3 ad concepts",
        prompt:
          "Create 3 Instagram ad concepts for Daybreak Coffee. Include a headline, caption and visual direction for each.",
      },
      {
        id: "design-social",
        label: "Draft a week of social posts",
        prompt:
          "Draft a week of social posts for Daybreak Coffee. One per day, each with a hook and a call to action.",
      },
      {
        id: "design-launch-email",
        label: "Write a product launch email",
        prompt:
          "Write a product launch email for Daybreak Coffee's new cold brew. Include a subject line and a short body.",
      },
    ],
  },
  {
    key: "data",
    label: "Data & insights",
    word: "insights",
    tools: ["Sheets", "PostgreSQL"],
    tasks: [
      {
        id: "data-trends",
        label: "Find 3 useful trends",
        prompt:
          "Find 3 useful trends in this quarterly sales export. Say what changed, by how much, and why it matters.",
      },
      {
        id: "data-chart",
        label: "Create a summary chart",
        prompt:
          "Create a summary chart from this quarterly sales export. Pick the view that makes the pattern clearest.",
      },
      {
        id: "data-summarize",
        label: "Summarize a spreadsheet",
        prompt:
          "Summarize this spreadsheet in plain language. Lead with the finding, then the numbers behind it.",
      },
    ],
  },
  {
    key: "code",
    label: "Code & reviews",
    word: "code",
    tools: ["GitHub", "Linear"],
    tasks: [
      {
        id: "code-review",
        label: "Review a code change",
        prompt:
          "Review this pull request. Flag correctness risks first, then anything that could be simpler.",
      },
      {
        id: "code-explain-error",
        label: "Explain an error",
        prompt:
          "Explain this error. Say what caused it, where it came from, and the smallest fix.",
      },
      {
        id: "code-tests",
        label: "Suggest useful tests",
        prompt:
          "Suggest useful tests for this change. Cover the cases most likely to break it, not the obvious ones.",
      },
    ],
  },
  {
    key: "sales",
    label: "Sales & operations",
    word: "sales",
    tools: ["Shopify", "Stripe", "HubSpot"],
    tasks: [
      {
        id: "sales-snapshot",
        label: "Build a sales snapshot",
        prompt:
          "Build a sales snapshot for Northwind Supply this month. Revenue, top accounts, and what moved.",
      },
      {
        id: "sales-follow-up",
        label: "Draft a customer follow-up",
        prompt:
          "Draft a follow-up to a Northwind Supply customer who went quiet after a demo. Keep it short and specific.",
      },
      {
        id: "sales-deals",
        label: "Summarize this week's deals",
        prompt:
          "Summarize this week's deals at Northwind Supply. Which are progressing, which are stuck, and what is next.",
      },
    ],
  },
];

export function laneFor(key: InterestKey | null | undefined): InterestLane | null {
  return INTEREST_LANES.find((lane) => lane.key === key) ?? null;
}

/**
 * The prompt step 03 opens with. Null for the custom path, which starts blank
 * on purpose -- "Describe what you want to make or get done..." is a
 * placeholder, not prefilled text somebody has to delete.
 */
export function promptFor(
  key: InterestKey | null | undefined,
  taskId: string | null | undefined,
): string | null {
  return laneFor(key)?.tasks.find((task) => task.id === taskId)?.prompt ?? null;
}

/** The word in "Continue your {word}!" on screen 05. */
export function headlineWord(key: InterestKey | null | undefined): string {
  return laneFor(key)?.word ?? FALLBACK_WORD;
}
