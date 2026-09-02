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
    <main className="flex min-h-dvh flex-1 flex-col" style={{ background: "var(--ink)" }}>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div className="mark">TR</div>
          <div className="wordmark" style={{ color: "#fff" }}>{t("app.name").toUpperCase()}</div>
        </div>
        <h1 style={{ font: "700 22px/1.1 var(--font-sans)", color: "#fff", letterSpacing: "-.01em" }}>{t("admin.login.title")}</h1>
      <div className="card" style={{ marginTop: 14, padding: 20 }}>
        <LoginForm dev={provider.name === "dev"} devUsers={devUsers.map((u) => ({ email: u.email, name: u.full_name, superAdmin: u.is_super_admin }))} />
      </div>
      </div>
    </main>
  );
}
