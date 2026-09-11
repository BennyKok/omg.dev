/**
 * The "/" popup above a composer: type a slash and the box's skills appear,
 * filtered as you type; tap one and it replaces the "/word" with the skill's
 * invocation, the way the web composer does.
 *
 * Rendered IN FLOW above the field rather than floated over the transcript,
 * so the composer's own height measurement (which pads the list beneath it)
 * already accounts for it and nothing is covered.
 */
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Reanimated, { FadeIn, FadeOut } from "react-native-reanimated";

import { GlassSurface } from "./glass";
import { PressableScale } from "./motion";
import { useOmg } from "./provider";
import {
  applySkill,
  loadSkillCatalog,
  matchSkills,
  searchSkillCatalog,
  slashSkillAt,
  type SkillCatalogItem,
} from "./skills";
import { Text } from "./text";
import { useTheme } from "./theme";

export function SkillSuggest({
  value,
  onChangeText,
}: {
  value: string;
  /** Receives the whole new draft with the skill inserted. */
  onChangeText: (next: string) => void;
}) {
  const { client } = useOmg();
  const { colors, type, space, radius } = useTheme();
  // The caret is taken to be at the end: that is where you are when you are
  // typing a slash command, and RN's selection events lag a keystroke.
  const active = useMemo(() => slashSkillAt(value, value.length), [value]);
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [deep, setDeep] = useState<{ q: string; items: SkillCatalogItem[] }>({ q: "", items: [] });

  useEffect(() => {
    if (!active || !client) return;
    let cancelled = false;
    loadSkillCatalog(client)
      .then((items) => {
        if (!cancelled) setSkills(items);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [!!active, client]);

  const query = active?.query ?? "";
  useEffect(() => {
    if (!active || !query || !client) {
      setDeep({ q: "", items: [] });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchSkillCatalog(client, query)
        .then((items) => {
          if (!cancelled) setDeep({ q: query, items });
        })
        .catch(() => {
          if (!cancelled) setDeep({ q: query, items: [] });
        });
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [!!active, query, client]);

  const matches = useMemo(
    () => (active ? matchSkills(active, skills, deep.q === query ? deep.items : []) : []),
    [active, skills, deep, query],
  );

  if (!active || !matches.length) return null;

  return (
    <Reanimated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)}>
      <GlassSurface
        variant="regular"
        fallbackColor={colors.popover}
        style={{
          borderRadius: radius.xl,
          overflow: "hidden",
          marginBottom: space.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.borderSoft,
        }}
      >
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={{ maxHeight: 220 }}
          contentContainerStyle={{ padding: 4 }}
        >
          {matches.map((skill, index) => (
            <PressableScale
              key={`${skill.source}:${skill.trigger}`}
              onPress={() => {
                if (active) onChangeText(applySkill(value, active, skill));
              }}
              dim={0.6}
              accessibilityRole="button"
              accessibilityLabel={`${skill.trigger} skill`}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: 8,
                borderRadius: radius.md,
                backgroundColor: index === 0 ? colors.card : "transparent",
                gap: 1,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                <Text style={{ ...type.subhead, fontWeight: "600", color: colors.brand }}>/</Text>
                <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>
                  {skill.trigger}
                </Text>
              </View>
              {skill.description ? (
                <Text numberOfLines={1} style={{ ...type.footnote, color: colors.textMuted }}>
                  {skill.description}
                </Text>
              ) : null}
            </PressableScale>
          ))}
        </ScrollView>
      </GlassSurface>
    </Reanimated.View>
  );
}
