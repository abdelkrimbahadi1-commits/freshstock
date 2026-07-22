"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/components/LocaleProvider";

const LINKS = [
  { href: "/stock", key: "nav.stock" },
  { href: "/menus", key: "nav.menus" },
  { href: "/courses", key: "nav.courses" },
  { href: "/budget", key: "nav.budget" },
  { href: "/foyer", key: "nav.foyer" },
];

export default function NavBar() {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <nav className="fixed top-0 left-0 right-0 z-20 border-b border-black/10 dark:border-white/10 bg-white/95 dark:bg-black/95 backdrop-blur">
      <ul className="max-w-2xl mx-auto flex gap-1.5 px-2 py-2 overflow-x-auto">
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(link.href + "/");
          return (
            <li key={link.href} className="flex-1 min-w-[64px]">
              <Link
                href={link.href}
                className={`block text-center rounded-lg px-2 py-2 text-xs font-medium border transition-shadow ${
                  active
                    ? "bg-black text-white dark:bg-white dark:text-black border-black/80 dark:border-white/80 shadow-[inset_0_2px_3px_rgba(0,0,0,0.35)]"
                    : "bg-white dark:bg-neutral-900 border-black/10 dark:border-white/15 shadow-[0_2px_0_rgba(0,0,0,0.12)] dark:shadow-[0_2px_0_rgba(255,255,255,0.12)] active:shadow-none active:translate-y-[1px]"
                }`}
              >
                {t(link.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
