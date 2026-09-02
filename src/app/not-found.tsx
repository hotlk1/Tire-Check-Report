import Link from "next/link";
import { getServerTranslator } from "@/i18n/server";

export default async function NotFound() {
  const { t } = await getServerTranslator();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 text-center">
      <p className="text-[15px] text-text-2">{t("app.notFound")}</p>
      <Link href="/" className="mt-4 text-[14px] font-semibold text-accent">
        {t("app.name")}
      </Link>
    </main>
  );
}
