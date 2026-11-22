/** ИИ-помощники (ADR-0003): только предлагают, сохраняет человек. */

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "checkbox" | "select" | "money";
  options: string[];
}

export interface DictationDraft {
  note: string;
  tags: string[];
  custom: Record<string, string | number | boolean>;
  /** Откуда черновик: модель или простые правила (когда ключа нет). */
  source: "claude" | "rules";
}

export interface AiTool {
  name: string;
  description: string;
  /** JSON Schema входа. */
  schema: object;
  /** Только чтение, в пределах одной клиники. */
  run(input: Record<string, unknown>): Promise<unknown>;
}

export interface Ai {
  /** Доступны ли ответы на вопросы (нужен ключ Claude). */
  readonly canAsk: boolean;
  structureDictation(text: string, fields: FieldDef[]): Promise<DictationDraft>;
  ask(question: string, tools: AiTool[]): Promise<string>;
}

const TAG_RULES: [RegExp, string][] = [
  [/аллерг/i, "аллергия"],
  [/постоянн|завсегдатай/i, "постоянный"],
  [/vip|вип/i, "VIP"],
  [/боится|страх|паник/i, "боится лечения"],
  [/беремен/i, "беременность"],
  [/ребён|ребен|детск/i, "детский"],
  [/имплант|протез|коронк/i, "ортопедия"],
  [/брекет|элайнер|капп/i, "ортодонтия"],
  [/гарант/i, "гарантия"],
  [/опаздыв|опоздал/i, "опаздывает"],
];

/** Запасной вариант без ключа: простые правила по словам. */
export class RuleBasedAi implements Ai {
  readonly canAsk = false;

  async structureDictation(text: string, fields: FieldDef[]): Promise<DictationDraft> {
    const note = text.trim();
    const custom: DictationDraft["custom"] = {};
    for (const f of fields) {
      if (f.type === "checkbox" && note.toLowerCase().includes(f.label.toLowerCase())) custom[f.key] = true;
      if (f.type === "select") {
        const hit = f.options.find((o) => note.toLowerCase().includes(o.toLowerCase()));
        if (hit) custom[f.key] = hit;
      }
    }
    return { note, tags: TAG_RULES.filter(([re]) => re.test(note)).map(([, tag]) => tag), custom, source: "rules" };
  }

  async ask(): Promise<string> {
    throw new Error("AI assistant is not configured (set ANTHROPIC_API_KEY)");
  }
}

type Fetch = typeof fetch;
interface Block { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }

/** Claude через Messages API. Ключ берётся из окружения и не покидает сервер. */
export class ClaudeAi implements Ai {
  readonly canAsk = true;
  private readonly fallback = new RuleBasedAi();

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly model = "claude-haiku-5-5",
  ) {}

  private async message(body: object): Promise<{ content: Block[]; stop_reason: string }> {
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, max_tokens: 1024, ...body }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    return (await res.json()) as { content: Block[]; stop_reason: string };
  }

  async structureDictation(text: string, fields: FieldDef[]): Promise<DictationDraft> {
    try {
      const fieldList = fields.map((f) => `${f.key} (${f.label}, ${f.type}${f.options.length ? `: ${f.options.join("/")}` : ""})`).join("; ") || "нет";
      const reply = await this.message({
        system:
          "Ты помогаешь врачу-стоматологу оформлять заметки о пациенте и его зубах (жалобы, аллергии, предпочтения). Из надиктованного текста верни ТОЛЬКО JSON вида " +
          '{"note": "аккуратная заметка по-русски", "tags": ["короткие теги"], "custom": {"ключ_поля": значение}}. ' +
          "Заполняй custom только для перечисленных полей и только если значение явно названо. Ничего не выдумывай.",
        messages: [{ role: "user", content: `Поля карточки: ${fieldList}\n\nДиктовка:\n${text}` }],
      });
      const raw = reply.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      const allowed = new Set(fields.map((f) => f.key));
      return {
        note: String(parsed.note ?? text).slice(0, 2000),
        tags: (Array.isArray(parsed.tags) ? parsed.tags : []).map(String).slice(0, 10),
        custom: Object.fromEntries(Object.entries(parsed.custom ?? {}).filter(([k]) => allowed.has(k))) as DictationDraft["custom"],
        source: "claude",
      };
    } catch {
      return this.fallback.structureDictation(text, fields); // сбой модели не должен ломать диктовку
    }
  }

  async ask(question: string, tools: AiTool[]): Promise<string> {
    const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content: question }];
    const toolDefs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
    for (let step = 0; step < 5; step++) {
      const reply = await this.message({
        system:
          "Ты аналитик CRM стоматологической клиники. Отвечай по-русски, кратко, только на основе данных из инструментов. " +
          "Если данных нет — так и скажи. Суммы в тенге (₸).",
        tools: toolDefs,
        messages,
      });
      const uses = reply.content.filter((b) => b.type === "tool_use");
      if (reply.stop_reason !== "tool_use" || !uses.length) {
        return reply.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      }
      messages.push({ role: "assistant", content: reply.content });
      const results = [];
      for (const use of uses) {
        const tool = tools.find((t) => t.name === use.name);
        let content: string;
        try { content = JSON.stringify(await (tool?.run(use.input ?? {}) ?? { error: "unknown tool" })); }
        catch (e) { content = JSON.stringify({ error: (e as Error).message }); }
        results.push({ type: "tool_result", tool_use_id: use.id, content });
      }
      messages.push({ role: "user", content: results });
    }
    return "Не удалось получить ответ, попробуйте переформулировать вопрос.";
  }
}
