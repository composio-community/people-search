import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono } from "next/font/google";
import { InlineScript } from "@/components/inline-script";
import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "block",
});

export const metadata: Metadata = {
  title: "People Search · Composio Instant",
  description:
    "Describe the hire and People Search's AI sourcing agent finds the people, their verified email and the exact price before you pay. Apollo, Hunter, ContactOut and more through Composio Instant: no API keys, pay per answer.",
};

export const viewport: Viewport = {
  themeColor: "#0f0f0f",
};

// Dark by default; runs before first paint so a saved light choice never flashes.
const themeScript = `(function(){try{var t=localStorage.getItem("ps-theme");document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${mono.variable} h-full`}
    >
      <head>
        <InlineScript html={themeScript} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
