-- Заказ-наряд СТО: запчасти и материалы, приёмка автомобиля (пробег и осмотр).

CREATE TABLE appointment_parts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id       uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  name           text NOT NULL,
  qty            integer NOT NULL CHECK (qty BETWEEN 1 AND 1000),
  price_tenge    integer NOT NULL CHECK (price_tenge >= 0),   -- цена за единицу
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_parts_appt ON appointment_parts (appointment_id);

ALTER TABLE appointment_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_parts FORCE ROW LEVEL SECURITY;
CREATE POLICY salon_isolation ON appointment_parts USING (salon_id = current_salon_id()) WITH CHECK (salon_id = current_salon_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON appointment_parts TO app_user;

-- price_tenge записи = услуги + запчасти; parts_tenge хранит долю запчастей,
-- чтобы процент механика считался только с услуг.
ALTER TABLE appointments ADD COLUMN parts_tenge integer NOT NULL DEFAULT 0 CHECK (parts_tenge >= 0);
ALTER TABLE appointments ADD COLUMN intake_mileage_km integer CHECK (intake_mileage_km >= 0);
ALTER TABLE appointments ADD COLUMN intake_notes text NOT NULL DEFAULT '';
