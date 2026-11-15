import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorker from "@/components/ServiceWorker";
import AppToaster from "@/components/AppToaster";
import AchievementHost from "@/components/Achievement";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const barlow = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], style: ["normal", "italic"], variable: "--font-barlow" });

export const metadata: Metadata = {
  title: "Coachly: training & nutrition coaching",
  description: "Personal trainers assign plans, review logs and message clients.",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Coachly", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060607",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${geist.variable} ${geistMono.variable} ${barlow.variable}`}>
      <body className="min-h-full font-sans">
        {children}
        <AppToaster />
        <AchievementHost />
        <ServiceWorker />
      </body>
    </html>
  );
}
