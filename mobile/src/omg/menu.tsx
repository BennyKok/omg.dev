/**
 * A menu that hangs off the control you pressed — the system's own, not a sheet
 * that flies up from the bottom of the screen.
 *
 * Every "pick one of these" in this app used to be a UIAlertController via
 * `ActionSheetIOS`. That is the right control for a short list of ACTIONS whose
 * consequences are worth a beat of ceremony, and the wrong one for a SELECTION:
 * which agent runs, which folder it runs in, which computer to talk to. A sheet
 * takes the whole bottom of the screen, dims everything behind it, animates in
 * and out, and appears nowhere near the thing it belongs to — for changing
 * "Claude" to "Codex". iOS answers that question with a menu anchored to the
 * control, and every system app (Files' sort, Safari's tabs, Photos' add) uses
 * one.
 *
 * That difference is not skin-deep: a menu draws a REAL checkmark against the
 * current choice, so the answer and the alternatives are one list. The sheet
 * could not, which is why the old call sites prefixed labels with a literal
 * "✓ " — a checkmark impersonation, at the wrong size, in the wrong place,
 * indenting nothing.
 *
 * SwiftUI's `Menu` through `@expo/ui`, which is already in the tree as an
 * expo-router dependency — so this needs no new native module and no rebuild.
 * The one thing callers must adapt to is that it is DECLARATIVE: the menu wraps
 * its trigger rather than being opened from an onPress. There is no `open()` to
 * call, and iOS exposes no way to open one programmatically, so a control that
 * offers a menu renders the menu AROUND itself. That is why the picker hooks in
 * this app hand back OPTIONS instead of a callback.
 */
import MenuView, { type MenuAction } from "@expo/ui/community/menu";
import {
  Button,
  Host,
  Image as SwiftImage,
  Label,
  Menu,
  RNHostView,
  Section,
  Toggle,
} from "@expo/ui/swift-ui";
import { disabled as disabledModifier } from "@expo/ui/swift-ui/modifiers";
import { Asset } from "expo-asset";
import * as Haptics from "expo-haptics";
import { type SFSymbol } from "expo-symbols";
import { type ReactNode, useEffect, useState } from "react";
import {
  Platform,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useTheme } from "./theme";

export type MenuOption = {
  label: string;
  /** SF Symbol drawn at the trailing edge of the row, the way iOS does it. */
  icon?: SFSymbol;
  /**
   * A bundled image (a `require()`d PNG) drawn where `icon` would be — for the
   * rows that are picking a THING with a face, like an agent's own mark. An
   * SF Symbol cannot say "Codex"; the mark can, and it is the same mark the
   * row is showing you everywhere else in the app.
   *
   * Wins over `icon` if both are given.
   */
  image?: ImageSourcePropType;
  /**
   * Present means this row is one of a set of ALTERNATIVES — `true` draws the
   * checkmark, `false` reserves its gutter so the labels stay aligned. Leave it
   * out for an action, which is not a choice between alternatives.
   */
  selected?: boolean;
  /** Red, for the one row that destroys something. */
  destructive?: boolean;
  /** Listed but not pickable — a computer whose plan cannot serve, say. */
  disabled?: boolean;
  onPress: () => void;
};

/**
 * Bundled images resolved to file URIs, because SwiftUI cannot take a React
 * Native module reference — `Image` wants a URL it can read bytes from.
 *
 * `Asset.fromModule().localUri` is that URL in BOTH builds, which is the whole
 * reason for the round trip: in a release build the asset is already on disk in
 * the bundle, and in development it lives on the Metro server until
 * `downloadAsync` pulls it into the cache. Reading `require()`'s number
 * directly would work in exactly one of those.
 *
 * Cached at module scope: a menu that re-renders on every keystroke in the
 * composer must not re-resolve the same nine PNGs, and the mapping cannot
 * change for the life of the process.
 */
const imageUriCache = new Map<string, string>();

function useMenuImageUris(options: MenuOption[]): Record<number, string> {
  const [uris, setUris] = useState<Record<number, string>>(() => initialUris(options));
  // The identity of `options` changes on every render at most call sites; the
  // IMAGES in it almost never do. Keying the effect on the module ids means one
  // resolve per distinct set, not one per render.
  const key = options.map((o) => String(o.image ?? "")).join("|");

  useEffect(() => {
    let alive = true;
    const pending = options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => option.image && !imageUriCache.has(String(option.image)));
    if (!pending.length) return;
    void Promise.all(
      pending.map(async ({ option }) => {
        try {
          const asset = Asset.fromModule(option.image as number);
          const uri = asset.localUri ?? (await asset.downloadAsync()).localUri;
          if (uri) imageUriCache.set(String(option.image), uri);
        } catch {
          // A missing icon is a menu row without a picture, not a broken menu.
        }
      }),
    ).then(() => {
      if (alive) setUris(initialUris(options));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return uris;
}

function initialUris(options: MenuOption[]): Record<number, string> {
  const out: Record<number, string> = {};
  options.forEach((option, index) => {
    const uri = option.image ? imageUriCache.get(String(option.image)) : undefined;
    if (uri) out[index] = uri;
  });
  return out;
}

export function DropdownMenu({
  title,
  options,
  style,
  children,
}: {
  /** Heading, for a menu whose rows do not say what they are choosing between. */
  title?: string;
  options: MenuOption[];
  style?: StyleProp<ViewStyle>;
  /** The control the menu hangs off. Pressing it opens the menu. */
  children: ReactNode;
}) {
  const { isDark } = useTheme();
  const imageUris = useMenuImageUris(options);

  /**
   * One place for the selection tap, so no call site can forget it and no two
   * can disagree about what feedback a menu gives.
   */
  const select = (option: MenuOption) => {
    if (option.disabled) return;
    void Haptics.selectionAsync();
    option.onPress();
  };

  if (Platform.OS !== "ios") {
    /**
     * Android's equivalent is a Compose `DropdownMenu`, which the same package
     * ships behind `MenuView`. It is a separate branch rather than the shared
     * path because SwiftUI is where the appearance has to be forced (see
     * below), and `MenuView` forwards `colorScheme` on Android only.
     */
    const actions = options.map<MenuAction>((option, index) => ({
      id: String(index),
      title: option.label,
      ...(option.selected === undefined ? {} : { state: option.selected ? "on" : "off" }),
      attributes: { destructive: option.destructive, disabled: option.disabled },
    }));
    return (
      <MenuView
        title={title}
        actions={actions}
        style={style}
        colorScheme={isDark ? "dark" : "light"}
        // Rows are identified by POSITION: `MenuView` falls back to the title
        // as an id, and these menus are full of lists whose labels can
        // legitimately repeat — two folders with the same basename, the same
        // prompt sent twice.
        onPressAction={({ nativeEvent }) => {
          const option = options[Number(nativeEvent.event)];
          if (option) select(option);
        }}
      >
        {children}
      </MenuView>
    );
  }

  const rows = options.map((option, index) => {
    const press = () => select(option);
    const modifiers = option.disabled ? [disabledModifier(true)] : undefined;
    const uri = imageUris[index];
    /**
     * A bundled mark has to be passed as CONTENT, not as a prop: `label` and
     * `systemImage` only speak SF Symbols. Both native views fall back to
     * rendering their children as the label when `label` is absent, so a
     * SwiftUI `Label` with a custom icon slot gets the picture and the title
     * into the same row — and, for a Toggle, keeps the checkmark that says
     * which one is current.
     */
    const content = uri ? (
      <Label title={option.label} icon={<SwiftImage uiImage={uri} size={20} />} />
    ) : null;
    // A row that says which of several things is current is a Toggle; SwiftUI
    // draws it in a menu as the system checkmark, aligned in its own gutter.
    return option.selected === undefined ? (
      <Button
        key={index}
        label={content ? undefined : option.label}
        systemImage={content ? undefined : option.icon}
        role={option.destructive ? "destructive" : undefined}
        modifiers={modifiers}
        onPress={press}
      >
        {content ?? undefined}
      </Button>
    ) : (
      <Toggle
        key={index}
        label={content ? undefined : option.label}
        systemImage={content ? undefined : option.icon}
        isOn={option.selected}
        onIsOnChange={press}
        modifiers={modifiers}
      >
        {content ?? undefined}
      </Toggle>
    );
  });

  return (
    /**
     * The menu's own appearance is NOT set here, deliberately.
     *
     * The first version of this passed `colorScheme` to the Host, because the
     * same menu came up dark over the composer and light grey when its trigger
     * sat in the navigation bar. It changed nothing: `colorScheme` sets a
     * SwiftUI environment value, and a system menu is presented by UIKit, which
     * reads the trait collection of the view it is presented from. The bar's
     * trait was light because the NAVIGATOR was told nothing about this app's
     * appearance — fixed once, at the source, in app/_layout.tsx.
     */
    <Host matchContents style={style} ignoreSafeArea="all">
      <Menu
        label={
          // The trigger is React Native content hosted back inside SwiftUI, so
          // the menu can hang off the app's own controls rather than a SwiftUI
          // button that would have to be styled twice.
          <RNHostView matchContents>
            <>{children}</>
          </RNHostView>
        }
      >
        {title ? <Section title={title}>{rows}</Section> : rows}
      </Menu>
    </Host>
  );
}
