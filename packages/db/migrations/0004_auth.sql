-- Вход персонала и клиентов.
-- Таблицы намеренно без GRANT для app_user и без политик RLS: к ним обращается
-- только слой авторизации (владелец БД), а не запросы в контексте салона.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  role          text NOT NULL CHECK (role IN ('owner', 'admin', 'master')),
  master_id     uuid REFERENCES masters(id) ON DELETE CASCADE,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- мастер всегда привязан к карточке мастера, остальные роли — нет
  CHECK ((role = 'master') = (master_id IS NOT NULL))
);
-- email глобально уникален: по нему определяем салон при входе
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Одноразовые коды входа клиента (хранится только хеш).
CREATE TABLE client_otps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  phone      text NOT NULL,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_otps_lookup ON client_otps (salon_id, phone, created_at DESC);
