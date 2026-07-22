import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import LanguageSwitch from "@/components/LanguageSwitch";
import { LocaleProvider } from "@/components/LocaleProvider";
import NavBar from "@/components/NavBar";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FreshStock",
  description:
    "Scannez votre stock, évitez le gaspillage, recevez des menus intelligents selon vos envies.",
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LocaleProvider>
          <ServiceWorkerRegister />
          <NavBar />
          <LanguageSwitch />
          <main className="flex-1 pt-16 pb-6">{children}</main>
        </LocaleProvider>
      </body>
    </html>
  );
}
