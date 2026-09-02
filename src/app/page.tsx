import Link from "next/link";
import { getServerTranslator } from "@/i18n/server";

export default async function Home() {
  const { t } = await getServerTranslator();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-3xl">🛞</div>
      <h1 className="mt-4 text-[26px] font-bold tracking-tight">{t("app.name")}</h1>
      <p className="mt-1 text-[15px] text-text-2">{t("app.tagline")}</p>
      <p className="mt-8 text-[13px] text-text-3">
        Drivers: use your company&apos;s inspection link, e.g.{" "}
        <Link className="font-semibold text-accent" href="/t/jgg">
          /t/jgg
        </Link>
      </p>
    </main>
  );
}
