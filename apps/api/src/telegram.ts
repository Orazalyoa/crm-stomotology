export interface Button {
  text: string;
  data: string;
}

export interface SendOptions {
  /** Кнопки под сообщением (подтвердить / отменить). */
  buttons?: Button[][];
  /** Постоянное меню под полем ввода; "remove" убирает его. */
  menu?: string[][] | "remove";
}

/** То, что нужно остальному коду от Telegram. Текст сообщений — HTML (см. messages.ts). */
export interface TelegramClient {
  username: string;
  send(chatId: number | string, text: string, options?: SendOptions): Promise<void>;
  /** Заменяет текст сообщения и убирает кнопки (например, после нажатия «Приду»). */
  edit?(chatId: number | string, messageId: number, text: string): Promise<void>;
  answerCallback?(callbackId: string, text: string): Promise<void>;
}

export interface TgUpdate {
  update_id: number;
  message?: { chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { message_id?: number; chat: { id: number } } };
}

type Fetch = typeof fetch;

/** Тонкая обёртка над Bot API. Токен нигде не логируется. */
export class TelegramApi implements TelegramClient {
  constructor(
    private readonly token: string,
    readonly username: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async call<T>(method: string, body: object): Promise<T> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
    return data.result;
  }

  static async connect(token: string, fetchImpl: Fetch = fetch): Promise<TelegramApi> {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username: string } };
    if (!data.ok || !data.result) throw new Error("Telegram token rejected");
    return new TelegramApi(token, data.result.username, fetchImpl);
  }

  async send(chatId: number | string, text: string, { buttons, menu }: SendOptions = {}) {
    const reply_markup = buttons
      ? { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) }
      : menu === "remove" ? { remove_keyboard: true }
      : menu ? { keyboard: menu.map((row) => row.map((text) => ({ text }))), resize_keyboard: true, is_persistent: true }
      : undefined;
    await this.call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(reply_markup && { reply_markup }) });
  }

  async edit(chatId: number | string, messageId: number, text: string) {
    await this.call("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" });
  }

  async answerCallback(callbackId: string, text: string) {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, text });
  }

  /** Длинный опрос: вебхук не нужен, поэтому бот работает и на локальном компьютере. */
  async getUpdates(offset: number, timeoutSec = 25): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>("getUpdates", { offset, timeout: timeoutSec, allowed_updates: ["message", "callback_query"] });
  }
}

/** Запускает опрос в фоне; возвращает функцию остановки. */
export function startPolling(api: TelegramApi, onUpdate: (u: TgUpdate) => Promise<void>): () => void {
  let stopped = false;
  let offset = 0;
  (async () => {
    while (!stopped) {
      try {
        for (const update of await api.getUpdates(offset)) {
          offset = update.update_id + 1;
          await onUpdate(update).catch((e) => console.error("[telegram] handler:", e.message));
        }
      } catch (e) {
        if (!stopped) console.error("[telegram] polling:", (e as Error).message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
  return () => { stopped = true; };
}
