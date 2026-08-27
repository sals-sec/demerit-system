import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SALS Security Records",
  description:
    "A shared SALS demerit management system for staff and workers, with live risk monitoring, policy controls, controlled access, and Excel reporting.",
  openGraph: {
    title: "SALS Security Records",
    description:
      "Shared staff and worker demerit records, live risk monitoring, policy controls, and Excel reporting.",
    type: "website",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "SALS Security Records",
    description:
      "Shared staff and worker demerit records, live risk monitoring, policy controls, and Excel reporting.",
    images: ["/og.png"],
  },
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
