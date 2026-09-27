import type { Metadata, Viewport } from "next";
import { Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Ankix", template: "%s · Ankix" },
  description: "AI-generated Anki flashcards from your medical course materials.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8faf7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1418" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${newsreader.variable} h-full antialiased`}>
      <body className="min-h-full font-sans text-[14px] leading-[22px]">
        {children}
        <Toaster position="top-center" closeButton toastOptions={{ className: "font-sans" }} />
      </body>
    </html>
  );
}
