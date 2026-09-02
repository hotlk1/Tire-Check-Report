import Link from "next/link";
import { Empty, fmtDate, PageHeader, Panel, Table, Td, Th, btnDanger, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/admin/ui";
import { getServerTranslator } from "@/i18n/server";
import { LOCALES } from "@/i18n";
import { canConfigure, requireAdmin } from "@/lib/auth/session";
import { formatUsPhone } from "@/lib/driver/phone";
import { getDriver, listDrivers } from "@/lib/repos/admin/drivers";
import { listTenantUsers } from "@/lib/repos/admin/users";
import { importDriversAction, inviteUserAction, removeUserAction, saveDriverAction, setDriverStatusAction, setUserRoleAction } from "./actions";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function DriversPage({ searchParams }: PageProps<"/admin/drivers">) {
  const session = await requireAdmin();
  const { t, locale } = await getServerTranslator();
  const sp = await searchParams;
  const status = (["active", "inactive"].includes(one(sp.status)) ? one(sp.status) : "all") as "active" | "inactive" | "all";
  const [drivers, users] = await Promise.all([listDrivers(session.scope, { q: one(sp.q), status }), listTenantUsers(session.scope)]);
  const editId = one(sp.edit);
  const editing = editId ? await getDriver(session.scope, editId) : null;
  const showForm = one(sp.add) === "1" || !!editing;
  const error = one(sp.error);
  const errorText = error === "phone_invalid" ? t("admin.drivers.phoneInvalid") : error === "duplicate_phone" ? t("admin.drivers.duplicatePhone") : error === "not_allowed" ? t("admin.common.notAllowed") : error ? t("admin.common.error", { message: error }) : null;
  const configure = canConfigure(session);

  return (
    <>
      <PageHeader
        title={t("admin.drivers.title")}
        subtitle={t("admin.common.total", { count: drivers.length })}
        actions={
          <>
            <Link className={btnSecondary} href="/admin/drivers?import=1">
              {t("admin.drivers.import")}
            </Link>
            <Link className={btnPrimary} href="/admin/drivers?add=1" data-testid="add-driver">
              + {t("admin.drivers.addDriver")}
            </Link>
          </>
        }
      />
      {errorText ? <div className="mb-3 rounded-[var(--radius)] bg-status-red-soft px-3 py-2 text-[13px] text-status-red">{errorText}</div> : null}
      {one(sp.saved) ? <div className="mb-3 rounded-[var(--radius)] bg-status-green-soft px-3 py-2 text-[13px] text-status-green">{t("admin.common.saved")}</div> : null}
      {one(sp.imported) ? (
        <div className="mb-3 rounded-[var(--radius)] bg-accent-soft px-3 py-2 text-[13px] text-accent">
          {t("admin.drivers.importResult", { created: one(sp.created), updated: one(sp.updated), skipped: one(sp.skipped) })}
          {one(sp.errors) ? (
            <div className="mt-1 text-[12px]">
              {t("admin.drivers.importErrors")}: {one(sp.errors)}
            </div>
          ) : null}
        </div>
      ) : null}

      {one(sp.import) === "1" ? (
        <Panel title={t("admin.drivers.import")} className="mb-4">
          <form action={importDriversAction} className="flex flex-wrap items-end gap-2">
            <input type="file" name="file" accept=".csv,text/csv" required className="text-[13px]" />
            <button type="submit" className={btnPrimary}>
              {t("admin.drivers.import")}
            </button>
            <span className="text-[12px] text-text-3">{t("admin.drivers.importHint")}</span>
          </form>
        </Panel>
      ) : null}

      {showForm ? (
        <Panel title={editing ? t("admin.drivers.editDriver") : t("admin.drivers.addDriver")} className="mb-4">
          <form action={saveDriverAction.bind(null, editing?.id ?? null)} className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <label className="text-[12px] text-text-2">
              {t("admin.drivers.name")} *
              <input name="full_name" required defaultValue={editing?.full_name ?? ""} className={inputCls} data-testid="driver-name" />
            </label>
            <label className="text-[12px] text-text-2">
              {t("admin.drivers.phone")} *
              <input name="phone" required inputMode="tel" defaultValue={editing?.phone ?? ""} className={inputCls} data-testid="driver-phone" />
            </label>
            <label className="text-[12px] text-text-2">
              {t("admin.drivers.language")}
              <select name="locale" defaultValue={editing?.locale ?? ""} className={selectCls}>
                <option value="">—</option>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {t(`locale.${l}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-text-2">
              {t("admin.common.status")}
              <select name="status" defaultValue={editing?.status ?? "active"} className={selectCls}>
                <option value="active">{t("admin.common.active")}</option>
                <option value="inactive">{t("admin.common.inactive")}</option>
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className={btnPrimary} data-testid="driver-save">
                {t("admin.common.save")}
              </button>
              <Link className={btnSecondary} href="/admin/drivers">
                {t("admin.common.cancel")}
              </Link>
            </div>
          </form>
        </Panel>
      ) : null}

      <form className="mb-3 flex flex-wrap items-end gap-2" method="get">
        <input name="q" defaultValue={one(sp.q)} placeholder={t("admin.common.search")} className={inputCls + " h-9 w-56"} />
        <select name="status" defaultValue={status} className={selectCls + " h-9 w-36"}>
          <option value="all">{t("admin.common.all")}</option>
          <option value="active">{t("admin.common.active")}</option>
          <option value="inactive">{t("admin.common.inactive")}</option>
        </select>
        <button className={btnSecondary} type="submit">
          {t("admin.common.apply")}
        </button>
      </form>
      {drivers.length === 0 ? (
        <Empty>{t("admin.common.noResults")}</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{t("admin.drivers.name")}</Th>
              <Th>{t("admin.drivers.phone")}</Th>
              <Th>{t("admin.drivers.language")}</Th>
              <Th>{t("admin.drivers.lastInspection")}</Th>
              <Th right>{t("admin.drivers.inspections30")}</Th>
              <Th>{t("admin.common.status")}</Th>
              <Th>{t("admin.common.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => (
              <tr key={d.id} className={"hover:bg-surface-2 " + (d.status === "inactive" ? "opacity-60" : "")}>
                <Td className="font-semibold">{d.full_name}</Td>
                <Td mono>{formatUsPhone(d.phone)}</Td>
                <Td>{d.locale ? t(`locale.${d.locale as "en"}`) : "—"}</Td>
                <Td>
                  <Link className="text-accent" href={`/admin/reports?driver=${d.id}`}>
                    {d.last_inspection_at ? fmtDate(d.last_inspection_at, locale) : t("admin.assets.never")}
                  </Link>
                </Td>
                <Td right>{d.inspections_30d}</Td>
                <Td>{t(d.status === "active" ? "admin.common.active" : "admin.common.inactive")}</Td>
                <Td>
                  <div className="flex gap-1">
                    <Link className={btnSecondary + " h-7 px-2 text-[12px]"} href={`/admin/drivers?edit=${d.id}`}>
                      {t("admin.common.edit")}
                    </Link>
                    <form action={setDriverStatusAction.bind(null, d.id)}>
                      <input type="hidden" name="status" value={d.status === "active" ? "inactive" : "active"} />
                      <button type="submit" className={(d.status === "active" ? btnDanger : btnSecondary) + " h-7 px-2 text-[12px]"}>
                        {t(d.status === "active" ? "admin.common.deactivate" : "admin.common.activate")}
                      </button>
                    </form>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Panel title={t("admin.drivers.users")} className="mt-6">
        <div id="users" />
        {configure ? (
          <form action={inviteUserAction} className="mb-3 flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-text-2">
              {t("admin.drivers.email")}
              <input name="email" type="email" required className={inputCls + " h-9 w-64"} data-testid="invite-email" />
            </label>
            <label className="text-[12px] text-text-2">
              {t("admin.drivers.role")}
              <select name="role" defaultValue="editor" className={selectCls + " h-9 w-36"}>
                <option value="editor">{t("admin.drivers.roles.editor")}</option>
                <option value="admin">{t("admin.drivers.roles.admin")}</option>
              </select>
            </label>
            <button type="submit" className={btnPrimary} data-testid="invite-submit">
              {t("admin.drivers.inviteUser")}
            </button>
            <span className="text-[12px] text-text-3">{t("admin.drivers.inviteHint")}</span>
          </form>
        ) : null}
        <Table>
          <thead>
            <tr>
              <Th>{t("admin.drivers.email")}</Th>
              <Th>{t("admin.drivers.name")}</Th>
              <Th>{t("admin.drivers.role")}</Th>
              <Th>{t("admin.common.created")}</Th>
              <Th>{t("admin.common.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.membership_id}>
                <Td className="font-semibold">
                  {u.email} {u.user_id === session.user.id ? <span className="text-text-3">({t("admin.drivers.you")})</span> : null}
                </Td>
                <Td>{u.full_name ?? "—"}</Td>
                <Td>
                  {configure && u.user_id !== session.user.id && !u.is_super_admin ? (
                    <form action={setUserRoleAction.bind(null, u.membership_id)} className="flex items-center gap-1">
                      <select name="role" defaultValue={u.role} className={selectCls + " h-7 w-28 text-[12px]"}>
                        <option value="editor">{t("admin.drivers.roles.editor")}</option>
                        <option value="admin">{t("admin.drivers.roles.admin")}</option>
                      </select>
                      <button type="submit" className={btnSecondary + " h-7 px-2 text-[12px]"}>
                        ✓
                      </button>
                    </form>
                  ) : (
                    t(`admin.drivers.roles.${u.is_super_admin ? "super_admin" : u.role}`)
                  )}
                </Td>
                <Td>{fmtDate(u.created_at, locale, false)}</Td>
                <Td>
                  {configure && u.user_id !== session.user.id ? (
                    <form action={removeUserAction.bind(null, u.membership_id)}>
                      <button type="submit" className={btnDanger + " h-7 px-2 text-[12px]"}>
                        {t("admin.drivers.removeUser")}
                      </button>
                    </form>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
