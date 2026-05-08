import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import AnalyticsBeacon from "@/components/AnalyticsBeacon";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://triadsolutions.se"),
  title: {
    default: "Smashboard — Turneringssystem för padelhallar",
    template: "%s · Smashboard",
  },
  description:
    "Mexicano, Americano och Lag-Mexicano direkt på storbildsskärm. Hosten skriver in resultat på laptopen — allt uppdateras live på TV:n. White-label för padelhallar.",
  applicationName: "Smashboard",
  keywords: [
    "padel",
    "padelturnering",
    "mexicano",
    "americano",
    "padelhall",
    "turneringssystem",
    "smashboard",
    "triad solutions",
  ],
  authors: [{ name: "Triad Solutions" }],
  openGraph: {
    type: "website",
    locale: "sv_SE",
    url: "https://triadsolutions.se",
    siteName: "Smashboard",
    title: "Smashboard — Turneringssystem för padelhallar",
    description:
      "Storskärmen som dina spelare stannar för. Mexicano, Americano och Lag-Mexicano — utan kalkylark, utan kaos.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Smashboard turneringsdisplay",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Smashboard — Turneringssystem för padelhallar",
    description:
      "Storskärmen som dina spelare stannar för. Live-uppdaterad TV-display för Mexicano, Americano och Lag-Mexicano.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/icons/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="sv"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Suspense fallback={null}>
          <AnalyticsBeacon />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
