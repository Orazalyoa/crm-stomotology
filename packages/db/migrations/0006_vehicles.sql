-- СТО: автомобили клиентов и стадии работы над заказом.
-- Внутренние имена таблиц (salons, masters) остаются прежними: в интерфейсе это «СТО» и «механик».

CREATE TABLE vehicles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  make_model text NOT NULL,                       -- «Toyota Camry»
  plate      text NOT NULL,                       -- госномер, хранится в верхнем регистре без пробелов
  year       smallint CHECK (year BETWEEN 1950 AND 2100),
  vin        text,
  color      text,
  mileage_km integer CHECK (mileage_km >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salon_id, plate)
);
CREATE INDEX vehicles_client ON vehicles (client_id);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;
CREATE POLICY salon_isolation ON vehicles USING (salon_id = current_salon_id()) WITH CHECK (salon_id = current_salon_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON vehicles TO app_user;

-- Запись привязана к автомобилю. Колонка необязательна: старые записи остаются валидными.
ALTER TABLE appointments ADD COLUMN vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL;

-- Новые стадии: принят → в работе → готов к выдаче → оплачен.
ALTER TABLE appointments DROP CONSTRAINT appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('booked','confirmed','arrived','in_progress','ready','paid','cancelled','no_show'));
