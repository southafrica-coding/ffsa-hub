import Link from "next/link";
import { Chip } from "@/components/ffsa";

/**
 * Top-of-page nav for the /users/[id]/* routes. Profile is visible to
 * everyone with view access; Permissions is only shown if the viewer
 * can manage permissions (super_admin or schools.manage holder).
 */
export function UserTabs({
  userId,
  active,
  showPermissions,
}: {
  userId: string;
  active: "profile" | "permissions";
  showPermissions: boolean;
}) {
  const tabs: { key: "profile" | "permissions"; label: string; href: string }[] = [
    { key: "profile", label: "Profile", href: `/users/${userId}` },
  ];
  if (showPermissions) {
    tabs.push({
      key: "permissions",
      label: "Permissions",
      href: `/users/${userId}/permissions`,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-bone px-5 py-3 md:px-8">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href}>
          <Chip active={active === tab.key}>{tab.label}</Chip>
        </Link>
      ))}
    </div>
  );
}
