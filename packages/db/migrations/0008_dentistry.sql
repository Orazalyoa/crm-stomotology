-- Стоматология: вместо автомобилей клиента — зубы пациента (зубная формула FDI), вместо пробега при приёмке — жалобы и осмотр.
-- Внутренние имена таблиц (salons, masters) остаются прежними: в интерфейсе это «клиника» и «врач».

ALTER TABLE appointments DROP COLUMN vehicle_id;
ALTER TABLE appointments DROP COLUMN intake_mileage_km;
DROP TABLE vehicles;

CREATE TABLE teeth (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tooth_no   text NOT NULL,                       -- номер по FDI: 11–48 постоянные, 51–85 молочные
  diagnosis  text NOT NULL,                       -- «Кариес», «Пульпит», «Имплант»
  notes      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, tooth_no)
);
CREATE INDEX teeth_client ON teeth (client_id);

ALTER TABLE teeth ENABLE ROW LEVEL SECURITY;
ALTER TABLE teeth FORCE ROW LEVEL SECURITY;
CREATE POLICY salon_isolation ON teeth USING (salon_id = current_salon_id()) WITH CHECK (salon_id = current_salon_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON teeth TO app_user;

-- Приём может относиться к конкретному зубу. Колонка необязательна: чистка и консультация зуба не имеют.
ALTER TABLE appointments ADD COLUMN tooth_id uuid REFERENCES teeth(id) ON DELETE SET NULL;
