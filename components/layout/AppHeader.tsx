import Link from "next/link";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { RiMenu2Line, RiSearchLine, RiArrowRightUpLine, RiArrowRightSLine } from "react-icons/ri";
import { routeContext } from "@/lib/ui/navigation";
import { brand } from "@/lib/ui/brand";

export default function AppHeader({ onMenuOpen, navigationOpen }: { onMenuOpen: () => void; navigationOpen: boolean }) {
  const router = useRouter();
  const { data: session } = useSession();
  const context = routeContext(router.pathname);
  const identity = session?.user?.name || session?.user?.email || "Your account";
  return <header className="ms-topbar">
    <div className="flex min-w-0 items-center gap-3">
      <button type="button" className="ms-icon-button ms-mobile-menu" onClick={onMenuOpen} aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={navigationOpen} aria-controls="workspace-navigation"><RiMenu2Line size={21} aria-hidden="true" /></button>
      <nav aria-label="Breadcrumb" className="ms-breadcrumb">
        <span className="ms-breadcrumb-group">{context.group}</span><RiArrowRightSLine size={15} aria-hidden="true" />
        <span aria-current={context.detail ? undefined : "page"}>{context.label}</span>
        {context.detail && <><RiArrowRightSLine size={15} aria-hidden="true" /><span aria-current="page">Details</span></>}
      </nav>
    </div>
    <div className="ms-topbar-actions">
      <Link href="/contacts" className="ms-contact-search" aria-label="Find a contact"><RiSearchLine size={17} aria-hidden="true" /><span>Find a contact</span></Link>
      <a href={brand.website} target="_blank" rel="noopener noreferrer" className="ms-website-link">MoonSys.co <RiArrowRightUpLine size={15} aria-hidden="true" /></a>
      <Link href="/settings" className="ms-account-avatar" aria-label={`Account settings for ${identity}`} title={identity}>{identity.charAt(0).toUpperCase()}</Link>
    </div>
  </header>;
}
