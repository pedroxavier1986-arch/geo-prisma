# Geo Prisma · ANALITX

Aplicação Next.js para importar Excel, geocodificar CEP + cidade em segundo plano no Supabase e baixar uma nova planilha. Identidade baseada na imagem oficial fornecida da ANALITX: branco, preto e azul.

## Executar

Requer Node.js 20.9 ou superior. Execute `npm ci`, copie `.env.example` para `.env.local`, configure a URL da Edge Function e execute `npm run dev`.

`npm run build` valida a produção. `npm test` verifica normalização, agrupamento, reparo de coordenadas incompletas, preservação de outras abas e rejeição de estrutura inválida. `node tests/integration.mjs` cria um arquivo sintético no Supabase e verifica upload, isolamento de sessão, fila e download; usa uma consulta real ao Photon.

## Entrada e saída

- `.xlsx` de até 5 MB, até 20.000 linhas e até 3.000 localidades únicas, na aba `Base`.
- Colunas `cep` (ou `postcode`), `city`, `latitude`, `longitude`.
- Leitura, validação e montagem do Excel no navegador. O arquivo original fica no bucket privado; o resultado é reconstruído a partir das coordenadas persistidas ao baixar.
- Coordenadas completas são preservadas; pares incompletos são substituídos integralmente quando há resultado.
- O relatório registra pendências. Demais abas, valores e formatação comum são preservados pelo ExcelJS; recursos avançados de Excel, como gráficos e objetos incorporados, não têm garantia de fidelidade. Manter sempre o original.

## Supabase

Projeto `GeoPrisma`, região São Paulo, referência `zcmwhnpybnwirlwkoqbx`.

- `supabase/schema.sql`: esquema aplicado remotamente como `geo_prisma_initial`.
- `supabase/functions/geo-prisma/index.ts`: API e processador.
- Bucket privado `geo-prisma`, tabelas com RLS e sem permissões para `anon` ou `authenticated`. Não há acesso direto pelo cliente às tabelas.
- A sessão usa uma capacidade aleatória de 256 bits, guardada neste navegador; no servidor, somente o hash. Cada arquivo é autorizado por esse hash. Limpar os dados do navegador perde o acesso ao histórico. Uma implantação multiusuário corporativa pode substituir isso por Supabase Auth.
- A Edge Function usa `verify_jwt=false` porque valida autenticação própria: `x-session-key` para arquivos, `x-worker-key` exclusivo do agendador. A chave de serviço fica apenas no runtime Supabase. URLs de download expiram em 120 segundos.
- A fila usa tabelas Postgres, lease global, tentativas e progresso persistentes. Cron executa a cada minuto. Cada execução processa até 20 localidades e respeita um limite interno de tempo. A aplicação continua processando sem navegador aberto.
- Limite inicial: 5 uploads por sessão/hora e 100 uploads globais/dia. Não há login. Para publicação aberta em grande escala, ajustar quotas e autenticação antes de divulgar amplamente.
- A credencial do cron é criada no Vault, sem exposição em arquivos ou no navegador. O cron somente chama a função quando há trabalho pendente.

## Geocodificação

O provedor inicial é Photon/OSM. Aceitamos somente resultados que confirmam país BR, CEP e cidade. Isso favorece precisão e pode deixar mais pendências que o script antigo. Cache por localidade por 30 dias, um worker global, intervalo de 1,2 segundo e até três tentativas em falhas temporárias.

O servidor público Photon não tem SLA e limita uso excessivo. Para maior volume, configurar `PHOTON_URL` no Supabase para uma instância contratada ou própria. Não incluímos o Nominatim público nem o ArcGIS sem licença de armazenamento como fallbacks automáticos. Dados OSM: https://www.openstreetmap.org/copyright.

## Publicação

Projeto preparado para Vercel com `vercel.json`. A única variável pública é a URL da função; não há segredo de banco ou chave de serviço no frontend. O diretório a publicar é este, não a pasta que contém as planilhas originais.

Verificações: testes unitários, compilação Next.js, integração real com planilha sintética e advisors do Supabase. Os advisors informam RLS sem políticas em quatro tabelas; isso é intencional porque o acesso é exclusivo do serviço. `npm audit` aponta `uuid` transitivo de ExcelJS (moderado, v3/v5/v6 com buffer fornecido); o uso encontrado no ExcelJS é v4 sem buffer, fora do caminho afetado. Não houve teste visual automatizado em navegador.
