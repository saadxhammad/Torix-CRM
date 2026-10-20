import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Torix Solutions | Company workspace",
  description: "Your company overview, client work, team and finances.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="">{children}</body>
    </html>
  );
}
