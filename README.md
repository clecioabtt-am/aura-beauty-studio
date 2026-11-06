# AURA Beauty Studio ✧

PWA para salão de beleza com catálogo, agendamentos online, vouchers de desconto, painel gerencial e cards promocionais para divulgação. Código e interface em português brasileiro.

## Identificadores sugeridos

| Recurso | Nome | Binding |
| --- | --- | --- |
| Repositório GitHub | `aura-beauty-studio` | — |
| Cloudflare Worker | `aura-beauty-studio` | — |
| Cloudflare D1 | `aura-beauty-db` | `DB` |
| Cloudflare R2 | `aura-beauty-media-clecioam26` | `MEDIA` |

**Arquitetura:** Cloudflare Worker em JavaScript (API), Cloudflare Static Assets (interface HTML/CSS/JS), D1 (cadastros, reservas, vouchers, sessões) e R2 (banners JPG/PNG/WebP). Sem infraestrutura adicional e sem serviço pago de imagens obrigatório.

## Funcionalidades disponíveis

- Página inicial responsiva, catálogo de serviços masculino e feminino, preços, duração, apresentação do salão, promoções e formulário de reserva.
- PWA instalável no Android, iOS e desktop (HTTPS obrigatório no ambiente público). Service Worker guarda a interface para uso offline, **mas consultas e reservas exigem internet**.
- Reserva sem conta de cliente; nome, telefone e e-mail opcional. O cliente seleciona serviço, data e horário livre; voucher é opcional. Se enviado, validação ocorre **no servidor**.
- O valor com desconto é calculado exclusivamente no backend, com valores inteiros em centavos. Desconto entre 1% e 90% para o serviço específico. Limite de usos e data de validade.
- Slots em intervalos de 30 minutos, bloqueados por toda a duração do serviço. Agendamentos pendentes já bloqueiam o horário. Recusa/cancelamento libera horário e uso de voucher. Inserção de reserva/slots ocorre em uma transação D1 para evitar reservas duplicadas.
- Ao agendar, o cliente recebe um link privado de acompanhamento. O status inicial é **pendente**, alterado pelo gerente para **confirmado**, **recusado**, **cancelado** ou **concluído**.
- Painel gerencial: visão geral, solicitações, clientes agendados (apenas confirmados), histórico até 400 registros, serviços, vouchers, configurações e horários.
- Vouchers privados ou publicados na vitrine; o gerente define código manual ou deixa gerar um código aleatório; upload de banner para R2; download do card promocional em PNG (1080 × 1350), ideal para campanhas.
- Botão de WhatsApp no agendamento confirmado abre mensagem pronta para o gerente enviar. **Não envia mensagens automaticamente.**
- Sessão administrativa com cookie HttpOnly/SameSite, senha com hash PBKDF2-SHA256 e salt exclusivo armazenados no D1, troca obrigatória no primeiro acesso e nova troca no painel; proteção básica de tentativas por IP, validação do Origin e upload validado.

### Regras de negócio

1. Há **uma agenda compartilhada, com capacidade de um atendimento por vez**. Para operar vários profissionais simultaneamente, é preciso adicionar profissionais/recursos e capacidade por slot numa segunda etapa.
2. Os horários iniciais são: domingo e segunda fechados; terça a sexta 09:00–19:00; sábado 09:00–18:00. Todos podem ser editados no painel. Fuso inicial: **America/Manaus**.
3. Pode-se reservar até 60 dias no futuro, com pelo menos 60 minutos de antecedência no mesmo dia.
4. O voucher precisa estar válido **na data em que o cliente solicita o agendamento**; o atendimento pode acontecer depois da validade da promoção. Apenas agendamentos pendentes, confirmados ou concluídos consomem o limite de uso.
5. O serviço, desconto e preço cobrado ficam registrados no agendamento para preservar o histórico caso o gerente altere os preços depois.
6. Não há pagamento online, envio automático de e-mail/WhatsApp, equipe com vários logins, nem notificações push remotas nesta versão. Os valores mostrados no dashboard são **valores agendados, não faturamento recebido**.

## Implantação na Cloudflare (primeira vez)

Requisitos: Node.js 20+, npm, conta Cloudflare com Workers, D1 e R2 disponíveis e acesso ao terminal.

### 1. Instalar, autenticar

```bash
npm install
npx wrangler login
```

### 2. Criar o banco D1

```bash
npx wrangler d1 create aura-beauty-db
```

Copie o UUID `database_id` retornado e substitua `COLE_AQUI_O_DATABASE_ID_D1` dentro de `wrangler.jsonc`. **Não use o ID de outro banco/projeto.**

### 3. Criar o bucket R2

```bash
npx wrangler r2 bucket create aura-beauty-media-clecioam26
```

A ligação `MEDIA` do R2 já está preparada em `wrangler.jsonc`. Não é necessário tornar o bucket público; as imagens são lidas pelo próprio Worker.

### 4. Login inicial do gerente (já preparado)

O sistema agora mantém os dados de acesso do gerente no **D1**, por meio da nova migração `0003_admin_credentials.sql`. Não é necessário configurar `ADMIN_PASSWORD_HASH` ou `ADMIN_EMAIL` no Cloudflare.

- **E-mail:** `gerente@aura.com`
- **Senha inicial temporária:** `123`
- **Painel:** `/admin.html`

**ATENÇÃO:** `123` é uma senha muito fraca, colocada apenas a pedido para o primeiro acesso. É obrigatório trocá-la antes de acessar qualquer informação do painel. O D1 armazena somente o hash PBKDF2-SHA256 com salt aleatório, jamais a senha legível. Como o login inicial é conhecido, **publique apenas quando puder entrar imediatamente e trocar a senha**, preferencialmente antes de divulgar a URL.

Ao entrar pela primeira vez, você verá uma tela de troca obrigatória. Escolha uma senha nova com no mínimo 12 caracteres, contendo letras e números. Após salvar, o sistema encerra todas as sessões e pede login com a senha nova. Depois, sempre poderá alterá-la em **Painel → Segurança da conta** (informando a senha atual). Uma nova migração ou novo deploy **não redefine** sua senha.

Atenção: não exclua o D1 ou a tabela `admin_credentials` após configurar sua senha, pois isso remove o login permanente.

### 5. Preparar D1 e publicar

**Para quem já publicou o projeto:** faça backup do banco, preserve o mesmo `database_id` no `wrangler.jsonc`, aplique as migrações pendentes e publique novamente. A migração `0003` cria somente a tabela de credenciais e encerra sessões antigas; ela não apaga reservas, serviços ou vouchers. Caso o D1 já tenha uma conta cadastrada, `INSERT OR IGNORE` preserva a conta.


```bash
npx wrangler d1 migrations apply aura-beauty-db --remote
npm run deploy
```

O comando de migração cria todas as tabelas e inclui 8 serviços como exemplo. Como o banco é novo, não interfere em bancos de outros projetos. O deploy retornará a URL, normalmente `https://aura-beauty-studio.<seu-subdominio>.workers.dev`.

**Ordem importante:** crie D1 e R2, insira o UUID, execute as migrations e só então publique. Se publicar antes das migrations, as rotas retornarão erro de tabela inexistente.

### 6. Configurar seu salão

1. Abra `https://<sua-url-do-worker>/admin.html`.
2. Entre com **gerente@aura.com** e a senha temporária **123**. Defina uma nova senha obrigatoriamente na primeira entrada e entre novamente com ela.
3. No menu **Configurações**, altere nome do salão, endereço, WhatsApp, Instagram e dias/horários.
4. Em **Serviços e valores**, personalize preços, nomes, categorias, duração e imagens.
5. Em **Vouchers e promoções**, crie promoções, defina descontos, uso máximo, validade, banner e visibilidade pública.
6. Volte ao site público, simule uma reserva e confirme-a no painel em **Solicitações**. Ela então aparecerá em **Clientes agendados**.

## Testes em desenvolvimento

```bash
npx wrangler d1 migrations apply aura-beauty-db --local
npm run dev
```

Abra `http://localhost:8787` (página pública) e `http://localhost:8787/admin.html` (gerente). Os dados **locais** do D1/R2 não são os mesmos dados de produção. Use `npm test` para executar os testes unitários. Faça um teste manual de criação, confirmação, conflito de horários, voucher esgotado, recusa/cancelamento e upload de imagem após o primeiro deploy.

## Checklist de produção

- Troque imediatamente a senha temporária `123` por outra forte e exclusiva; não divulgue cookies de sessão nem links privados de acompanhamento.
- Adicione informações reais do salão; valores e imagens atuais são ilustrativos. Ajuste políticas de privacidade e retenção de dados à LGPD, incluindo meio de solicitação de exclusão e política de backups.
- Para lançamentos públicos com tráfego maior, avalie Cloudflare Turnstile adicionalmente ao limitador simples do projeto, monitoramento e rotina de backup do D1/R2.
- A configuração inicial considera apenas um gerente. Para salão com equipe, criar profissionais, agendas individuais, permissões e gestão de ausências.
- Fontes do Google e imagens demonstrativas de Unsplash são carregadas da internet; offline podem usar fontes/cores de fallback. Substitua por imagens do próprio salão usando o painel; mantenha somente material que você tem direito de utilizar.
- O botão de WhatsApp não envia mensagens sozinho; o gerente deve concluir o envio manualmente. Integração automática precisa da API oficial e aprovação do provedor.

## Estrutura do projeto

```text
├─ public/
│  ├─ index.html              Site público
│  ├─ admin.html              Login e painel administrativo
│  ├─ styles.css              Layout responsivo premium
│  ├─ app.js                  Lógica pública e agendamento
│  ├─ admin.js                Painel, vouchers, cards PNG
│  ├─ sw.js                   Cache da interface PWA
│  ├─ manifest.webmanifest    Instalação PWA
│  └─ assets/                 Ícones locais PWA
├─ src/
│  ├─ index.js                API do Worker (D1, R2, sessão)
│  └─ lib.js                  Validações e horários
├─ migrations/
│  ├─ 0001_initial.sql        Schema, triggers e serviços
│  ├─ 0002_request_limits.sql Limitador básico
│  └─ 0003_admin_credentials.sql Login inicial e senha no D1
├─ tests/core.test.mjs       Testes unitários
├─ wrangler.jsonc            Bindings e implantação
└─ package.json
```

### Referências oficiais

- [Workers e Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 batch (transações)](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [R2 via Worker](https://developers.cloudflare.com/r2/get-started/workers-api/)

**Versão:** 1.1.0 — Novembro de 2026. Projeto inicial preparado para implantação, ainda não publicado em conta Cloudflare.
