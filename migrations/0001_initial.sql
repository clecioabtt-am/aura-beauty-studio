PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL CHECK(duration_min BETWEEN 30 AND 240 AND duration_min % 30 = 0),
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  image_key TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  service_id TEXT NOT NULL REFERENCES services(id),
  discount_pct INTEGER NOT NULL CHECK(discount_pct BETWEEN 1 AND 90),
  max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 100000),
  valid_until TEXT NOT NULL,
  image_key TEXT,
  public_visible INTEGER NOT NULL DEFAULT 1 CHECK(public_visible IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id),
  voucher_id TEXT REFERENCES vouchers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  notes TEXT NOT NULL DEFAULT '',
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  redeemed_on TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  original_price_cents INTEGER NOT NULL,
  discount_pct INTEGER NOT NULL DEFAULT 0,
  final_price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected','cancelled','completed')),
  tracking_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(appointment_date, appointment_time);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_voucher ON bookings(voucher_id, status);
CREATE TABLE IF NOT EXISTS booking_slots (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  slot_key TEXT NOT NULL UNIQUE,
  PRIMARY KEY(booking_id, slot_key)
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS salon_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  salon_name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  whatsapp TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  opening_hours_json TEXT NOT NULL
);
INSERT OR IGNORE INTO salon_settings (id, salon_name, tagline, opening_hours_json)
VALUES (1, 'AURA Beauty Studio', 'Sua beleza, seu momento.', '{"0":null,"1":null,"2":["09:00","19:00"],"3":["09:00","19:00"],"4":["09:00","19:00"],"5":["09:00","19:00"],"6":["09:00","18:00"]}');
INSERT OR IGNORE INTO services (id,name,category,description,duration_min,price_cents,sort_order) VALUES
('svc-corte-feminino','Corte feminino','Cabelos','Um corte exclusivo para renovar sua identidade.',60,9000,1),
('svc-corte-masculino','Corte masculino','Cabelos','Precisão, estilo e acabamento impecável.',30,5000,2),
('svc-escova','Escova & finalização','Cabelos','Movimento, brilho e um toque de elegância.',60,7500,3),
('svc-coloracao','Coloração premium','Cabelos','Cor sofisticada, personalizada para você.',120,22000,4),
('svc-hidratacao','Hidratação profunda','Tratamentos','Fios renovados com tratamento intensivo.',60,11000,5),
('svc-barba','Barba & design','Barbearia','Contorno preciso e um ritual de cuidado.',30,4500,6),
('svc-manicure','Manicure & esmaltação','Unhas','Beleza e cuidado em cada detalhe.',60,6500,7),
('svc-sobrancelha','Design de sobrancelhas','Estética','Harmonia natural que valoriza seu olhar.',30,5500,8);

-- A validação em trigger evita ultrapassar o limite de uso sob concorrência.
-- Cancelamentos e recusas liberam o uso, pois só reservas ativas contam.
CREATE TRIGGER IF NOT EXISTS trg_booking_voucher_guard
BEFORE INSERT ON bookings WHEN NEW.voucher_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM vouchers v WHERE v.id=NEW.voucher_id AND v.active=1
      AND v.service_id=NEW.service_id AND v.valid_until>=NEW.redeemed_on
      AND v.discount_pct=NEW.discount_pct
      AND (SELECT COUNT(*) FROM bookings b WHERE b.voucher_id=v.id
           AND b.status IN ('pending','confirmed','completed')) < v.max_uses
  ) THEN RAISE(ABORT,'VOUCHER_INVALID_OR_EXHAUSTED') END;
END;
