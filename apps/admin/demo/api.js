(() => {
  const offsetDays = (days) => {
    const date = new Date(Date.now() + 5 * 60 * 60 * 1000);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const at = (days, hour, minute = 0) => {
    const [year, month, day] = offsetDays(days).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour - 5, minute)).toISOString();
  };
  const ids = { owner: "demo-owner", doctors: ["demo-doctor-1", "demo-doctor-2", "demo-doctor-3"] };
  const fields = [
    { id: "field-allergy", key: "allergy", label: "Аллергии", type: "text", options: [] },
    { id: "field-contact", key: "contact", label: "Предпочтительный способ связи", type: "select", options: ["Телефон", "WhatsApp"] },
  ];
  const patients = [
    { id: "patient-01", fullName: "Айдана Серикова", phone: "+7 700 000-00-01", tags: ["Постоянный"], visits: 4, spent: 74000, lastVisit: at(-3, 10), createdAt: at(-140, 10), notes: "Предпочитает утренние визиты.", custom: { allergy: "", contact: "WhatsApp" }, teeth: [{ id: "tooth-01", toothNo: "36", diagnosis: "Кариес", notes: "Поверхность: жевательная" }] },
    { id: "patient-02", fullName: "Данияр Толеуов", phone: "+7 700 000-00-02", tags: ["Новый"], visits: 1, spent: 12000, lastVisit: at(-1, 11), createdAt: at(-1, 11), notes: "", custom: { allergy: "", contact: "Телефон" }, teeth: [] },
    { id: "patient-03", fullName: "Алия Нурланова", phone: "+7 700 000-00-03", tags: ["Контроль"], visits: 3, spent: 46500, lastVisit: at(-7, 14), createdAt: at(-90, 14), notes: "Контрольный осмотр через месяц.", custom: { allergy: "Нет данных", contact: "WhatsApp" }, teeth: [{ id: "tooth-03", toothNo: "11", diagnosis: "Пломба", notes: "Контроль состояния" }] },
    { id: "patient-04", fullName: "Марат Ибраев", phone: "+7 700 000-00-04", tags: ["Новый"], visits: 0, spent: 0, lastVisit: null, createdAt: at(-2, 9), notes: "", custom: { allergy: "", contact: "Телефон" }, teeth: [] },
    { id: "patient-05", fullName: "Жанна Абдрахманова", phone: "+7 700 000-00-05", tags: ["Постоянный", "Ортопедия"], visits: 7, spent: 218000, lastVisit: at(-2, 16), createdAt: at(-300, 12), notes: "", custom: { allergy: "", contact: "WhatsApp" }, teeth: [{ id: "tooth-05", toothNo: "24", diagnosis: "Коронка", notes: "Керамика" }] },
    { id: "patient-06", fullName: "Руслан Касымов", phone: "+7 700 000-00-06", tags: ["Контроль"], visits: 2, spent: 33000, lastVisit: at(-72, 12), createdAt: at(-130, 12), notes: "", custom: { allergy: "", contact: "Телефон" }, teeth: [] },
    { id: "patient-07", fullName: "Мадина Омарова", phone: "+7 700 000-00-07", tags: ["Новый"], visits: 0, spent: 0, lastVisit: null, createdAt: at(-5, 15), notes: "", custom: { allergy: "", contact: "WhatsApp" }, teeth: [] },
    { id: "patient-08", fullName: "Арман Садыков", phone: "+7 700 000-00-08", tags: ["Постоянный"], visits: 5, spent: 99500, lastVisit: at(-6, 9), createdAt: at(-200, 9), notes: "", custom: { allergy: "", contact: "Телефон" }, teeth: [{ id: "tooth-08", toothNo: "46", diagnosis: "Пломба", notes: "" }] },
  ];
  const masters = [
    { id: ids.doctors[0], fullName: "Данияр Нурбеков", email: "doctor1@example.test", active: true, commissionPercent: 40, dayRateTenge: 12000 },
    { id: ids.doctors[1], fullName: "Аидос Ермеков", email: "doctor2@example.test", active: true, commissionPercent: 35, dayRateTenge: 10000 },
    { id: ids.doctors[2], fullName: "Сауле Иманова", email: "doctor3@example.test", active: true, commissionPercent: 40, dayRateTenge: 12000 },
  ].map((master) => ({
    ...master,
    schedule: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: 540, end: 1140 })),
    intervals: [{ start: 540, end: 1140 }],
  }));
  const services = [
    { id: "service-01", name: "Консультация стоматолога", durationMin: 30, priceTenge: 5000, active: true },
    { id: "service-02", name: "Лечение кариеса", durationMin: 60, priceTenge: 18000, active: true },
    { id: "service-03", name: "Профессиональная гигиена", durationMin: 60, priceTenge: 22000, active: true },
    { id: "service-04", name: "Рентген-диагностика", durationMin: 20, priceTenge: 7000, active: true },
    { id: "service-05", name: "Эндодонтическое лечение", durationMin: 90, priceTenge: 42000, active: true },
    { id: "service-06", name: "Установка коронки", durationMin: 90, priceTenge: 85000, active: true },
  ];
  const appointments = [
    makeAppointment("appointment-01", 0, 9, 0, "confirmed", 0, "Лечение кариеса", 18000, "36", "Кариес"),
    makeAppointment("appointment-02", 1, 10, 30, "booked", 1, "Консультация стоматолога", 5000),
    makeAppointment("appointment-03", 2, 12, 0, "arrived", 2, "Профессиональная гигиена", 22000),
    makeAppointment("appointment-04", 4, 14, 0, "in_progress", 0, "Эндодонтическое лечение", 42000, "24", "Пульпит"),
    makeAppointment("appointment-05", 5, 16, 0, "confirmed", 1, "Установка коронки", 85000, "24", "Коронка"),
    makeAppointment("appointment-06", 6, 11, 0, "paid", 2, "Лечение кариеса", 18000, "46", "Пломба", -1),
    makeAppointment("appointment-07", 7, 15, 0, "cancelled", 0, "Консультация стоматолога", 5000, null, null, -2),
    makeAppointment("appointment-08", 0, 17, 0, "booked", 2, "Рентген-диагностика", 7000, null, null, 1),
  ];

  function makeAppointment(id, patientIndex, hour, minute, status, masterIndex, service, priceTenge, toothName = null, toothDiagnosis = null, dayOffset = 0) {
    const patient = patients[patientIndex];
    return {
      id,
      clientId: patient.id,
      clientName: patient.fullName,
      clientPhone: patient.phone,
      masterId: ids.doctors[masterIndex],
      masterName: masters[masterIndex].fullName,
      serviceIds: [services.find((item) => item.name === service)?.id ?? services[0].id],
      services: service,
      startsAt: at(dayOffset, hour, minute),
      endsAt: at(dayOffset, hour + 1, minute),
      status,
      priceTenge,
      toothName,
      toothDiagnosis,
    };
  }

  const dateLabels = (count, from) => Array.from({ length: count }, (_, index) => {
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  const analytics = (from, to) => {
    const dayCount = Math.min(90, Math.max(1, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1));
    const byDay = dateLabels(dayCount, from).map((date, index) => ({ date, revenue: [42000, 68000, 0, 91000, 54000, 77000, 36000][index % 7] }));
    return {
      revenue: byDay.reduce((sum, item) => sum + item.revenue, 0),
      visits: 36,
      avgCheck: 27400,
      newClients: 8,
      noShowRate: 4,
      cancelled: 3,
      returningShare: 62,
      byDay,
      byStatus: [
        { status: "confirmed", count: 8 }, { status: "booked", count: 6 },
        { status: "paid", count: 18 }, { status: "cancelled", count: 3 },
      ],
      byMaster: [
        { name: masters[0].fullName, revenue: 438000, loadPercent: 82, visits: 18 },
        { name: masters[1].fullName, revenue: 326000, loadPercent: 68, visits: 13 },
        { name: masters[2].fullName, revenue: 219000, loadPercent: 54, visits: 9 },
      ],
      topServices: [
        { name: "Лечение кариеса", count: 18, revenue: 324000 },
        { name: "Профессиональная гигиена", count: 12, revenue: 264000 },
        { name: "Консультация стоматолога", count: 9, revenue: 45000 },
      ],
      byMethod: [{ method: "kaspi", amount: 426000 }, { method: "card", amount: 312000 }, { method: "cash", amount: 245000 }],
    };
  };
  const cash = {
    total: 983000,
    byMethod: [{ method: "kaspi", amount: 426000 }, { method: "card", amount: 312000 }, { method: "cash", amount: 245000 }],
    payments: appointments.filter((item) => item.status === "paid").map((item) => ({
      createdAt: item.startsAt,
      clientName: item.clientName,
      services: item.services,
      method: "kaspi",
      amount: item.priceTenge,
    })),
  };
  const payroll = {
    items: [
      { name: masters[0].fullName, visits: 18, revenue: 438000, commissionPercent: 40, commission: 175200, workedDays: 20, rate: 240000, total: 415200 },
      { name: masters[1].fullName, visits: 13, revenue: 326000, commissionPercent: 35, commission: 114100, workedDays: 19, rate: 190000, total: 304100 },
      { name: masters[2].fullName, visits: 9, revenue: 219000, commissionPercent: 40, commission: 87600, workedDays: 18, rate: 216000, total: 303600 },
    ],
    total: 1022900,
  };
  const ok = (body) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
  const fail = (status, error) => ({ ok: false, status, statusText: error, json: async () => ({ error }) });

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    const method = init.method ?? "GET";
    if (method !== "GET") return fail(403, "В демо-режиме изменения не сохраняются");

    if (url.pathname === "/api/auth/me") return ok({ name: "Алия Серикова", role: "owner", salonSlug: "demo", twoFactor: false });
    if (url.pathname === "/api/staff/dashboard") return ok({ appointmentsToday: 5, inProgress: 1, clients: patients.length, masters: masters.length, services: services.length });
    if (url.pathname === "/api/staff/appointments") {
      let items = appointments;
      const { tab, status, q } = Object.fromEntries(url.searchParams);
      if (tab === "upcoming") items = items.filter((item) => ["booked", "confirmed", "arrived", "in_progress"].includes(item.status));
      if (tab === "cancelled") items = items.filter((item) => item.status === "cancelled");
      if (status) items = items.filter((item) => item.status === status);
      if (q) items = items.filter((item) => `${item.clientName} ${item.clientPhone} ${item.masterName} ${item.services}`.toLowerCase().includes(q.toLowerCase()));
      const page = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("pageSize") || 10);
      return ok({ items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length });
    }
    if (url.pathname === "/api/staff/clients") {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const segment = url.searchParams.get("segment");
      const items = patients.filter((patient) => {
        const matchesQuery = `${patient.fullName} ${patient.phone} ${patient.teeth.map((tooth) => `${tooth.toothNo} ${tooth.diagnosis}`).join(" ")}`.toLowerCase().includes(q);
        const matchesSegment = !segment
          || (segment === "never" && patient.visits === 0)
          || (segment === "new" && Date.now() - Date.parse(patient.createdAt) <= 30 * 86400000)
          || (segment === "lapsed60" && patient.lastVisit && Date.now() - Date.parse(patient.lastVisit) > 60 * 86400000);
        return matchesQuery && matchesSegment;
      }).map((patient) => ({
        ...patient,
        teeth: patient.teeth.map((tooth) => `${tooth.toothNo} — ${tooth.diagnosis}`).join(", ") || "—",
        lastVisit: patient.lastVisit,
      }));
      return ok(items);
    }
    if (url.pathname === "/api/staff/custom-fields") return ok(fields);
    const patientMatch = url.pathname.match(/^\/api\/staff\/clients\/([^/]+)$/);
    if (patientMatch) {
      const patient = patients.find((item) => item.id === patientMatch[1]);
      if (!patient) return fail(404, "Пациент не найден в демо");
      const history = appointments.filter((item) => item.clientId === patient.id);
      return ok({ ...patient, history });
    }
    if (url.pathname === "/api/staff/day") {
      const date = url.searchParams.get("date") || offsetDays(0);
      const appointmentsForDay = appointments.filter((item) => item.startsAt.slice(0, 10) === date);
      return ok({ masters, appointments: appointmentsForDay });
    }
    if (url.pathname === "/api/staff/services/all") return ok(services);
    if (url.pathname === "/api/staff/services") return ok(services.filter((service) => service.active));
    if (url.pathname === "/api/staff/masters") return ok(masters.filter((master) => master.active));
    if (url.pathname === "/api/staff/masters/full") return ok(masters);
    if (url.pathname === "/api/staff/teeth") {
      const patient = patients.find((item) => item.id === url.searchParams.get("clientId"));
      return ok(patient?.teeth ?? []);
    }
    if (url.pathname === "/api/staff/slots") return ok({ slots: [at(0, 9), at(0, 10), at(0, 11), at(0, 14), at(0, 15)] });
    if (url.pathname === "/api/staff/analytics") return ok(analytics(url.searchParams.get("from") || offsetDays(-29), url.searchParams.get("to") || offsetDays(0)));
    if (url.pathname === "/api/staff/cash") return ok(cash);
    if (url.pathname === "/api/staff/payroll") return ok(payroll);
    if (url.pathname === "/api/staff/ai/status") return ok({ canAsk: false });
    if (url.pathname === "/api/staff/telegram") return ok({ enabled: false, linked: false });
    const orderMatch = url.pathname.match(/^\/api\/staff\/appointments\/([^/]+)\/order$/);
    if (orderMatch) {
      const appointment = appointments.find((item) => item.id === orderMatch[1]);
      return ok({ examNotes: "Контрольный осмотр в рамках демонстрации.", materials: [], servicesTenge: appointment?.priceTenge ?? 0, materialsTenge: 0, totalTenge: appointment?.priceTenge ?? 0 });
    }
    return fail(404, "Демо-данных для этого запроса нет");
  };
})();
