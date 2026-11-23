import Image from "next/image";
import Link from "next/link";
import { brand } from "@/lib/ui/brand";

export default function MoonSysLogo({ className = "", linked = true }: { className?: string; linked?: boolean }) {
  const logo = <span className={`ms-wordmark ${className}`}>
    <Image src={brand.wordmark} alt="MoonSys" width={400} height={400} priority className="ms-wordmark-image" />
  </span>;
  return linked ? <Link href="/" aria-label="MoonSys LinkedIn home" className="ms-brand-link">{logo}</Link> : logo;
}
