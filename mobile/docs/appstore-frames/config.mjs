// Shared configuration for App Store screenshot frame rendering.
// Edit CAPTIONS to change copy; edit PLATFORMS to tune layout constants.
// See README.md for the design rationale.

export const COLORS = {
  background: '#F2F2F7', // sampled from the app's own systemGroupedBackground
  text: '#000000', // sampled from the app's own headline/title text
  // Creative assets (header, search results).
  paper: '#F4F1E8', // Notebook garden paper (mobile/assets/village/README.md)
  ink: '#22201B', // warm graphite, reads as the illustration's own pencil
  brand: '#FF5530', // omg.dev brand orange (web/src/components/omg-brand-mark.tsx)
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

// App Store creative assets (iOS 27 and iPadOS 27 and later, live 2026-10-05).
// Both are optional and are uploaded to the App Store Connect Asset Library,
// which reviews them apart from an app version.
// Spec: https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications/
//   Product page header: 21:9, exactly 3840x1646.
//   Search results:      3:2, 1920x1280 up to 3840x2560.
//   Neither may have an alpha channel. The help page allows JPEG for both, but
//   the API's catalogue (GET /v1/appAssetLibraryRefData, spec i3840x1646a0)
//   accepts the header only as .png. render.mjs writes PNG without alpha for both.
//
// safeArea is the 'Art Safe Area' layer of Apple's own Photoshop templates
// (developer.apple.com/app-store/asset-best-practices, read 2026-10-15).
// Devices and orientations crop everything outside it, so the phrase, the
// figure and any UI must sit inside it. The rest of the canvas is backdrop.
//
// The header is brand, not a feature tour: the app's own welcome screen
// (onboarding-welcome.tsx) widened to 21:9: same figure, own tagline. The
// search asset is the same scene at 3:2. It shows no app screen: at the size
// of a search card the screen's text cannot be read. (render.mjs still takes
// an optional `phone: { stem, width, sourceCropHeight, cornerRadius }`.)
// No 'omg.dev' text: Apple refuses website URLs in creative assets, and the
// app name already sits directly under the header.
export const CREATIVE_SOURCE_BUCKET = 'iphone-6.9in';

export const CREATIVE_ART = {
  // Generated with google/nano-banana-pro on 2026-10-15 in the Notebook
  // garden style of mobile/assets/village (prompt in README.md).
  backdrop: 'art/meadow-21x9.jpg',
  figure: '../../assets/onboarding/welcome-grass@3x.png', // 1002x875, transparent
  // Visible artwork inside the transparent PNG (`convert ... -trim info:`).
  // Cropping to it lets the grass patch sit exactly on the hill crest.
  figureSourceHeight: 875,
  figureCrop: { x: 15, y: 190, w: 968, h: 562 },
};

// How iPhone shows these assets, measured from Apple's announcement image
// (developer.apple.com/news/?id=ljpl7kyn, 2026-10-05) against the Coast sample
// in Apple's template. The 'THE COAST' wordmark is 744 px wide on the canvas
// and fills 46 percent of the phone's width, so iPhone portrait shows about
// 1630 px of the 3840 px header -- the safe area's width -- edge to edge, and
// runs it up behind the status bar. Back and share buttons float over its top
// corners. The search asset is shown whole, as a 3:2 card, and Apple's own
// Ridge Explorer example fills that card to about 7 percent from its edges.
//
// contentBox is where the phrase and figure (and screen) are laid out. The
// renderer fails if anything leaves it. For the header it sits inside both
// Apple's safe area and the iPhone view, below the buttons.
export const CREATIVE_ASSETS = {
  'product-page-header': {
    width: 3840,
    height: 1646,
    safeArea: { x: 1097, y: 493, w: 1646, h: 661 },
    iphone: {
      view: { x: 1105, y: 278, w: 1630, h: 1058 },
      statusBarBottom: 480,
      buttons: [{ x: 1300, y: 615, r: 92 }, { x: 2620, y: 615, r: 92 }],
    },
    contentBox: { x: 1200, y: 730, w: 1440, h: 424 },
    headline: 'Keep building\nyour ideas,\nwherever you are.',
    fontSize: 80,
    markSize: 0, // the back button covers the corner, and the icon sits just below
    figureHeight: 400, // height of the visible artwork, not of the PNG
  },
  'search-results': {
    width: 3840,
    height: 2560,
    safeArea: { x: 836, y: 765, w: 2168, h: 1030 },
    contentBox: { x: 260, y: 300, w: 3320, h: 1440 },
    headline: 'Keep building\nyour ideas,\nwherever you are.',
    fontSize: 190,
    markSize: 0, // the app icon sits right above the card in search results
    figureHeight: 950,
    // No app screen: at search-card size its text is too small to read.
  },
};
