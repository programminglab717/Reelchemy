import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Reelchemy — Ideas into motion",
  description:
    "A conversation-first creative studio. Plan, compose, and export your next story.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
