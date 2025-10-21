import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import WagmiProviderWrapper from "@/components/WagmiProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "FlashBets",
    template: "%s | Yellow Web3",
  },
  description:
    "A decentralized prediction market built with Pyth oracles, enabling real-time crypto market predictions and rewards.",
  keywords: [
    "prediction market",
    "web3",
    "pyth oracle",
    "crypto betting",
    "blockchain",
    "yellow web3",
  ],
  authors: [{ name: "Raj Shah" }],
  creator: "Flashbets Team",
  openGraph: {
    title: "Yellow Web3 Prediction Market",
    description:
      "Predict crypto market outcomes, earn rewards, and explore decentralized finance tools powered by Pyth.",
    url: "https://yellowweb3.app",
    siteName: "Yellow Web3",
    images: [
      {
        url: "https://yellowweb3.app/og-image.png",
        width: 1200,
        height: 630,
        alt: "Yellow Web3 Prediction Market Preview",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Yellow Web3 Prediction Market",
    description:
      "Predict crypto prices and earn — powered by Pyth Oracles and Web3 smart contracts.",
    creator: "@yellowweb3",
    images: ["https://yellowweb3.app/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon-16x16.png",
    apple: "/apple-touch-icon.png",
  },
  themeColor: "#f59e0b", 
  manifest: "/site.webmanifest",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <WagmiProviderWrapper>
          {children}
        </WagmiProviderWrapper>
      </body>
    </html>
  );
}
