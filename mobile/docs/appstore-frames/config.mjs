// Shared configuration for App Store screenshot frame rendering.
// Edit CAPTIONS to change copy; edit PLATFORMS to tune layout constants.
// See README.md for the design rationale.

export const COLORS = {
  background: '#F2F2F7', // sampled from the app's own systemGroupedBackground
  text: '#000000', // sampled from the app's own headline/title text
};

export const PLATFORMS = {
  'iphone-6.9in': {
    width: 1320,
    height: 2868,
    headlineZoneHeight: 460, // px reserved at top for caption; rest is the device image, cropped from the top
    fontSize: 90,
    sideMargin: 84,
    topPadding: 132,
    cornerRadius: 64,
  },
  'ipad-13in': {
    width: 2064,
    height: 2752,
    headlineZoneHeight: 420,
    fontSize: 140,
    sideMargin: 130,
    topPadding: 150,
    cornerRadius: 56,
  },
};

// Caption copy, keyed by source filename stem. Same UI screen -> same line,
// across both device buckets, so the set reads as one system.
export const CAPTIONS = {
  '01-home-session-list': 'Coding agents, from your phone.',
  '02-active-session-transcript': 'Watch the agent work in real time.',
  '03-computer-screen': 'A real computer in the cloud.',
  '04-auto-agents-findings': 'Auto agents flag what needs your attention.',
};

// Explicit frame order per bucket (Apple sorts by upload order, not filename).
// The first two are what most people see in the App Store listing -- front-load
// the strongest idea. Add/remove stems here to change which frames ship and in
// what order; each stem must have a matching source capture and a CAPTIONS entry.
export const BUCKETS = {
  'iphone-6.9in': [
    '01-home-session-list',
    '02-active-session-transcript',
    '03-computer-screen',
    '04-auto-agents-findings',
  ],
  'ipad-13in': [
    '01-home-session-list',
    '02-active-session-transcript',
    '03-computer-screen',
  ],
};
