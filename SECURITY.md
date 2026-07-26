# Política de Segurança

## Reportar uma Vulnerabilidade

Se você encontrar uma vulnerabilidade de segurança, **não abra uma issue pública**. Entre em contato diretamente com a mantenedora do projeto via [GitHub Issues privado](https://github.com/kamilaalves1/vertex-control-center/security/advisories/new).

Inclua:
- Descrição da vulnerabilidade
- Passos para reproduzir
- Impacto potencial
- Sugestão de correção (se houver)

## Checklist de Hardening

### Credenciais
- [ ] `AUTH_PASS` é uma senha forte e única (mín. 12 caracteres)
- [ ] `API_KEY` é uma string aleatória (não o padrão gerado em dev)
- [ ] `AUTH_SECRET` é uma string aleatória longa
- [ ] Arquivo `.env` tem permissões `600` (somente leitura pelo dono)

### Rede
- [ ] `MC_ALLOWED_HOSTS` configurado com os hostnames permitidos
- [ ] Dashboard atrás de reverse proxy com TLS (nginx, Caddy, Traefik)
- [ ] `MC_ENABLE_HSTS=1` configurado para deployments HTTPS
- [ ] `MC_COOKIE_SECURE=1` configurado para deployments HTTPS
- [ ] `MC_COOKIE_SAMESITE=strict`
- [ ] `MC_TRUSTED_PROXIES` configurado com o IP do reverse proxy

### Docker
- [ ] Usar o overlay de hardening: `docker compose -f docker-compose.yml -f docker-compose.hardened.yml up`
- [ ] Container roda como usuário não-root (`nextjs`, UID 1001)
- [ ] Filesystem read-only com tmpfs para diretórios temporários
- [ ] Todas as capabilities Linux removidas exceto `NET_BIND_SERVICE`
- [ ] Opção de segurança `no-new-privileges` habilitada
- [ ] Rotação de logs configurada (max-size, max-file)

### Monitoramento
- [ ] Rate limiting ativo (`MC_DISABLE_RATE_LIMIT` NÃO definido)
- [ ] Audit logging habilitado com retenção adequada
- [ ] Backups regulares do banco de dados configurados

Consulte a seção [Segurança](README.md#segurança) do README para detalhes de cada controle implementado.
