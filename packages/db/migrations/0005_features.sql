-- Клиентские поля, оплаты, зарплатные ставки, Telegram, напоминания, 2FA.

-- Карточка клиента: заметки и конструктор полей.
ALTER TABLE clients ADD COLUMN notes text NOT NULL DEFAULT '';

CREATE TABLE custom_fields (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  key      text NOT NULL,
  label    text NOT NULL,
  type     text NOT NULL CHECK (type IN ('text', 'checkbox', 'select', 'money')),
  options  text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  UNIQUE (salon_id, key)
);

-- Оплаты по записям (касса).
CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id       uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  method         text NOT NULL CHECK (method IN ('cash', 'kaspi', 'card', 'transfer')),
  amount_tenge   integer NOT NULL CHECK (amount_tenge >= 0),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_salon_time ON payments (salon_id, created_at);

-- Схема оплаты мастера: процент от услуг + фиксированная ставка за рабочий день.
ALTER TABLE masters
  ADD COLUMN commission_percent smallint NOT NULL DEFAULT 40 CHECK (commission_percent BETWEEN 0 AND 100),
  ADD COLUMN day_rate_tenge     integer  NOT NULL DEFAULT 0 CHECK (day_rate_tenge >= 0);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_fields', 'payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY salon_isolation ON %I USING (salon_id = current_salon_id()) WITH CHECK (salon_id = current_salon_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;

-- Служебные таблицы фоновых задач и входа: только владелец БД, без доступа app_user.
CREATE TABLE telegram_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('user', 'client')),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  client_id  uuid REFERENCES clients(id) ON DELETE CASCADE,
  chat_id    bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'user') = (user_id IS NOT NULL)),
  CHECK ((kind = 'client') = (client_id IS NOT NULL))
);
CREATE UNIQUE INDEX telegram_links_user ON telegram_links (user_id, chat_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX telegram_links_client ON telegram_links (client_id, chat_id) WHERE client_id IS NOT NULL;
CREATE INDEX telegram_links_chat ON telegram_links (chat_id);

CREATE TABLE telegram_codes (
  code       text PRIMARY KEY,
  salon_id   uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('user', 'client')),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  client_id  uuid REFERENCES clients(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

-- Что уже отправлено: напоминания по записям и ежедневные сводки (ключ уникален).
CREATE TABLE notices_sent (
  key     text PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);

-- Двухфакторная аутентификация (TOTP).
ALTER TABLE users
  ADD COLUMN totp_secret  text,
  ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;
