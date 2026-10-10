-- Защита журнала движений и журнала действий: только добавление записей.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Записи таблицы % нельзя изменять или удалять', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movements_immutable
  BEFORE UPDATE OR DELETE ON movements
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER movements_no_truncate
  BEFORE TRUNCATE ON movements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_change();

-- Движение всегда на положительное количество и между разными местами.
ALTER TABLE movements ADD CONSTRAINT movements_qty_positive CHECK (qty > 0);
ALTER TABLE movements ADD CONSTRAINT movements_distinct_locations
  CHECK (from_location_id <> to_location_id);

-- Место либо общее (склад, продано и т.д.), либо точки, либо водителя.
ALTER TABLE locations ADD CONSTRAINT locations_owner CHECK (
  (type = 'POINT'  AND point_id IS NOT NULL AND driver_id IS NULL) OR
  (type = 'DRIVER' AND driver_id IS NOT NULL AND point_id IS NULL) OR
  (type NOT IN ('POINT', 'DRIVER') AND point_id IS NULL AND driver_id IS NULL)
);

-- Общие места существуют в единственном экземпляре.
CREATE UNIQUE INDEX locations_singleton ON locations (type)
  WHERE type NOT IN ('POINT', 'DRIVER');

INSERT INTO locations (type) VALUES
  ('SUPPLIER'), ('WAREHOUSE'), ('SOLD'), ('WRITTEN_OFF'), ('SHORTAGE');
