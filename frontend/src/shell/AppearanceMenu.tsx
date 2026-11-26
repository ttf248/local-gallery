import { Menu } from "../ui/Menu";
import { IconButton } from "../ui/IconButton";
import { MonitorIcon, MoonIcon, SunIcon } from "../ui/icons";
import { useUIStore } from "../store/uiStore";
export function AppearanceMenu() {
  const theme = useUIStore((s) => s.theme),
    setTheme = useUIStore((s) => s.setTheme);
  const choices = [
    ["light", "浅色", SunIcon],
    ["dark", "深色", MoonIcon],
    ["system", "跟随系统", MonitorIcon],
  ] as const;
  const current = choices.find(([id]) => id === theme) ?? choices[2],
    Icon = current[2];
  return (
    <Menu
      label="外观"
      trigger={
        <IconButton label={"外观 · " + current[1]}>
          <Icon />
        </IconButton>
      }
      items={choices.map(([id, label, Symbol]) => ({
        id,
        label,
        icon: <Symbol />,
        checked: id === theme,
        onSelect: () => setTheme(id),
      }))}
    />
  );
}
