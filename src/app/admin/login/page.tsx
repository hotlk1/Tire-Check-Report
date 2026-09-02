import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { getServerTranslator } from "@/i18n/server";
import { authProvider } from "@/lib/auth/provider";
import { getAdminSession } from "@/lib/auth/session";
import { listDevUsers } from "@/lib/repos/admin/users";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const session = await getAdminSession();
  if (session) redirect("/admin");
  const { t } = await getServerTranslator();
  const provider = authProvider();
  const devUsers = provider.name === "dev" ? await listDevUsers() : [];
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <h1 className="text-[22px] font-bold tracking-tight">{t("admin.login.title")}</h1>
      <div className="mt-4 rounded-[var(--radius-lg)] border border-border bg-surface p-5">
        <LoginForm dev={provider.name === "dev"} devUsers={devUsers.map((u) => ({ email: u.email, name: u.full_name, superAdmin: u.is_super_admin }))} />
      </div>
    </main>
  );
}
