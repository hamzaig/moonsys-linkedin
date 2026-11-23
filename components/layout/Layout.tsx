import { ReactNode, useCallback, useState } from "react";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import AppHeader from "./AppHeader";
import TourGate from "@/components/onboarding/TourGate";

const NO_LAYOUT_PATHS = ["/login"];

export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMenu = useCallback(() => setMobileOpen(false), []);
  if (NO_LAYOUT_PATHS.includes(router.pathname)) return <>{children}</>;
  if (router.query.embed === "1") return <main className="ms-embedded-page">{children}</main>;
  return <div className="ms-app">
    <a href="#main-content" className="ms-skip-link">Skip to main content</a>
    <TourGate />
    <Sidebar mobileOpen={mobileOpen} onClose={closeMenu} />
    <div className="ms-workspace">
      <AppHeader onMenuOpen={() => setMobileOpen(true)} navigationOpen={mobileOpen} />
      <main id="main-content" className="ms-page" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
