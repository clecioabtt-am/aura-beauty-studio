-- Conta inicial solicitada pelo gerente. A senha é armazenada somente como hash PBKDF2-SHA256 com salt aleatório.
-- A senha temporária precisa ser substituída no primeiro acesso. A migração não sobrescreve futuras alterações.
CREATE TABLE IF NOT EXISTS admin_credentials (
  id INTEGER PRIMARY KEY CHECK (id=1),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO admin_credentials (id, email, password_hash, must_change_password)
VALUES (1, 'gerente@aura.com', 'pbkdf2_sha256$210000$8a3b468c21c87c4e3a804abd7fdd85c1$3d64bff9aabbcc310192cfd59483fa7faeaf8131bb071d7eba068794e02f5eb9', 1);
-- Sessões de versões anteriores não devem permanecer autenticadas após migração de credenciais.
DELETE FROM admin_sessions;
