import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { I18nProvider } from "@/i18n/client";
import { getRequestLocale } from "@/i18n/server";
import { ServiceWorker } from "@/components/pwa/ServiceWorker";

export const metadata: Metadata = {
  title: { default: "Tire Check", template: "%s · Tire Check" },
  description: "Fleet tire inspections",
  applicationName: "Tire Check",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Tire Check" },
};

export const viewport: Viewport = {
  themeColor: "#0b1f3a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <I18nProvider initialLocale={locale}>
          {children}
          <ServiceWorker />
        </I18nProvider>
      </body>
    </html>
  );
}
