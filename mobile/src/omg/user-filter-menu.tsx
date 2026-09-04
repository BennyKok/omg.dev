/**
 * The roster filter on the home header — the phone's UserFilterMenu
 * (web/src/components/user-filter-menu.tsx).
 *
 * The trigger wears the selected person's avatar, a person glyph for
 * "Unassigned", and a globe for everyone, exactly as the web's 24px button
 * does; the menu is the system one (menu.tsx), with the same three groups:
 * All users, Unassigned, then one row per roster user. Rows carry the
 * avatar where the machine serves one the menu can fetch (Gravatar); an
 * uploaded icon behind the transport's grant falls back to the person glyph
 * in the row and still shows on the trigger, which draws through RN `Image`.
 */

import { Image, View } from "react-native";

import { Icon } from "../components";
import { DropdownMenu, type MenuOption } from "./menu";
import { useTheme } from "./theme";
import {
  ALL_USERS,
  rosterUserLabel,
  UNASSIGNED_USERS,
  useAvatarUri,
  type RosterUser,
} from "./users";

const TRIGGER_AVATAR = 24;

export function UserFilterMenu({
  value,
  users,
  onChange,
}: {
  value: string;
  users: RosterUser[];
  onChange: (next: string) => void;
}) {
  const { colors } = useTheme();
  const active = value !== ALL_USERS;
  const selected = users.find((user) => user.email === value);
  const avatarUri = useAvatarUri(selected?.avatar);
  const tint = active ? colors.primary : colors.textSecondary;

  const options: MenuOption[] = [
    {
      label: "All users",
      icon: "globe",
      selected: value === ALL_USERS,
      onPress: () => onChange(ALL_USERS),
    },
    {
      label: "Unassigned",
      icon: "person.crop.circle.dashed",
      selected: value === UNASSIGNED_USERS,
      onPress: () => onChange(UNASSIGNED_USERS),
    },
    ...users.map<MenuOption>((user) => ({
      label: rosterUserLabel(user),
      ...(user.avatar && /^https?:\/\//i.test(user.avatar)
        ? { image: { uri: user.avatar } }
        : { icon: "person.crop.circle" as const }),
      selected: value === user.email,
      onPress: () => onChange(user.email),
    })),
  ];

  const title = selected ? rosterUserLabel(selected) : active ? "Unassigned" : "All users";

  return (
    <DropdownMenu title="Filter by user" options={options}>
      <View
        accessibilityRole="button"
        accessibilityLabel={`Filter sessions by user: ${title}. Change`}
        style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
      >
        {avatarUri ? (
          <Image
            source={{ uri: avatarUri }}
            style={{
              width: TRIGGER_AVATAR,
              height: TRIGGER_AVATAR,
              borderRadius: TRIGGER_AVATAR / 2,
              borderWidth: 1,
              borderColor: colors.primary,
            }}
          />
        ) : active ? (
          <Icon ios="person.crop.circle" android="person" size={20} color={tint} />
        ) : (
          <Icon ios="globe" android="public" size={20} color={tint} />
        )}
      </View>
    </DropdownMenu>
  );
}
