import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import GlobalScene from "@/components/Scene/GlobalScene";
import ConsoleFrame from "@/components/console/ConsoleFrame";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Specter — See the ghosts in your codebase",
  description: "AI-powered supply chain attack intelligence for developers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-screen w-screen overflow-hidden bg-void text-white">
        {/* GLOBAL CANVAS - Persistent 3D Background, plus the UI layer above it.
            ConsoleFrame keeps the original full-screen layering on the landing
            page and adds the SPECTER HUD + intelligence rail on console routes,
            fitting the same persistent scene into the content area. */}
        <ConsoleFrame scene={<GlobalScene />}>{children}</ConsoleFrame>
      </body>
    </html>
  );
}