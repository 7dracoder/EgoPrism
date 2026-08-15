import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const body = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "EgoPrism — Quantitative diversity for EgoVerse",
  description:
    "Compare matched EgoVerse subsets using deterministic visual and motion coverage—not captions or an LLM.",
  metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000"),
  openGraph: {
    title: "EgoPrism — Quantitative diversity for EgoVerse",
    description: "Measure coverage. Pick the broader matched EgoVerse slice.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "EgoPrism comparison showing subset A at 17.5 and subset B at 77.1",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "EgoPrism — Quantitative diversity for EgoVerse",
    description: "Measure coverage. Pick the broader matched EgoVerse slice.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
