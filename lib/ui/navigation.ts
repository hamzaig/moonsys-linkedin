import {
  RiLayoutGridLine, RiFlowChart, RiInboxLine, RiFileList3Line,
  RiContactsLine, RiBuildingLine, RiMailCheckLine, RiPhoneLine,
  RiFileTextLine, RiBarChartBoxLine, RiEmotionHappyLine, RiCheckboxCircleLine,
} from "react-icons/ri";
import type { IconType } from "react-icons";

export interface NavigationItem {
  href: string;
  label: string;
  icon: IconType;
  tour?: string;
  premium?: boolean;
}

export const navigationGroups: { label: string; items: NavigationItem[] }[] = [
  { label: "Workspace", items: [
    { href: "/", label: "Dashboard", icon: RiLayoutGridLine, tour: "nav-dashboard" },
    { href: "/workflows", label: "Campaigns", icon: RiFlowChart, tour: "nav-workflows" },
    { href: "/inbox", label: "Inbox", icon: RiInboxLine, tour: "nav-inbox" },
    { href: "/todos", label: "Todos", icon: RiCheckboxCircleLine, tour: "nav-todos", premium: true },
  ] },
  { label: "CRM", items: [
    { href: "/lists", label: "Lead lists", icon: RiFileList3Line, tour: "nav-lists" },
    { href: "/contacts", label: "Contacts", icon: RiContactsLine, tour: "nav-contacts" },
    { href: "/companies", label: "Companies", icon: RiBuildingLine, tour: "nav-companies" },
  ] },
  { label: "Operations", items: [
    { href: "/email-health", label: "Email health", icon: RiMailCheckLine, tour: "nav-email-health" },
  ] },
  { label: "Calling", items: [
    { href: "/dialer", label: "Call queue", icon: RiPhoneLine, tour: "nav-dialer" },
    { href: "/dialer/scripts", label: "Call scripts", icon: RiFileTextLine, tour: "nav-dialer-scripts" },
    { href: "/dialer/analytics", label: "Call analytics", icon: RiBarChartBoxLine, tour: "nav-dialer-analytics" },
    { href: "/dialer/settings", label: "Dialer settings", icon: RiEmotionHappyLine, tour: "nav-dialer-settings" },
  ] },
];

export function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/" || href === "/dialer") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function routeContext(pathname: string) {
  for (const group of navigationGroups) {
    for (const item of [...group.items].sort((a, b) => b.href.length - a.href.length)) {
      if (isRouteActive(pathname, item.href)) {
        return { group: group.label, label: item.label, detail: pathname !== item.href };
      }
    }
  }
  return { group: "Account", label: "Settings", detail: false };
}
