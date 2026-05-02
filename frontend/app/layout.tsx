import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import "./globals.css";
import GameHUD from "@/components/layout/GameHUD";
import { BellaPresence } from "@/components/bella/BellaPresence";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AnimeEdu — Your Learning Universe",
  description: "Learn anything through anime, simulations, and 3D models.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Cubism 4 Core SDK — required for Live2D model rendering */}
        <Script
          src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={`${inter.className} min-h-screen overflow-x-hidden bg-black text-white selection:bg-indigo-500/30`}>
        {/* Animated Simulated Universe Background */}
        <div className="universe-bg" />
        
        {/* Top Navigation HUD */}
        <GameHUD />
        
        {/* Main Content Area */}
        <main className="relative min-h-[calc(100vh-56px)] mt-14 z-10 px-3 sm:px-6 py-4 sm:py-6">
          {children}
        </main>
        
        {/* Floating Desktop Mate */}
        <BellaPresence />
      </body>
    </html>
  );
}
