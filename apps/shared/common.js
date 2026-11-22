/* Общие функции фронтенда Sergek Dent. Подключается на каждой странице как window.SG. */
window.SG = (() => {
  const TZ = "Asia/Almaty";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (name) => String(name).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // Перевод и локаль подключает i18n.js; до его загрузки работает русский.
  const tr = (s) => (window.SG?.t ? window.SG.t(s) : s);
  const loc = () => (window.SG?.locale ? window.SG.locale() : "ru-RU");

  const STATUS = { booked: "Записан", confirmed: "Подтверждён", arrived: "Пришёл", in_progress: "На приёме", ready: "Завершён", paid: "Оплачен", cancelled: "Отменён", no_show: "Не пришёл" };
  // Допустимые переходы — зеркало серверных правил; сервер всё равно проверяет сам.
  // Путь пациента: записан → подтверждён → пришёл → на приёме → завершён → оплачен.
  const NEXT = {
    booked: ["confirmed", "arrived", "cancelled", "no_show"],
    confirmed: ["arrived", "cancelled", "no_show"],
    arrived: ["in_progress", "paid", "no_show"], in_progress: ["ready", "paid"], ready: ["paid"],
    paid: [], cancelled: [], no_show: [],
  };
  const PAYABLE = ["booked", "confirmed", "arrived", "in_progress", "ready"];
  const PAY_METHODS = [["cash", "Наличные"], ["kaspi", "Каспи"], ["card", "Карта"], ["transfer", "Перевод"]];
  const statusLabel = (s) => tr(STATUS[s] ?? s);
  const statusChip = (s) => `<span class="status ${esc(s)}">${esc(statusLabel(s))}</span>`;
  /** «Зуб 36» + диагноз; пусто, если зуб в записи не указан. */
  const toothLabel = (a) => (a.toothName ? `${esc(a.toothName)} <span class="dx">${esc(a.toothDiagnosis)}</span>` : "");

  /* --- Время: всё показываем в часовом поясе клиники --- */
  const parts = (iso, opts) =>
    Object.fromEntries(new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, hour12: false, ...opts }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const fmtTime = (iso) => { const p = parts(iso, { hour: "2-digit", minute: "2-digit" }); return `${p.hour}:${p.minute}`; };
  const fmtDateTime = (iso) => {
    const p = parts(iso, { year: "numeric", month: "2-digit", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  };
  const fmtDay = (iso) => new Intl.DateTimeFormat(loc(), { timeZone: TZ, weekday: "short", day: "numeric", month: "long" }).format(new Date(iso));
  const today = () => { const p = parts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" }); return `${p.year}-${p.month}-${p.day}`; };
  const addDays = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
  const dayLabel = (date) => fmtDay(`${date}T12:00:00+05:00`);
  const money = (n) => `${Number(n).toLocaleString("ru-RU")} ₸`;

  /* --- Запросы --- */
  async function api(url, { method = "GET", body, on401 } = {}) {
    const res = await fetch(url, {
      method,
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && on401) on401();
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
    return data;
  }

  /* --- Подсказка внизу экрана --- */
  let toastTimer;
  function toast(text) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.append(el); }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /**
   * Диалог смены статуса записи. endpoint(id) — адрес PATCH; allowed — какие статусы доступны роли;
   * payEndpoint(id) — адрес оплаты через кассу (только у администратора).
   */
  function openStatusDialog({ appt, endpoint, allowed, payEndpoint, onChanged, on401 }) {
    const options = NEXT[appt.status].filter((s) => !allowed || allowed.includes(s)).filter((s) => !(payEndpoint && s === "paid"));
    const canPay = payEndpoint && PAYABLE.includes(appt.status);
    const dlg = document.createElement("dialog");
    const head = `<h2>${esc(appt.clientName)}</h2>
      <p class="hint" style="margin-bottom:14px">${appt.toothName ? `${toothLabel(appt)}<br>` : ""}${esc(appt.services)} · ${fmtDateTime(appt.startsAt)} ${statusChip(appt.status)}</p>`;
    const main = () => {
      dlg.innerHTML = `${head}${options.length || canPay
        ? `<div class="chips">${options.map((s) => `<button class="chip" data-s="${s}">${esc(statusLabel(s))}</button>`).join("")}${canPay ? `<button class="chip on" data-pay>${esc(tr("Оплатить"))} ${money(appt.priceTenge)}</button>` : ""}</div>`
        : `<p class="empty">${esc(tr("Статус изменить нельзя"))}</p>`}
        <div class="actions"><button class="btn ghost" data-close>${esc(tr("Закрыть"))}</button></div>`;
    };
    main();
    document.body.append(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", async (e) => {
      if (e.target.closest("[data-close]") || e.target === dlg) return dlg.close();
      if (e.target.closest("[data-pay]")) {
        dlg.innerHTML = `${head}<p class="hint" style="margin-bottom:10px">${esc(tr("Способ оплаты"))}</p>
          <div class="chips">${PAY_METHODS.map(([m, label]) => `<button class="chip" data-method="${m}">${esc(tr(label))}</button>`).join("")}</div>
          <div class="actions"><button class="btn ghost" data-close>${esc(tr("Закрыть"))}</button></div>`;
        return;
      }
      const m = e.target.closest("[data-method]");
      const s = e.target.closest("[data-s]");
      if (!m && !s) return;
      try {
        if (m) await api(payEndpoint(appt.id), { method: "POST", body: { method: m.dataset.method }, on401 });
        else await api(endpoint(appt.id), { method: "PATCH", body: { status: s.dataset.s }, on401 });
        dlg.close();
        toast(statusLabel(m ? "paid" : s.dataset.s));
        onChanged?.();
      } catch (err) { toast(err.message); }
    });
    dlg.showModal();
  }

  return { $, $$, esc, initials, STATUS, NEXT, PAYABLE, statusLabel, statusChip, toothLabel, fmtTime, fmtDateTime, fmtDay, today, addDays, dayLabel, money, api, toast, openStatusDialog };
})();
