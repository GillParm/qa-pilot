import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import Link from "next/link";
import { CartLink, CartProvider } from "./components/cart-context";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: { default: "Tin & Ember", template: "%s | Tin & Ember" },
  description: "Camp kitchen enamelware. A demo store for qa-pilot.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} antialiased`}>
      <body className="min-h-screen">
        <CartProvider>
          <header className="border-b-4 border-rim">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-4 sm:px-6">
              <Link href="/" className="display text-2xl no-underline">
                Tin &amp; Ember
              </Link>
              <nav aria-label="Main" className="flex gap-6">
                <Link href="/" className="nav-link">
                  Products
                </Link>
                <Link href="/signup" className="nav-link">
                  Sign up
                </Link>
                <CartLink />
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6">{children}</main>
        </CartProvider>
      </body>
    </html>
  );
}
