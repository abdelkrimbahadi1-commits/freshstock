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
    <nav className="fixed bottom-0 left-0 right-0 border-t border-black/10 dark:border-white/10 bg-white/90 dark:bg-black/90 backdrop-blur z-10">
      <ul className="max-w-2xl mx-auto flex justify-between px-2">
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(link.href + "/");
          return (
            <li key={link.href} className="flex-1">
              <Link
                href={link.href}
                className={`flex flex-col items-center py-2.5 text-xs ${
                  active ? "font-semibold" : "opacity-60"
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
