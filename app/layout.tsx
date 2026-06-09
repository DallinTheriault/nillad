import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nillad's Field",
  description: "Personal operator dashboard for Nillad.",
};

import { DrawerProvider } from "@/components/drawer-provider";
import { NavDrawer } from "@/components/nav-drawer";
import { ChatBar } from "@/components/chat-bar";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans bg-bg text-bone">
        <DrawerProvider>
          {children}
          <NavDrawer />
          <ChatBar />
        </DrawerProvider>
      </body>
    </html>
  );
}
