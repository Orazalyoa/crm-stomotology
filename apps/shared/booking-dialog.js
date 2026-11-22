/* Диалог «Новая запись» для администратора: пациент → зуб → врач → услуги → дата → время. */
SG.openBookingDialog = async function ({ onCreated, on401 }) {
  const { $, esc, api, toast, money, fmtTime } = SG;
  const [masters, services, clients] = await Promise.all([
    api("/api/staff/masters", { on401 }), api("/api/staff/services", { on401 }), api("/api/staff/clients", { on401 }),
  ]);

  const dlg = document.createElement("dialog");
  dlg.innerHTML = `<h2>Новая запись</h2>
    <div class="field"><label for="bd-client">Пациент</label>
      <select id="bd-client"><option value="">— новый пациент —</option>${clients.map((c) => `<option value="${c.id}">${esc(c.fullName)} · ${esc(c.phone)}</option>`).join("")}</select></div>
    <div id="bd-new">
      <div class="field"><label for="bd-name">Имя</label><input id="bd-name" autocomplete="off"></div>
      <div class="field"><label for="bd-phone">Телефон</label><input id="bd-phone" type="tel" inputmode="tel" placeholder="+7 701 000 00 00"></div>
    </div>
    <div class="field hidden" id="bd-tooth-pick"><label for="bd-tooth">Зуб (по карте пациента)</label><select id="bd-tooth"></select></div>
    <div class="field"><label for="bd-master">Врач</label>
      <select id="bd-master">${masters.map((m) => `<option value="${m.id}">${esc(m.fullName)}</option>`).join("")}</select></div>
    <div class="field"><label>Услуги</label>
      ${services.map((s) => `<label class="check"><span>${esc(s.name)}<br><span class="hint">${s.durationMin} мин</span></span><span>${money(s.priceTenge)} <input type="checkbox" value="${s.id}"></span></label>`).join("")}</div>
    <div class="field"><label for="bd-date">Дата</label><input id="bd-date" type="date" min="${SG.today()}" value="${SG.today()}"></div>
    <div class="field"><label>Время</label><div class="chips" id="bd-slots"><span class="hint">Выберите врача, услуги и дату</span></div></div>
    <p class="error" id="bd-error" role="alert"></p>
    <div class="actions"><button class="btn ghost" data-close>Отмена</button><button class="btn" id="bd-save" disabled>Записать</button></div>`;
  document.body.append(dlg);
  dlg.addEventListener("close", () => dlg.remove());

  let chosen = null;
  let createdClient = null; // при повторе после занятого слота не создаём пациента второй раз
  const $$checked = () => [...dlg.querySelectorAll('input[type="checkbox"]:checked')];
  const serviceIds = () => $$checked().map((c) => c.value);

  /** Зубы выбранного пациента из его карты; приём можно не привязывать к зубу (чистка, консультация). */
  async function loadTeeth(clientId) {
    const pick = $("#bd-tooth-pick", dlg);
    if (!clientId) { pick.classList.add("hidden"); return; }
    const teeth = await api(`/api/staff/teeth?clientId=${clientId}`, { on401 });
    $("#bd-tooth", dlg).innerHTML = `<option value="">— без привязки к зубу —</option>` + teeth.map((v) => `<option value="${v.id}">Зуб ${esc(v.toothNo)} · ${esc(v.diagnosis)}</option>`).join("");
    pick.classList.toggle("hidden", teeth.length === 0);
  }

  async function loadSlots() {
    chosen = null; $("#bd-save", dlg).disabled = true;
    const box = $("#bd-slots", dlg);
    const ids = serviceIds();
    if (!ids.length) { box.innerHTML = `<span class="hint">Выберите услуги</span>`; return; }
    try {
      const q = new URLSearchParams({ masterId: $("#bd-master", dlg).value, date: $("#bd-date", dlg).value, serviceIds: ids.join(",") });
      const { slots } = await api(`/api/staff/slots?${q}`, { on401 });
      box.innerHTML = slots.length
        ? slots.map((s) => `<button class="chip" data-slot="${s}">${fmtTime(s)}</button>`).join("")
        : `<span class="hint">Свободного времени нет</span>`;
    } catch (e) { box.innerHTML = `<span class="error">${esc(e.message)}</span>`; }
  }

  dlg.addEventListener("change", (e) => {
    if (e.target.id === "bd-client") {
      $("#bd-new", dlg).classList.toggle("hidden", !!e.target.value);
      loadTeeth(e.target.value).catch((ex) => toast(ex.message));
    } else if (e.target.id !== "bd-tooth") loadSlots();
  });
  dlg.addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]") || e.target === dlg) return dlg.close();
    const slot = e.target.closest("[data-slot]");
    if (slot) {
      dlg.querySelectorAll("[data-slot]").forEach((b) => b.classList.toggle("on", b === slot));
      chosen = slot.dataset.slot; $("#bd-save", dlg).disabled = false;
    }
    if (e.target.id === "bd-save") {
      const err = $("#bd-error", dlg); err.textContent = "";
      const toothId = $("#bd-client", dlg).value ? $("#bd-tooth", dlg).value || null : null;
      e.target.disabled = true;
      try {
        let clientId = $("#bd-client", dlg).value || createdClient;
        if (!clientId) {
          clientId = createdClient = (await api("/api/staff/clients", { method: "POST", body: { fullName: $("#bd-name", dlg).value, phone: $("#bd-phone", dlg).value }, on401 })).id;
        }
        await api("/api/staff/appointments", { method: "POST", body: { masterId: $("#bd-master", dlg).value, clientId, toothId, serviceIds: serviceIds(), startsAt: chosen }, on401 });
        dlg.close(); toast("Запись создана"); onCreated?.();
      } catch (ex) {
        err.textContent = ex.message;
        e.target.disabled = false; loadSlots();
      }
    }
  });
  dlg.showModal();
};
