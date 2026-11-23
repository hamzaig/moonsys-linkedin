import Link from "next/link";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { RiCloseLine, RiLogoutBoxLine, RiUserSettingsLine, RiCompassLine, RiQuestionLine, RiArrowUpCircleLine } from "react-icons/ri";
import MoonSysLogo from "@/components/brand/MoonSysLogo";
import { navigationGroups, isRouteActive } from "@/lib/ui/navigation";
import { pathToTourPage, replayPageTour } from "@/lib/tour";
import { brand } from "@/lib/ui/brand";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";

export const SIDEBAR_WIDTH_EXPANDED = 256;
export const SIDEBAR_WIDTH_COLLAPSED = 256;

type NavContentProps = {
  hasPremium: boolean;
  version: string | null;
  latestVersion: string | null;
  onNavigate: () => void;
  mobile?: boolean;
  toursActive: boolean;
};

function NavigationContent({ hasPremium, version, latestVersion, onNavigate, mobile, toursActive }: NavContentProps) {
  const router = useRouter();
  const tourPage = pathToTourPage(router.pathname);
  return <div className="ms-sidebar-content">
    <div className="ms-sidebar-brand">
      <MoonSysLogo />
      {mobile && <button type="button" className="ms-icon-button" aria-label="Close navigation" onClick={onNavigate}><RiCloseLine size={21} aria-hidden="true" /></button>}
      <p>LinkedIn outreach workspace</p>
    </div>
    <nav className="ms-navigation" aria-label="Main navigation">
      {navigationGroups.map(group => {
        const items = group.items.filter(item => !item.premium || hasPremium);
        if (!items.length) return null;
        return <div className="ms-nav-group" key={group.label}>
          <p className="ms-nav-group-label">{group.label}</p>
          {items.map(item => {
            const active = isRouteActive(router.pathname, item.href);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} onClick={onNavigate} data-tour={toursActive ? item.tour : undefined}
              className={`ms-nav-link ${active ? "ms-nav-link-active" : ""}`} aria-current={active ? "page" : undefined}>
              <Icon size={19} aria-hidden="true" /><span>{item.label}</span>{active && <span className="ms-nav-active-dot" aria-hidden="true" />}
            </Link>;
          })}
        </div>;
      })}
    </nav>
    <div className="ms-sidebar-footer">
      {latestVersion && <div className="ms-update-notice"><RiArrowUpCircleLine size={16} aria-hidden="true" />Version {latestVersion} available</div>}
      {tourPage && <button type="button" className="ms-nav-link" onClick={() => { replayPageTour(tourPage); onNavigate(); }}><RiCompassLine size={18} aria-hidden="true" /><span>Replay page tour</span></button>}
      <a href={`${brand.website}/contact`} target="_blank" rel="noopener noreferrer" className="ms-nav-link"><RiQuestionLine size={18} aria-hidden="true" /><span>Help & support</span></a>
      <div className="ms-sidebar-account-row">
        <Link href="/settings" data-tour={toursActive ? "nav-settings" : undefined} onClick={onNavigate} className={`ms-nav-link ${isRouteActive(router.pathname, "/settings") ? "ms-nav-link-active" : ""}`} aria-current={isRouteActive(router.pathname, "/settings") ? "page" : undefined}>
          <RiUserSettingsLine size={18} aria-hidden="true" /><span>Settings</span>
        </Link>
        <button type="button" className="ms-icon-button" aria-label="Sign out" title="Sign out" onClick={() => signOut({ callbackUrl: "/login" })}><RiLogoutBoxLine size={18} aria-hidden="true" /></button>
      </div>
      <p className="ms-sidebar-credit">Built by MoonSys{version && <span>v{version}</span>}</p>
    </div>
  </div>;
}

export default function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mobileViewport = useMediaQuery("(max-width: 1023px)");
  const [hasPremium, setHasPremium] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/premium-status").then(response => response.ok ? response.json() : null)
      .then(data => { if (data) setHasPremium(!!data.hasPremium); }).catch(() => {});
    fetch("/api/system/update").then(response => response.ok ? response.json() : null)
      .then(data => { if (data) { setVersion(data.current ?? null); if (data.updateAvailable) setLatestVersion(data.latest); } }).catch(() => {});
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (mobileOpen && mobileViewport && !element.open) element.showModal();
    if ((!mobileOpen || !mobileViewport) && element.open) element.close();
  }, [mobileOpen, mobileViewport]);
  const props = { hasPremium, version, latestVersion, onNavigate: onClose };
  return <>
    <aside className="ms-sidebar-desktop" aria-label="Workspace sidebar"><NavigationContent {...props} toursActive={!mobileViewport} /></aside>
    <dialog id="workspace-navigation" ref={dialog} className="ms-nav-dialog" aria-label="Workspace navigation" onClose={onClose} onCancel={onClose}
      onClick={event => { if (event.target === dialog.current) onClose(); }}>
      <NavigationContent {...props} mobile toursActive={mobileViewport && mobileOpen} />
    </dialog>
  </>;
}
