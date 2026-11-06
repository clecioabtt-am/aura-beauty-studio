-- Corrige apenas a senha inicial criada pela migração 0003.
-- Cloudflare Workers em produção limita crypto.subtle PBKDF2 a 100.000 iterações.
-- É seguro aplicar em um D1 com reservas e vouchers existentes; não altera nenhuma outra tabela.
-- Só atualiza a conta se ela ainda contiver exatamente o hash inicial de 0003.
-- Senhas já alteradas pelo gerente não serão redefinidas.
UPDATE admin_credentials
   SET password_hash = 'pbkdf2_sha256$100000$29d059e562822829e36957e73ba7dfa7$ba544c22d58c3655b4066fbce02a3ec1b5c246fb8360875ff127b9977f41aa51',
       updated_at = CURRENT_TIMESTAMP
 WHERE id = 1
   AND email = 'gerente@aura.com'
   AND must_change_password = 1
   AND password_hash = 'pbkdf2_sha256$210000$8a3b468c21c87c4e3a804abd7fdd85c1$3d64bff9aabbcc310192cfd59483fa7faeaf8131bb071d7eba068794e02f5eb9';
