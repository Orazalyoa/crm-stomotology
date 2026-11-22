-- Ядро Sergek.ai: салоны, мастера, услуги, клиенты, записи.
-- Изоляция салонов: RLS по salon_id (ADR-0001). Приложение ходит под ролью app_user
-- и в каждой транзакции задаёт set_config('app.salon_id', <uuid>, true).

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END $$;

CREATE FUNCTION current_salon_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.salon_id', true), '')::uuid $$;

CREATE TABLE salons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  timezone   text NOT NULL DEFAULT 'Asia/Almaty',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE masters (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id  uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  active    boolean NOT NULL DEFAULT true
);

CREATE TABLE services (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id     uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name         text NOT NULL,
  duration_min integer NOT NULL CHECK (duration_min > 0),
  price_tenge  integer NOT NULL CHECK (price_tenge >= 0),
  active       boolean NOT NULL DEFAULT true
);

-- Цена/длительность конкретного мастера переопределяет базовую услугу.
CREATE TABLE master_services (
  salon_id     uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  master_id    uuid NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  service_id   uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  duration_min integer CHECK (duration_min > 0),
  price_tenge  integer CHECK (price_tenge >= 0),
  PRIMARY KEY (master_id, service_id)
);

-- Рабочие интервалы по дням недели (1=пн … 7=вс), минуты от полуночи; перерыв = просвет.
CREATE TABLE schedule_intervals (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id  uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  master_id uuid NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  weekday   smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_min smallint NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
  end_min   smallint NOT NULL CHECK (end_min BETWEEN 0 AND 1440),
  CHECK (start_min < end_min)
);

CREATE TABLE clients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  full_name  text NOT NULL,
  phone      text NOT NULL CHECK (phone ~ '^\+7\d{10}$'),
  tags       text[] NOT NULL DEFAULT '{}',
  custom     jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salon_id, phone)
);

CREATE TABLE appointments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  master_id   uuid NOT NULL REFERENCES masters(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'booked'
              CHECK (status IN ('booked','confirmed','arrived','paid','cancelled','no_show')),
  price_tenge integer NOT NULL DEFAULT 0 CHECK (price_tenge >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at)
);
CREATE INDEX appointments_master_time ON appointments (master_id, starts_at);

CREATE TABLE appointment_services (
  salon_id       uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id     uuid NOT NULL REFERENCES services(id),
  price_tenge    integer NOT NULL CHECK (price_tenge >= 0),
  PRIMARY KEY (appointment_id, service_id)
);

-- RLS на всех таблицах с salon_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['masters','services','master_services','schedule_intervals',
                           'clients','appointments','appointment_services'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY salon_isolation ON %I USING (salon_id = current_salon_id()) WITH CHECK (salon_id = current_salon_id())',
      t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;

ALTER TABLE salons ENABLE ROW LEVEL SECURITY;
ALTER TABLE salons FORCE ROW LEVEL SECURITY;
CREATE POLICY salon_isolation ON salons USING (id = current_salon_id());
GRANT SELECT, UPDATE ON salons TO app_user;
