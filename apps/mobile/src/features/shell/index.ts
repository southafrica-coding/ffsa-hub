// Public surface of the app shell for every slice. See apps/mobile/README.md
// ("App shell: tabs, useMe, useCan").
export { ADMIN_ROLES, can, hasRole, isAdmin, roleLabel, roleLabels } from "./access";
export { badgeText, getTabBadge, setTabBadge, useTabBadge } from "./badges";
export { MeProvider, useCan, useHasRole, useMe, type MeState } from "./me-context";
export { shellStrings } from "./strings";
export { TabBar } from "./TabBar";
export { TABS, tabForRoute, visibleTabs, type TabDef, type TabId } from "./tabs";
export { openWebPage, webUrl } from "./web";
