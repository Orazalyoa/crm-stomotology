/* Разделы админки: календарь, пациенты, услуги, врачи, касса, отчёты, настройки.
   Подключается после common.js; регистрирует window.Pages. */
(() => {
  const { $, $$, esc, api, toast, money, fmtDateTime, fmtTime, statusChip, toothLabel, today, addDays, initials } = SG;
  const toLogin = () => location.replace("./login.html");
  const get = (u) => api(u, { on401: toLogin });
  const send = (method, u, body) => api(u, { method, body, on401: toLogin });
  const isOwner = () => window.Me?.role === "owner";
  const fail = (e) => toast(e.message);

  /* ----------------------------------- стили ----------------------------------- */
  const style = document.createElement("style");
  style.textContent = `
    .panel { margin-bottom: 28px; }
    .ph { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 20px 0 14px; border-bottom: 1px solid var(--line); margin-bottom: 14px; }
    .ph h2 { font-size: 20px; font-weight: 600; }
    .row-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .in-sm { height: 36px; background: #fff; border: 1px solid var(--field-line); border-radius: var(--r-ctl); padding: 0 12px; font-size: 13px; outline: none; transition: border-color .25s var(--ease), box-shadow .25s var(--ease); }
    textarea.in-sm { height: auto; padding: 10px 12px; }
    .in-sm:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
    .btn-sm { height: 36px; display: inline-flex; align-items: center; justify-content: center; background: var(--accent); color: #fff; border-radius: var(--r-ctl); padding: 0 14px; font-size: 13px; font-weight: 500; white-space: nowrap; transition: transform .2s var(--ease), background .2s var(--ease), box-shadow .2s var(--ease); }
    .btn-sm:hover { background: var(--accent-dark); transform: translateY(-1px); box-shadow: var(--shadow-lift); }
    .btn-sm:active { transform: scale(.97); }
    .btn-sm.ghost { background: #fff; color: var(--ink); border: 1px solid var(--field-line); }
    .btn-sm.ghost:hover { background: var(--hover); }
    .btn-sm.danger { background: #fff; color: var(--danger); border: 1px solid var(--field-line); }
    .btn-sm:disabled { opacity: .4; transform: none; box-shadow: none; }
    .table-wrap { overflow-x: auto; scrollbar-width: thin; scrollbar-color: #C9C9D1 transparent; }
    table.t { width: 100%; border-collapse: collapse; }
    table.t th { height: 40px; text-align: left; font-size: 11px; font-weight: 500; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; padding: 0 12px; white-space: nowrap; }
    table.t td { min-height: 44px; padding: 8px 12px; border-top: 1px solid var(--row-line); vertical-align: middle; color: var(--muted); }
    table.t td b { color: var(--ink); font-weight: 500; }
    table.t tr.click { cursor: pointer; transition: background .2s var(--ease); } table.t tr.click:hover { background: var(--hover); }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); border: 1px solid var(--line); border-radius: var(--r-card); margin-bottom: 18px; overflow: hidden; }
    .kpi { padding: 14px 16px; border-left: 1px solid var(--line); } .kpi:first-child { border-left: 0; }
    .kpi span { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); } .kpi b { display: block; font-size: 20px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    .bars { display: flex; align-items: flex-end; gap: 3px; height: 150px; }
    .bars i { flex: 1; background: var(--ink); border-radius: 3px 3px 0 0; min-height: 2px; opacity: .85; transition: opacity .2s, height .5s var(--ease); } .bars i:hover { opacity: 1; }
    .hbar span:last-child { white-space: nowrap; text-align: right; }
    .hbar { display: grid; grid-template-columns: 130px 1fr 150px; align-items: center; gap: 10px; margin: 8px 0; font-size: 13px; }
    .hbar div { background: var(--stone); border-radius: 99px; height: 8px; overflow: hidden; } .hbar div i { display: block; height: 100%; background: var(--ink); border-radius: 99px; }
    .cal { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r-card); }
    .cal-grid { display: grid; grid-template-columns: 52px repeat(var(--cols), minmax(150px, 1fr)); min-width: 600px; }
    .cal-head { font-size: 12px; font-weight: 600; padding: 10px 6px; text-align: center; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: #fff; }
    .cal-axis { position: relative; } .cal-axis span { position: absolute; right: 8px; font-size: 11px; color: var(--muted); transform: translateY(-50%); }
    .cal-col { position: relative; border-left: 1px solid var(--line); background-color: #F7F7F9; }
    .cal-work { position: absolute; left: 0; right: 0; background: #fff; background-image: repeating-linear-gradient(#EDEDF0 0 1px, transparent 1px calc(var(--hour) * 1px)); }
    .ev { --c: #7C4DFF; --bg: #F1EBFF; position: absolute; left: 3px; right: 3px; border-radius: 8px; padding: 4px 8px; font-size: 11px; line-height: 1.3; overflow: hidden; text-align: left; border: 1px solid color-mix(in srgb, var(--c) 40%, #fff); border-left: 3px solid var(--c); background: var(--bg); transition: transform .15s var(--ease), box-shadow .15s; }
    .ev:hover { transform: scale(1.02); box-shadow: var(--shadow-lift); z-index: 2; }
    .ev.confirmed { --c: #2F4BFF; --bg: #E8EDFF; } .ev.arrived { --c: #8A8A94; --bg: #F3F3F6; } .ev.in_progress { --c: #F5A623; --bg: #FFF4E5; }
    .ev.ready { --c: #14B8A6; --bg: #E6F8F5; } .ev.paid { --c: #2FB26A; --bg: #E9F8EE; }
    .ev b { display: block; font-weight: 600; }
    .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .tagbox { display: flex; gap: 6px; flex-wrap: wrap; }
    .tag { background: var(--stone); border-radius: 99px; padding: 2px 10px; font-size: 11px; color: var(--ink); }
    .sched-row { display: grid; grid-template-columns: 40px repeat(4, 1fr); gap: 6px; align-items: center; margin-bottom: 8px; font-size: 13px; }
    .draft { border: 1px solid var(--field-line); border-left: 3px solid var(--accent); border-radius: 10px; padding: 12px; margin-top: 10px; font-size: 13px; }
    .muted-box { background: var(--hover); border: 1px solid var(--line); border-radius: var(--r-ctl); padding: 12px; font-size: 13px; }
    code.k { background: var(--stone); padding: 4px 8px; border-radius: 8px; word-break: break-all; font-size: 12px; }
    .teeth { display: grid; gap: 4px; margin: 8px 0 4px; }
    .teeth-row { display: grid; grid-template-columns: repeat(16, minmax(0, 1fr)); gap: 3px; }
    .tooth { aspect-ratio: 1 / 1.15; min-width: 0; padding: 0; font-size: 10px; border: 1px solid var(--field-line); border-radius: 6px 6px 9px 9px; background: #fff; color: var(--muted); transition: background .2s, transform .2s var(--ease), border-color .2s; }
    .tooth:hover { background: var(--hover); transform: translateY(-1px); }
    .tooth.has { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-dark); font-weight: 600; }
    .car-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--row-line); font-size: 13px; }
    .card .emp { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
    @media (max-width: 760px) { .hbar { grid-template-columns: 90px 1fr 70px; } }
  `;
  document.head.append(style);

  const panel = (title, tools, body) =>
    `<section class="panel"><div class="ph"><h2>${esc(title)}</h2><div class="row-tools">${tools ?? ""}</div></div>${body}</section>`;

  const dialog = (html, onReady) => {
    const dlg = document.createElement("dialog");
    dlg.style.width = "min(640px, calc(100vw - 24px))";
    dlg.innerHTML = html;
    document.body.append(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
    dlg.showModal();
    onReady?.(dlg);
    return dlg;
  };

  const minToTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const timeToMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const dayMinutes = (iso) => { const [h, m] = fmtTime(iso).split(":").map(Number); return h * 60 + m; };
  const monthStart = () => `${today().slice(0, 8)}01`;

  const Pages = (window.Pages = {});

  /* ---------------------------------- календарь ---------------------------------- */
  Pages.calendar = async (root) => {
    let date = today();
    const PX = 1.15; // пикселей на минуту
    async function draw() {
      const d = await get(`/api/staff/day?date=${date}`);
      const all = d.masters.flatMap((m) => m.intervals);
      const from = Math.floor(Math.min(480, ...all.map((i) => i.start)) / 60) * 60;
      const to = Math.ceil(Math.max(1200, ...all.map((i) => i.end)) / 60) * 60;
      const height = (to - from) * PX;
      const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
      root.innerHTML = panel("Календарь",
        `<button class="btn-sm ghost" id="c-prev" aria-label="Предыдущий день">←</button><input class="in-sm" type="date" id="c-date" value="${date}" aria-label="Дата"><button class="btn-sm ghost" id="c-next" aria-label="Следующий день">→</button><button class="btn-sm ghost" id="c-today">Сегодня</button><button class="btn-sm" id="c-new">+ Новая запись</button>`,
        `<div class="cal"><div class="cal-grid" style="--cols:${d.masters.length};--hour:${60 * PX}">
          <div class="cal-head"></div>${d.masters.map((m) => `<div class="cal-head">${esc(m.fullName)}</div>`).join("")}
          <div class="cal-axis" style="height:${height}px">${hours.map((h) => `<span style="top:${(h - from) * PX}px">${minToTime(h)}</span>`).join("")}</div>
          ${d.masters.map((m) => `<div class="cal-col" style="height:${height}px">
            ${m.intervals.map((i) => `<div class="cal-work" style="top:${(i.start - from) * PX}px;height:${(i.end - i.start) * PX}px"></div>`).join("")}
            ${d.appointments.filter((a) => a.masterId === m.id).map((a) => {
              const s = dayMinutes(a.startsAt), e = dayMinutes(a.endsAt);
              const car = a.toothName ? `${esc(a.clientName)} · ${esc(a.toothName)}` : esc(a.clientName);
              return `<button class="ev ${esc(a.status)}" data-id="${a.id}" style="top:${(s - from) * PX}px;height:${Math.max(24, (e - s) * PX - 2)}px"><b>${fmtTime(a.startsAt)} ${car}</b>${esc(a.services)}</button>`;
            }).join("")}</div>`).join("")}
        </div></div>${d.masters.length ? "" : '<p class="empty">Нет активных врачей</p>'}`);
      const byId = Object.fromEntries(d.appointments.map((a) => [a.id, a]));
      $("#c-prev").onclick = () => { date = addDays(date, -1); draw(); };
      $("#c-next").onclick = () => { date = addDays(date, 1); draw(); };
      $("#c-today").onclick = () => { date = today(); draw(); };
      $("#c-date").onchange = (e) => { if (e.target.value) { date = e.target.value; draw(); } };
      $("#c-new").onclick = () => SG.openBookingDialog({ onCreated: draw, on401: toLogin }).catch(fail);
      $$(".ev", root).forEach((b) => b.addEventListener("click", () =>
        SG.openStatusDialog({ appt: byId[b.dataset.id], endpoint: (id) => `/api/staff/appointments/${id}`, payEndpoint: (id) => `/api/staff/appointments/${id}/pay`, onChanged: draw, on401: toLogin })));
    }
    draw().catch(fail);
  };

  /* ----------------------------------- услуги ----------------------------------- */
  Pages.services = async (root) => {
    async function draw() {
      const list = await get("/api/staff/services/all");
      root.innerHTML = panel("Услуги", "",
        `<div class="row-tools" style="margin-bottom:14px"><input class="in-sm" id="s-name" placeholder="Название услуги" aria-label="Название услуги"><input class="in-sm" id="s-min" type="number" min="5" step="5" placeholder="Минут" aria-label="Минут" style="width:100px"><input class="in-sm" id="s-price" type="number" min="0" step="500" placeholder="Цена, ₸" aria-label="Цена, ₸" style="width:120px"><button class="btn-sm" id="s-add">Добавить</button></div>
        <div class="table-wrap"><table class="t mobile-cards" id="servicesTable"><thead><tr><th>Название</th><th>Минут</th><th>Цена, ₸</th><th>Показывать в записи</th><th></th></tr></thead><tbody>
        ${list.map((s) => `<tr data-id="${s.id}" style="${s.active ? "" : "opacity:.5"}">
          <td data-label="Услуга"><input class="in-sm" data-f="name" value="${esc(s.name)}" aria-label="Название"></td>
          <td data-label="Минуты"><input class="in-sm" data-f="durationMin" type="number" value="${s.durationMin}" aria-label="Минут" style="width:90px"></td>
          <td data-label="Цена, ₸"><input class="in-sm" data-f="priceTenge" type="number" value="${s.priceTenge}" aria-label="Цена" style="width:110px"></td>
          <td data-label="В записи"><button class="btn-sm ${s.active ? "" : "ghost"}" data-toggle>${s.active ? "Да" : "Нет"}</button></td>
          <td data-label="Действие"><button class="btn-sm ghost" data-save>Сохранить</button></td></tr>`).join("")}
        </tbody></table></div>`);
      $("#s-add").onclick = async () => {
        try { await send("POST", "/api/staff/services", { name: $("#s-name").value, durationMin: Number($("#s-min").value), priceTenge: Number($("#s-price").value) }); toast("Услуга добавлена"); draw(); } catch (e) { fail(e); }
      };
      $$("tr[data-id]", root).forEach((tr) => {
        tr.querySelector("[data-save]").onclick = async () => {
          const body = {}; tr.querySelectorAll("[data-f]").forEach((i) => { body[i.dataset.f] = i.type === "number" ? Number(i.value) : i.value; });
          try { await send("PATCH", `/api/staff/services/${tr.dataset.id}`, body); toast("Сохранено"); } catch (e) { fail(e); }
        };
        tr.querySelector("[data-toggle]").onclick = async () => {
          const s = list.find((x) => x.id === tr.dataset.id);
          try { await send("PATCH", `/api/staff/services/${s.id}`, { active: !s.active }); draw(); } catch (e) { fail(e); }
        };
      });
    }
    draw().catch(fail);
  };

  /* ----------------------------------- клиенты ----------------------------------- */
  Pages.clients = async (root) => {
    root.innerHTML = panel("Пациенты",
      `<input class="in-sm" id="cl-q" placeholder="Имя, телефон или зуб" aria-label="Поиск пациентов" style="width:230px"><select class="in-sm" id="cl-seg" aria-label="Сегмент"><option value="">Все</option><option value="lapsed60">Не были 6 месяцев (пора на профосмотр)</option><option value="new">Новые (30 дней)</option><option value="never">Ещё не приходили</option></select>`,
      `<div class="table-wrap"><table class="t mobile-cards" id="clientsTable"><thead><tr><th>Пациент</th><th>Телефон</th><th>Зубы в карте</th><th>Теги</th><th>Визитов</th><th>Последний визит</th></tr></thead><tbody id="cl-rows"></tbody></table></div>`);
    let timer;
    async function load() {
      const qs = new URLSearchParams({ q: $("#cl-q").value.trim(), segment: $("#cl-seg").value });
      const list = await get(`/api/staff/clients?${qs}`);
      $("#cl-rows").innerHTML = list.length ? list.map((c) => `<tr class="click" data-id="${c.id}"><td data-label="Пациент"><b>${esc(c.fullName)}</b></td><td data-label="Телефон">${esc(c.phone)}</td><td data-label="Зубы в карте">${esc(c.teeth || "—")}</td>
        <td data-label="Теги"><div class="tagbox">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div></td><td data-label="Визитов">${c.visits}</td><td data-label="Последний визит">${c.lastVisit ? fmtDateTime(c.lastVisit).slice(0, 10) : "—"}</td></tr>`).join("") : `<tr class="empty-row"><td colspan="6" class="empty">Никого не найдено</td></tr>`;
    }
    $("#cl-q").oninput = () => { clearTimeout(timer); timer = setTimeout(() => load().catch(fail), 250); };
    $("#cl-seg").onchange = () => load().catch(fail);
    $("#cl-rows").onclick = (e) => { const tr = e.target.closest("tr[data-id]"); if (tr) openClient(tr.dataset.id, load); };
    load().catch(fail);
  };

  async function openClient(id, onSaved) {
    const [c, fields] = await Promise.all([get(`/api/staff/clients/${id}`), get("/api/staff/custom-fields")]);
    const input = (f) => {
      const v = c.custom[f.key];
      if (f.type === "checkbox") return `<label class="check" style="margin:0"><span>${esc(f.label)}</span><input type="checkbox" data-k="${f.key}" ${v ? "checked" : ""}></label>`;
      if (f.type === "select") return `<div class="field"><label>${esc(f.label)}</label><select data-k="${f.key}"><option value=""></option>${f.options.map((o) => `<option ${v === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`;
      return `<div class="field"><label>${esc(f.label)}${f.type === "money" ? ", ₸" : ""}</label><input data-k="${f.key}" type="${f.type === "money" ? "number" : "text"}" value="${esc(v ?? "")}"></div>`;
    };
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    dialog(`<h2>${esc(c.fullName)}</h2>
      <p class="hint" style="margin-bottom:14px">${esc(c.phone)} · визитов: ${c.visits} · оплачено: ${money(c.spent)}</p>
      <div class="field-row"><div class="field"><label>Имя</label><input id="cd-name" value="${esc(c.fullName)}"></div><div class="field"><label>Теги (через запятую)</label><input id="cd-tags" value="${esc(c.tags.join(", "))}"></div></div>
      <div style="margin-bottom:14px"><div class="row-tools" style="justify-content:space-between"><b style="font-weight:500">Зубная формула</b><button class="btn-sm ghost" id="cd-addcar">+ Добавить зуб</button></div>
        ${toothChart(c.teeth)}
        ${c.teeth.map((v) => `<div class="car-row"><span><b style="font-weight:500">Зуб ${esc(v.toothNo)}</b> <span class="dx">${esc(v.diagnosis)}</span> <span class="hint">${esc(v.notes)}</span></span><button class="btn-sm ghost" data-car="${v.id}">Изменить</button></div>`).join("") || '<p class="hint" style="margin-top:6px">В карте пока нет отмеченных зубов — нажмите на номер зуба</p>'}</div>
      <div class="field"><label>Заметки</label><textarea id="cd-notes" rows="3" class="in-sm" style="width:100%;font-size:14px">${esc(c.notes)}</textarea></div>
      ${fields.length ? `<div class="field-row" id="cd-custom">${fields.map(input).join("")}</div>` : `<p class="hint">Свои поля (аллергии, хронические заболевания, беременность) добавляются в «Настройках».</p>`}
      <div class="muted-box" style="margin:12px 0"><b style="font-weight:500">Диктовка</b>
        <div class="row-tools" style="margin:8px 0"><button class="btn-sm ghost" id="cd-mic" ${SR ? "" : "disabled"}>🎤 Говорить</button><button class="btn-sm" id="cd-ai">Разобрать</button></div>
        <textarea id="cd-dict" rows="2" class="in-sm" placeholder="${SR ? "Нажмите «Говорить» или печатайте…" : "Голосовой ввод есть в Chrome, Edge и Safari. Можно печатать."}" style="width:100%;font-size:14px"></textarea>
        <div id="cd-draft"></div></div>
      <details><summary class="hint" style="cursor:pointer">История визитов (${c.history.length})</summary>
        ${c.history.map((h) => `<div style="padding:8px 0;border-top:1px solid var(--row-line);font-size:13px">${fmtDateTime(h.startsAt)} · ${h.toothName ? `${esc(h.toothName)} ${esc(h.toothDiagnosis)} · ` : ""}${esc(h.services)} · ${esc(h.masterName)} · ${money(h.priceTenge)} ${statusChip(h.status)}</div>`).join("") || '<p class="empty">Пока нет</p>'}</details>
      <div class="actions"><button class="btn ghost" data-close>Закрыть</button><button class="btn" id="cd-save">Сохранить</button></div>`,
    (dlg) => {
      const q = (s) => dlg.querySelector(s);
      const reopen = () => { dlg.close(); openClient(id, onSaved).catch(fail); };
      q("#cd-addcar").onclick = () => toothDialog({ clientId: id, onSaved: reopen });
      dlg.querySelectorAll("[data-tooth]").forEach((b) => b.onclick = () => toothDialog({ tooth: c.teeth.find((v) => v.toothNo === b.dataset.tooth), toothNo: b.dataset.tooth, clientId: id, onSaved: reopen }));
      dlg.querySelectorAll("[data-car]").forEach((b) => b.onclick = () => toothDialog({ tooth: c.teeth.find((v) => v.id === b.dataset.car), clientId: id, onSaved: reopen }));
      let rec;
      if (SR) q("#cd-mic").onclick = () => {
        if (rec) { rec.stop(); return; }
        rec = new SR(); rec.lang = "ru-RU"; rec.interimResults = false;
        rec.onresult = (e) => { q("#cd-dict").value += (q("#cd-dict").value ? " " : "") + [...e.results].map((r) => r[0].transcript).join(" "); };
        rec.onend = () => { rec = null; q("#cd-mic").textContent = "🎤 Говорить"; };
        rec.start(); q("#cd-mic").textContent = "⏹ Стоп";
      };
      // ИИ только предлагает черновик; в карточку он попадает после «Применить» и «Сохранить» (ADR-0003)
      q("#cd-ai").onclick = async () => {
        try {
          const draft = await send("POST", "/api/staff/ai/dictation", { text: q("#cd-dict").value });
          q("#cd-draft").innerHTML = `<div class="draft"><b style="font-weight:500">Предложение${draft.source === "claude" ? " ИИ" : " (по правилам)"}</b><p style="margin:6px 0">${esc(draft.note)}</p>
            ${draft.tags.length ? `<div class="tagbox" style="margin-bottom:8px">${draft.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
            <button class="btn-sm" id="cd-apply">Применить к карточке</button></div>`;
          q("#cd-apply").onclick = () => {
            const stamp = fmtDateTime(new Date().toISOString()).slice(0, 10);
            q("#cd-notes").value = [q("#cd-notes").value.trim(), `${stamp}: ${draft.note}`].filter(Boolean).join("\n");
            q("#cd-tags").value = [...new Set([...q("#cd-tags").value.split(",").map((t) => t.trim()).filter(Boolean), ...draft.tags])].join(", ");
            for (const [k, v] of Object.entries(draft.custom ?? {})) { const el = q(`[data-k="${k}"]`); if (el) el.type === "checkbox" ? (el.checked = !!v) : (el.value = v); }
            toast("Применено — нажмите «Сохранить»");
          };
        } catch (e) { fail(e); }
      };
      q("#cd-save").onclick = async () => {
        const custom = {};
        dlg.querySelectorAll("[data-k]").forEach((el) => {
          custom[el.dataset.k] = el.type === "checkbox" ? (el.checked ? true : null) : el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value || null;
        });
        try {
          await send("PATCH", `/api/staff/clients/${id}`, { fullName: q("#cd-name").value, notes: q("#cd-notes").value, tags: q("#cd-tags").value.split(",").map((t) => t.trim()).filter(Boolean), custom });
          dlg.close(); toast("Карточка сохранена"); onSaved?.();
        } catch (e) { fail(e); }
      };
    });
  }

  /* ---------------------------------- зубы пациента ---------------------------------- */
  /** Зубная формула (FDI): верхний ряд 18…11 | 21…28, нижний 48…41 | 31…38. Зубы с записями подсвечены. */
  const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
  const toothChart = (teeth) => {
    const has = new Map(teeth.map((t) => [t.toothNo, t.diagnosis]));
    const row = (nums) => `<div class="teeth-row">${nums.map((n) => `<button class="tooth ${has.has(String(n)) ? "has" : ""}" data-tooth="${n}" aria-label="Зуб ${n}${has.has(String(n)) ? ": " + esc(has.get(String(n))) : ""}" title="${has.has(String(n)) ? esc(has.get(String(n))) : "Зуб " + n}">${n}</button>`).join("")}</div>`;
    return `<div class="teeth">${row(UPPER)}${row(LOWER)}</div>`;
  };
  const DIAGNOSES = ["Кариес", "Глубокий кариес", "Пульпит", "Периодонтит", "Пломба", "Коронка", "Имплант", "Отсутствует", "Скол", "Клиновидный дефект", "Гингивит", "Подвижность"];
  const ALL_TEETH = [...UPPER, ...LOWER].sort((x, y) => x - y);

  /** Форма зуба: новый (clientId + необязательный номер) или правка существующего. */
  async function toothDialog({ tooth, toothNo, clientId, onSaved }) {
    const v = tooth ?? { toothNo: toothNo ?? "" };
    dialog(`<h2>${tooth ? `Зуб ${esc(v.toothNo)}` : "Новый зуб в карте"}</h2>
      <div class="field"><label for="td-no">Номер зуба (FDI)</label>
        <input id="td-no" list="td-nums" inputmode="numeric" maxlength="2" value="${esc(v.toothNo)}" placeholder="например 36"><datalist id="td-nums">${ALL_TEETH.map((n) => `<option value="${n}">`).join("")}</datalist></div>
      <div class="field"><label for="td-dx">Диагноз / состояние</label>
        <input id="td-dx" list="td-dxs" maxlength="120" value="${esc(v.diagnosis ?? "")}" placeholder="Кариес, пломба, имплант…"><datalist id="td-dxs">${DIAGNOSES.map((d) => `<option value="${d}">`).join("")}</datalist></div>
      <div class="field"><label for="td-notes">Заметка</label><input id="td-notes" maxlength="300" value="${esc(v.notes ?? "")}" placeholder="Поверхность, материал, дата лечения"></div>
      <p class="error" id="td-err" role="alert"></p>
      <div class="actions">${tooth ? `<button class="btn danger" id="td-del" style="flex:0 0 auto">Удалить</button>` : ""}<button class="btn ghost" data-close>Отмена</button><button class="btn" id="td-save">Сохранить</button></div>`,
    (dlg) => {
      const q = (s) => dlg.querySelector(s);
      q("#td-save").onclick = async () => {
        const body = { toothNo: q("#td-no").value.trim(), diagnosis: q("#td-dx").value, notes: q("#td-notes").value };
        try {
          if (tooth) await send("PATCH", `/api/staff/teeth/${tooth.id}`, body);
          else await send("POST", "/api/staff/teeth", { ...body, clientId });
          dlg.close(); toast("Зуб сохранён"); onSaved?.();
        } catch (e) { q("#td-err").textContent = e.status === 409 ? "Этот зуб уже есть в карте — откройте его и измените" : e.status === 400 ? "Проверьте номер зуба (11–48, молочные 51–85) и диагноз" : e.message; }
      };
      q("#td-del")?.addEventListener("click", async () => {
        if (!confirm(`Удалить зуб ${tooth.toothNo} (${tooth.diagnosis}) из карты? В прошлых приёмах отметка о зубе пропадёт.`)) return;
        try { await send("DELETE", `/api/staff/teeth/${tooth.id}`); dlg.close(); toast("Зуб удалён из карты"); onSaved?.(); } catch (e) { fail(e); }
      });
    });
  }

  /* ----------------------------------- врачи ----------------------------------- */
  const WEEK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  Pages.masters = async (root) => {
    async function draw() {
      const list = await get("/api/staff/masters/full");
      root.innerHTML = panel("Врачи и график", isOwner() ? `<button class="btn-sm" id="m-add">+ Добавить врача</button>` : "",
        `<div class="cols">${list.map((m) => `<div class="card" data-id="${m.id}" style="${m.active ? "" : "opacity:.55"}">
          <div class="emp"><span class="avatar" style="width:40px;height:40px">${esc(initials(m.fullName))}</span><div><b style="font-weight:500">${esc(m.fullName)}</b><br><span class="hint">${esc(m.email ?? "")}${m.active ? "" : " · не работает"}</span></div></div>
          <div class="hint" style="margin-bottom:10px">${WEEK.map((w, i) => { const iv = m.schedule.filter((s) => s.weekday === i + 1); return iv.length ? `${w} ${iv.map((s) => minToTime(s.start) + "–" + minToTime(s.end)).join(", ")}` : null; }).filter(Boolean).join(" · ") || "График не задан"}</div>
          ${isOwner() ? `<div class="row-tools" style="margin-bottom:10px"><label class="hint">Процент <input class="in-sm" data-f="commissionPercent" type="number" min="0" max="100" value="${m.commissionPercent}" style="width:70px"></label><label class="hint">Ставка/день, ₸ <input class="in-sm" data-f="dayRateTenge" type="number" min="0" value="${m.dayRateTenge}" style="width:100px"></label><button class="btn-sm ghost" data-rates>Сохранить</button></div>` : ""}
          <div class="row-tools"><button class="btn-sm" data-sched>График</button>${isOwner() ? `<button class="btn-sm ${m.active ? "danger" : "ghost"}" data-active>${m.active ? "Не работает" : "Вернуть"}</button>` : ""}</div></div>`).join("")}</div>`);
      $("#m-add")?.addEventListener("click", () => addMaster(draw));
      $$("[data-id]", root).forEach((card) => {
        const m = list.find((x) => x.id === card.dataset.id);
        card.querySelector("[data-sched]").onclick = () => editSchedule(m, draw);
        card.querySelector("[data-rates]")?.addEventListener("click", async () => {
          const body = {}; card.querySelectorAll("[data-f]").forEach((i) => { body[i.dataset.f] = Number(i.value); });
          try { await send("PATCH", `/api/staff/masters/${m.id}`, body); toast("Ставки сохранены"); } catch (e) { fail(e); }
        });
        card.querySelector("[data-active]")?.addEventListener("click", async () => {
          if (m.active && !confirm(`${m.fullName} больше не работает? Вход будет закрыт.`)) return;
          try { await send("PATCH", `/api/staff/masters/${m.id}`, { active: !m.active }); draw(); } catch (e) { fail(e); }
        });
      });
    }
    draw().catch(fail);
  };

  function editSchedule(m, onSaved) {
    const rows = WEEK.map((w, i) => {
      const iv = m.schedule.filter((s) => s.weekday === i + 1);
      const cell = (k, f) => `<input class="in-sm" type="time" data-d="${i + 1}" data-k="${k}${f}" value="${iv[k] ? minToTime(iv[k][f === "s" ? "start" : "end"]) : ""}" aria-label="${w}, ${f === "s" ? "начало" : "конец"} ${k + 1}">`;
      return `<div class="sched-row"><b>${w}</b>${cell(0, "s")}${cell(0, "e")}${cell(1, "s")}${cell(1, "e")}</div>`;
    }).join("");
    dialog(`<h2>График: ${esc(m.fullName)}</h2><p class="hint" style="margin-bottom:12px">До двух смен в день. Пустые поля — выходной.</p>
      <div class="sched-row hint"><span></span><span>Начало</span><span>Конец</span><span>Начало 2</span><span>Конец 2</span></div>${rows}
      <div class="actions"><button class="btn ghost" data-close>Отмена</button><button class="btn" id="sc-save">Сохранить</button></div>`,
    (dlg) => {
      dlg.querySelector("#sc-save").onclick = async () => {
        const intervals = [];
        for (let d = 1; d <= 7; d++) for (const k of [0, 1]) {
          const s = dlg.querySelector(`[data-d="${d}"][data-k="${k}s"]`).value, e = dlg.querySelector(`[data-d="${d}"][data-k="${k}e"]`).value;
          if (s && e) intervals.push({ weekday: d, start: timeToMin(s), end: timeToMin(e) });
        }
        try { await send("PUT", `/api/staff/masters/${m.id}/schedule`, { intervals }); dlg.close(); toast("График сохранён"); onSaved(); } catch (e) { fail(e); }
      };
    });
  }

  function addMaster(onSaved) {
    dialog(`<h2>Новый врач</h2>
      <div class="field"><label>Имя и фамилия</label><input id="nm-name"></div>
      <div class="field"><label>Email для входа</label><input id="nm-email" type="email"></div>
      <div class="field"><label>Пароль (не короче 8 символов)</label><input id="nm-pass" type="password" autocomplete="new-password"></div>
      <div class="field-row"><div class="field"><label>Процент от работ</label><input id="nm-pct" type="number" value="40"></div><div class="field"><label>Ставка за день, ₸</label><input id="nm-rate" type="number" value="0"></div></div>
      <p class="hint">График по умолчанию: Пн–Сб 09:00–19:00. Изменить можно после создания.</p>
      <div class="actions"><button class="btn ghost" data-close>Отмена</button><button class="btn" id="nm-save">Создать</button></div>`,
    (dlg) => {
      dlg.querySelector("#nm-save").onclick = async () => {
        try {
          await send("POST", "/api/staff/masters", { fullName: dlg.querySelector("#nm-name").value, email: dlg.querySelector("#nm-email").value, password: dlg.querySelector("#nm-pass").value, commissionPercent: Number(dlg.querySelector("#nm-pct").value), dayRateTenge: Number(dlg.querySelector("#nm-rate").value) });
          dlg.close(); toast("Механик добавлен"); onSaved();
        } catch (e) { toast(e.status === 409 ? "Этот email уже используется" : e.message); }
      };
    });
  }

  /* ---------------------------------- касса и зарплата ---------------------------------- */
  const METHOD = { cash: "Наличные", kaspi: "Каспи", card: "Карта", transfer: "Перевод" };
  const periodTools = (from, to) => `<input class="in-sm" type="date" id="p-from" value="${from}" aria-label="С"><span class="hint">—</span><input class="in-sm" type="date" id="p-to" value="${to}" aria-label="По">`;

  Pages.cash = async (root) => {
    let from = monthStart(), to = today();
    async function draw() {
      const qs = `from=${from}&to=${to}`;
      const [cash, payroll] = await Promise.all([get(`/api/staff/cash?${qs}`), isOwner() ? get(`/api/staff/payroll?${qs}`) : null]);
      root.innerHTML = panel("Касса", periodTools(from, to),
        `<div class="kpis"><div class="kpi"><span>Поступления</span><b>${money(cash.total)}</b></div>${cash.byMethod.map((m) => `<div class="kpi"><span>${esc(METHOD[m.method] ?? m.method)}</span><b>${money(m.amount)}</b></div>`).join("")}</div>
        <div class="table-wrap"><table class="t mobile-cards" id="cashTable"><thead><tr><th>Время</th><th>Клиент</th><th>Услуги</th><th>Способ</th><th>Сумма</th></tr></thead><tbody>
        ${cash.payments.map((p) => `<tr><td data-label="Время">${fmtDateTime(p.createdAt)}</td><td data-label="Клиент"><b>${esc(p.clientName)}</b></td><td data-label="Услуги">${esc(p.services)}</td><td data-label="Способ">${esc(METHOD[p.method] ?? p.method)}</td><td data-label="Сумма">${money(p.amount)}</td></tr>`).join("") || `<tr class="empty-row"><td colspan="5" class="empty">Платежей за период нет</td></tr>`}</tbody></table></div>`)
        + (payroll ? panel("Зарплата врачей", "", `<div class="table-wrap"><table class="t mobile-cards" id="payrollTable"><thead><tr><th>Врач</th><th>Визитов</th><th>Выручка</th><th>Процент</th><th>Дней</th><th>Ставка</th><th>К выплате</th></tr></thead><tbody>
          ${payroll.items.map((i) => `<tr><td data-label="Врач"><b>${esc(i.name)}</b></td><td data-label="Визитов">${i.visits}</td><td data-label="Выручка">${money(i.revenue)}</td><td data-label="Процент">${i.commissionPercent}% = ${money(i.commission)}</td><td data-label="Дней">${i.workedDays}</td><td data-label="Ставка">${money(i.rate)}</td><td data-label="К выплате"><b>${money(i.total)}</b></td></tr>`).join("")}
          <tr class="total-row"><td colspan="6"><b>Итого</b></td><td data-label="К выплате"><b>${money(payroll.total)}</b></td></tr></tbody></table></div>`) : "");
      $("#p-from").onchange = (e) => { from = e.target.value || from; draw().catch(fail); };
      $("#p-to").onchange = (e) => { to = e.target.value || to; draw().catch(fail); };
    }
    draw().catch(fail);
  };

  /* ------------------------------------ обзор ------------------------------------ */
  const OV_COLORS = { paid: "#2FB26A", ready: "#14B8A6", in_progress: "#F5A623", arrived: "#8A8A94", confirmed: "#2F4BFF", booked: "#7C4DFF", cancelled: "#E5484D", no_show: "#A8A29E" };
  const ovStyle = document.createElement("style");
  ovStyle.textContent = `
    .ov-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .ov-kpi { background: #fff; border: 1px solid var(--line); border-radius: var(--r-card); padding: 16px; box-shadow: var(--shadow); animation: pop .4s var(--ease) backwards; }
    .ov-kpi span { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
    .ov-kpi b { display: block; font-size: 24px; font-weight: 600; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
    .ov-kpi small { font-size: 12px; color: var(--muted); }
    .ov-kpi small.up { color: #1B7A47; } .ov-kpi small.down { color: var(--danger); }
    .ov-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .ov-wide { grid-column: 1 / -1; }
    .ov-card { background: #fff; border: 1px solid var(--line); border-radius: var(--r-card); padding: 18px; box-shadow: var(--shadow); min-width: 0; }
    .ov-card h3 { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-bottom: 14px; display: flex; justify-content: space-between; gap: 8px; }
    .ov-chart { position: relative; }
    .ov-chart svg { width: 100%; height: 220px; display: block; overflow: visible; }
    .ov-tip { position: absolute; top: 0; transform: translate(-50%, -100%); background: var(--ink); color: #fff; font-size: 12px; padding: 6px 10px; border-radius: 8px; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .15s; }
    .ov-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 6px; }
    .ov-donut { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
    .ov-donut svg { width: 150px; height: 150px; flex: none; }
    .ov-legend { display: grid; gap: 8px; flex: 1; min-width: 150px; font-size: 13px; }
    .ov-legend div { display: flex; align-items: center; gap: 8px; } .ov-legend i { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    .ov-legend em { margin-left: auto; font-style: normal; font-weight: 600; font-variant-numeric: tabular-nums; }
    .ov-today { display: grid; gap: 2px; max-height: 320px; overflow: auto; }
    .ov-appt { display: grid; grid-template-columns: 52px 1fr auto; gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid var(--row-line); font-size: 13px; }
    .ov-appt:first-child { border-top: 0; } .ov-appt time { font-weight: 600; font-variant-numeric: tabular-nums; } .ov-appt small { display: block; color: var(--muted); font-size: 12px; }
    .ov-load { display: grid; grid-template-columns: 1fr 52px; gap: 4px 10px; align-items: center; margin: 12px 0; font-size: 13px; }
    .ov-load .track { grid-column: 1 / -1; background: var(--stone); border-radius: 99px; height: 8px; overflow: hidden; }
    .ov-load .track i { display: block; height: 100%; background: var(--accent); border-radius: 99px; transition: width .6s var(--ease); }
    .ov-load b { text-align: right; font-variant-numeric: tabular-nums; } .ov-load small { grid-column: 1 / -1; color: var(--muted); font-size: 12px; margin-top: -2px; }
  `;
  document.head.append(ovStyle);

  Pages.overview = async (root) => {
    let days = 30;
    const shortDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const delta = (cur, prev, invert = false, suffix = "") => {
      if (!prev && !cur) return `<small>без изменений</small>`;
      if (!prev) return `<small class="up">новое за период</small>`;
      const pct = Math.round(((cur - prev) / prev) * 100);
      if (pct === 0) return `<small>как в прошлом периоде</small>`;
      const good = invert ? pct < 0 : pct > 0;
      return `<small class="${good ? "up" : "down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%${suffix} к прошлому периоду</small>`;
    };

    function chart(byDay) {
      const W = 800, H = 220, pad = 6, max = Math.max(1, ...byDay.map((d) => d.revenue));
      const n = byDay.length, x = (i) => (n === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1)), y = (v) => H - 14 - (v / max) * (H - 34);
      const pts = byDay.map((d, i) => [x(i), y(d.revenue)]);
      const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      const area = `${line} L${pts[n - 1][0].toFixed(1)},${H - 14} L${pts[0][0].toFixed(1)},${H - 14} Z`;
      const grid = [0, .5, 1].map((f) => `<line x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#EDEDF0" stroke-dasharray="${f ? "3 4" : "0"}"/>`).join("");
      return `<div class="ov-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Выручка по дням">
        <defs><linearGradient id="ovg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2F4BFF" stop-opacity=".22"/><stop offset="1" stop-color="#2F4BFF" stop-opacity="0"/></linearGradient></defs>
        ${grid}<path d="${area}" fill="url(#ovg)"/><path d="${line}" fill="none" stroke="#2F4BFF" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        <line id="ov-cur" y1="0" y2="${H - 14}" stroke="#2F4BFF" stroke-opacity=".35" opacity="0"/></svg>
        <div class="ov-tip" id="ov-tip"></div></div>
        <div class="ov-axis"><span>${shortDate(byDay[0].date)}</span><span>макс. за день: ${money(max)}</span><span>${shortDate(byDay[n - 1].date)}</span></div>`;
    }

    function donut(byStatus = []) {
      const total = byStatus.reduce((s, r) => s + r.count, 0);
      if (!total) return `<p class="empty">За период записей нет</p>`;
      const R = 54, C = 2 * Math.PI * R;
      let off = 0;
      const arcs = byStatus.map((r) => {
        const len = (r.count / total) * C;
        const el = `<circle cx="75" cy="75" r="${R}" fill="none" stroke="${OV_COLORS[r.status] ?? "#8A8A94"}" stroke-width="18" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)"/>`;
        off += len; return el;
      }).join("");
      return `<div class="ov-donut"><svg viewBox="0 0 150 150" role="img" aria-label="Приёмы по статусам">${arcs}
        <text x="75" y="72" text-anchor="middle" font-size="26" font-weight="600" fill="#111">${total}</text><text x="75" y="92" text-anchor="middle" font-size="11" fill="#6B6B76">записей</text></svg>
        <div class="ov-legend">${byStatus.map((r) => `<div><i style="background:${OV_COLORS[r.status] ?? "#8A8A94"}"></i>${esc(SG.statusLabel(r.status))}<em>${r.count}</em></div>`).join("")}</div></div>`;
    }

    async function draw() {
      const to = today(), from = addDays(to, -days + 1), prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -days + 1);
      const [a, p, dash, day] = await Promise.all([
        get(`/api/staff/analytics?from=${from}&to=${to}`), get(`/api/staff/analytics?from=${prevFrom}&to=${prevTo}`),
        get("/api/staff/dashboard"), get(`/api/staff/day?date=${to}`),
      ]);
      const names = new Map(day.masters.map((m) => [m.id, m.fullName]));
      const upcoming = day.appointments.slice().sort((x, y) => x.startsAt.localeCompare(y.startsAt));
      const maxSvc = Math.max(1, ...a.topServices.map((s) => s.revenue));
      const kpi = (label, value, d, i) => `<div class="ov-kpi" style="animation-delay:${i * 40}ms"><span>${label}</span><b>${value}</b>${d}</div>`;
      root.innerHTML = panel("Обзор", [1, 7, 30, 90].map((n) => `<button class="btn-sm ${n === days ? "" : "ghost"}" data-days="${n}">${n === 1 ? "Сегодня" : n + " дн."}</button>`).join(""),
        `<div class="ov-kpis">
          ${kpi("Выручка", money(a.revenue), delta(a.revenue, p.revenue), 0)}
          ${kpi("Оплаченных приёмов", a.visits, delta(a.visits, p.visits), 1)}
          ${kpi("Средний чек", money(a.avgCheck), delta(a.avgCheck, p.avgCheck), 2)}
          ${kpi("Новых пациентов", a.newClients, delta(a.newClients, p.newClients), 3)}
          ${kpi("Неявки", a.noShowRate + "%", delta(a.noShowRate, p.noShowRate, true), 4)}
          ${kpi("Вернулись (2+ визита)", a.returningShare + "%", delta(a.returningShare, p.returningShare), 5)}
        </div>
        <div class="ov-grid">
          <div class="ov-card ov-wide"><h3><span>Выручка по дням</span><span>${shortDate(from)} — ${shortDate(to)}</span></h3>${a.byDay.some((d) => d.revenue) ? chart(a.byDay) : '<p class="empty">За период оплат нет</p>'}</div>
          <div class="ov-card"><h3>Записи по статусам</h3>${donut(a.byStatus ?? [])}</div>
          <div class="ov-card"><h3><span>Сегодня в клинике</span><span>${dash.appointmentsToday} зап. · на приёме ${dash.inProgress}</span></h3>
            <div class="ov-today">${upcoming.map((x) => `<div class="ov-appt"><time>${fmtTime(x.startsAt)}</time><div><b>${esc(x.clientName)}</b><small>${esc(names.get(x.masterId) ?? "")} · ${esc(x.services ?? "")}</small></div>${statusChip(x.status)}</div>`).join("") || '<p class="empty">На сегодня записей нет</p>'}</div></div>
          <div class="ov-card"><h3>Загрузка врачей</h3>${a.byMaster.map((m) => `<div class="ov-load"><span>${esc(m.name)}</span><b>${m.loadPercent}%</b><div class="track"><i style="width:${m.loadPercent}%"></i></div><small>${m.visits} приёмов · ${money(m.revenue)}</small></div>`).join("") || '<p class="empty">Нет данных</p>'}</div>
          <div class="ov-card"><h3>Топ услуг</h3>${a.topServices.map((s) => `<div class="hbar"><span>${esc(s.name)}</span><div><i style="width:${Math.round((s.revenue / maxSvc) * 100)}%"></i></div><span>${s.count} · ${money(s.revenue)}</span></div>`).join("") || '<p class="empty">Нет данных</p>'}
            ${a.byMethod.length ? `<h3 style="margin-top:20px">Способы оплаты</h3>${a.byMethod.map((m) => `<div class="car-row"><span>${esc(m.method)}</span><b>${money(m.amount)}</b></div>`).join("")}` : ""}</div>
        </div>
        <p class="hint">Всего в базе: пациентов — ${dash.clients}, врачей — ${dash.masters}, услуг — ${dash.services}. Динамика сравнивается с предыдущими ${days === 1 ? "сутками" : days + " днями"}.</p>`);
      $$("[data-days]", root).forEach((b) => b.onclick = () => { days = Number(b.dataset.days); draw().catch(fail); });
      const svg = $(".ov-chart svg", root);
      if (svg) {
        const tip = $("#ov-tip"), cur = $("#ov-cur"), n = a.byDay.length;
        svg.onmousemove = (e) => {
          const r = svg.getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
          const i = Math.round(f * (n - 1)), d = a.byDay[i], vx = n === 1 ? 400 : 6 + (i * 788) / (n - 1);
          cur.setAttribute("x1", vx); cur.setAttribute("x2", vx); cur.setAttribute("opacity", 1);
          tip.textContent = `${shortDate(d.date)}: ${money(d.revenue)}`;
          tip.style.left = `${(vx / 800) * r.width}px`; tip.style.opacity = 1;
        };
        svg.onmouseleave = () => { $("#ov-tip").style.opacity = 0; $("#ov-cur").setAttribute("opacity", 0); };
      }
    }
    draw().catch(fail);
  };

  /* ------------------------------------ отчёты ------------------------------------ */
  Pages.reports = async (root) => {
    let from = monthStart(), to = today();
    const aiStatus = await get("/api/staff/ai/status").catch(() => ({ canAsk: false }));
    async function draw() {
      const a = await get(`/api/staff/analytics?from=${from}&to=${to}`);
      const maxDay = Math.max(1, ...a.byDay.map((d) => d.revenue));
      const maxMaster = Math.max(1, ...a.byMaster.map((m) => m.revenue));
      const maxSvc = Math.max(1, ...a.topServices.map((s) => s.revenue));
      root.innerHTML = panel("Отчёты", periodTools(from, to) + `<button class="btn-sm ghost" data-range="7">7 дней</button><button class="btn-sm ghost" data-range="30">30 дней</button>`,
        `<div class="kpis">
          <div class="kpi"><span>Выручка</span><b>${money(a.revenue)}</b></div><div class="kpi"><span>Оплаченных приёмов</span><b>${a.visits}</b></div>
          <div class="kpi"><span>Средний чек</span><b>${money(a.avgCheck)}</b></div><div class="kpi"><span>Неявки</span><b>${a.noShowRate}%</b></div>
          <div class="kpi"><span>Отмены</span><b>${a.cancelled}</b></div><div class="kpi"><span>Новых пациентов</span><b>${a.newClients}</b></div>
          <div class="kpi"><span>Вернулись (2+ визита)</span><b>${a.returningShare}%</b></div></div>
        <div class="cols"><div><h3 class="hint" style="margin-bottom:8px">ВЫРУЧКА ПО ДНЯМ</h3><div class="bars">${a.byDay.map((d) => `<i title="${d.date}: ${money(d.revenue)}" style="height:${Math.round((d.revenue / maxDay) * 100)}%"></i>`).join("")}</div></div>
        <div><h3 class="hint" style="margin-bottom:8px">МЕХАНИКИ: ВЫРУЧКА И ЗАГРУЗКА</h3>${a.byMaster.map((m) => `<div class="hbar"><span>${esc(m.name)}</span><div><i style="width:${Math.round((m.revenue / maxMaster) * 100)}%"></i></div><span>${money(m.revenue)} · ${m.loadPercent}%</span></div>`).join("")}</div>
        <div><h3 class="hint" style="margin-bottom:8px">ТОП УСЛУГ</h3>${a.topServices.map((s) => `<div class="hbar"><span>${esc(s.name)}</span><div><i style="width:${Math.round((s.revenue / maxSvc) * 100)}%"></i></div><span>${s.count} · ${money(s.revenue)}</span></div>`).join("") || '<p class="empty">Нет данных</p>'}</div></div>`)
        + panel("Спросить ИИ", "", aiStatus.canAsk
          ? `<div class="row-tools"><input class="in-sm" id="ai-q" placeholder="Например: у какого врача лучшая загрузка на этой неделе?" aria-label="Вопрос к данным" style="flex:1;min-width:220px"><button class="btn-sm" id="ai-go">Спросить</button></div><div id="ai-a" class="muted-box hidden" style="margin-top:12px;white-space:pre-wrap"></div>`
          : `<div class="muted-box">Вопросы к данным включаются добавлением ключа <code class="k">ANTHROPIC_API_KEY</code> на сервере. Диктовка заметок и сводки в Telegram работают и без него.</div>`);
      $("#p-from").onchange = (e) => { from = e.target.value || from; draw().catch(fail); };
      $("#p-to").onchange = (e) => { to = e.target.value || to; draw().catch(fail); };
      $$("[data-range]", root).forEach((b) => b.onclick = () => { to = today(); from = addDays(to, -Number(b.dataset.range) + 1); draw().catch(fail); });
      $("#ai-go")?.addEventListener("click", async () => {
        const box = $("#ai-a"); box.classList.remove("hidden"); box.textContent = "Думаю…";
        try { box.textContent = (await send("POST", "/api/staff/ai/ask", { question: $("#ai-q").value })).answer; } catch (e) { box.textContent = e.message; }
      });
    }
    draw().catch(fail);
  };

  /* ----------------------------------- настройки ----------------------------------- */
  Pages.settings = async (root) => {
    async function draw() {
      const [me, tg, fields] = await Promise.all([get("/api/auth/me"), get("/api/staff/telegram"), get("/api/staff/custom-fields")]);
      window.Me = { ...window.Me, ...me };
      const link = `${location.origin}/b/${me.salonSlug}`;
      root.innerHTML =
        panel("Настройки", "", "") +
        panel("Онлайн-запись для пациентов", "", `<p class="hint" style="margin-bottom:8px">Эту ссылку можно поставить в Instagram, 2GIS и на визитку:</p><div class="row-tools"><code class="k">${esc(link)}</code><button class="btn-sm ghost" id="st-copy">Копировать</button><a class="btn-sm" href="${esc(link)}" target="_blank" rel="noopener" style="text-decoration:none">Открыть</a></div>`) +
        panel("Telegram", "", !tg.enabled ? `<div class="muted-box">Бот не подключён на сервере.</div>`
          : tg.linked ? `<p style="margin-bottom:10px">✅ Подключено. Вам приходят новые записи, отмены и итоги дня.</p><button class="btn-sm danger" id="st-tg-off">Отключить</button>`
          : `<p class="hint" style="margin-bottom:10px">Подключите бота @${esc(tg.bot)}: новые записи, отмены и вечерняя сводка придут в Telegram.</p><button class="btn-sm" id="st-tg-on">Подключить Telegram</button>`) +
        panel("Безопасность: двухфакторная защита", "", me.twoFactor
          ? `<p style="margin-bottom:10px">✅ Включена. При входе нужен код из приложения.</p><div class="row-tools"><input class="in-sm" id="st-pass" type="password" placeholder="Пароль" aria-label="Пароль"><input class="in-sm" id="st-code" placeholder="Код" aria-label="Код" maxlength="6" style="width:100px"><button class="btn-sm danger" id="st-2fa-off">Отключить</button></div>`
          : `<p class="hint" style="margin-bottom:10px">Защитите вход кодом из Google Authenticator, 1Password или другого приложения.</p><button class="btn-sm" id="st-2fa-on">Включить</button><div id="st-2fa-box"></div>`) +
        panel("Поля карточки пациента", "", `<div class="row-tools" style="margin-bottom:14px"><input class="in-sm" id="cf-label" placeholder="Название поля" aria-label="Название поля"><select class="in-sm" id="cf-type" aria-label="Тип поля"><option value="text">Текст</option><option value="checkbox">Галочка</option><option value="select">Список</option><option value="money">Сумма</option></select><input class="in-sm hidden" id="cf-opts" placeholder="Варианты через запятую" aria-label="Варианты" style="min-width:200px"><button class="btn-sm" id="cf-add">Добавить</button></div>
          ${fields.map((f) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--row-line)"><span>${esc(f.label)} <span class="hint">· ${{ text: "текст", checkbox: "галочка", select: "список: " + f.options.join(", "), money: "сумма" }[f.type]}</span></span><button class="btn-sm danger" data-del="${f.id}">Удалить</button></div>`).join("") || '<p class="hint">Пока нет. Добавьте, например, «Предпочитаемое масло» или «Такси / корпоративный».</p>'}`);
      root.querySelector(".panel .ph").style.marginBottom = "0"; // заголовок «Настройки» без пустого блока под ним

      $("#st-copy").onclick = () => navigator.clipboard?.writeText(link).then(() => toast("Скопировано"));
      $("#st-tg-on")?.addEventListener("click", async () => { const r = await send("POST", "/api/staff/telegram/link", {}); window.open(r.url, "_blank", "noopener"); toast("Нажмите Start в Telegram и обновите страницу"); });
      $("#st-tg-off")?.addEventListener("click", async () => { await api("/api/staff/telegram", { method: "DELETE", on401: toLogin }); draw(); });

      $("#st-2fa-on")?.addEventListener("click", async () => {
        const s = await send("POST", "/api/auth/2fa/setup", {});
        $("#st-2fa-box").innerHTML = `<div class="muted-box" style="margin-top:12px"><p>1. В приложении-аутентификаторе добавьте ключ вручную:</p><p style="margin:8px 0"><code class="k">${esc(s.secret)}</code></p>
          <p>2. Введите 6-значный код из приложения:</p><div class="row-tools" style="margin-top:8px"><input class="in-sm" id="st-code" maxlength="6" placeholder="000000" aria-label="Код" style="width:110px"><button class="btn-sm" id="st-2fa-ok">Подтвердить</button></div></div>`;
        $("#st-2fa-ok").onclick = async () => { try { await send("POST", "/api/auth/2fa/enable", { code: $("#st-code").value }); toast("Защита включена"); draw(); } catch (e) { toast("Неверный код"); } };
      });
      $("#st-2fa-off")?.addEventListener("click", async () => { try { await send("POST", "/api/auth/2fa/disable", { code: $("#st-code").value, password: $("#st-pass").value }); toast("Защита отключена"); draw(); } catch (e) { toast("Неверный пароль или код"); } });

      $("#cf-type").onchange = (e) => $("#cf-opts").classList.toggle("hidden", e.target.value !== "select");
      $("#cf-add").onclick = async () => {
        try { await send("POST", "/api/staff/custom-fields", { label: $("#cf-label").value, type: $("#cf-type").value, options: $("#cf-opts").value.split(",") }); toast("Поле добавлено"); draw(); } catch (e) { fail(e); }
      };
      $$("[data-del]", root).forEach((b) => b.onclick = async () => { if (confirm("Удалить поле? Значения в карточках перестанут показываться.")) { await api(`/api/staff/custom-fields/${b.dataset.del}`, { method: "DELETE", on401: toLogin }); draw(); } });
    }
    draw().catch(fail);
  };
})();
