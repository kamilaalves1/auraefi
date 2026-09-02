# Como publicar o Aura

Kamila, mudou uma coisa: **publicar agora e criar uma tag de versao**, e nao mais
fazer merge em master. O merge continua sendo necessario, mas ele sozinho nao
coloca nada no ar.

Este guia tem tudo o que voce precisa. Se algo aqui nao bater com o que aparece na
tela, me chame -- o guia esta errado, nao voce.

---

## O que mudou, em uma frase

Antes: merge em master, depois apertar o botao de deploy no pipeline.
Agora: merge em master, depois **criar e empurrar uma tag `vX.Y.Z`**.

**ATENCAO:** merge em master **nao publica mais nada**. O pipeline do master
continua rodando (ele confere o build e o typecheck, e isso e util). Se voce fizer
merge e ficar esperando, nada vai acontecer. Essa e a pergunta que vai aparecer na
primeira semana -- "por que minha alteracao nao subiu?" -- e a resposta e quase
sempre: **falta a tag**.

**ATENCAO 2 -- o botao antigo ainda existe.** Durante a transicao, o pipeline do
master continua mostrando um botao de deploy. **Nao use.** Ele publica pelo
caminho velho, que nao passa por nenhuma das conferencias novas e nao conversa com
o caminho por tag. Ele vai ser apagado assim que a esteira nova estiver rodando.
Se voce clicar nele por engano, me avise -- nao e o fim do mundo, mas eu preciso
saber.

---

## Publicar

Quatro comandos, na sua maquina, com a alteracao ja mergeada em master:

```bash
git checkout master
git pull
git tag v1.0.3
git push origin v1.0.3
```

Troque `v1.0.3` pelo numero novo. A regra e simples:

- correcao pequena, sem mudanca de comportamento: sobe o ultimo numero
  (`v1.0.2` -> `v1.0.3`)
- alteracao ou recurso novo: sobe o numero do meio e zera o ultimo
  (`v1.0.3` -> `v1.1.0`)

O formato tem de ser exatamente `v` + tres numeros separados por ponto. `v1.0.3`
funciona. `1.0.3`, `v1.0`, `v1.0.3-teste` e `release-3` nao funcionam -- o pipeline
para e explica.

Use `git tag v1.0.3`, simples, como esta acima. **Nao** use `git tag -a` e **nao**
crie a tag pela tela do GitLab preenchendo o campo de mensagem: as duas formas
criam um tipo diferente de tag que a esteira ainda nao trata direito. Se voce criar
sem querer, apague e recrie com o comando simples.

Para saber qual foi a ultima tag publicada:

```bash
git fetch --tags
git tag --sort=-v:refname | head -5
```

---

## O que voce vai ver

Voce vai ver **dois pipelines** para a mesma tag. Isso e o esperado.

**Primeiro pipeline** -- aparece em segundos, na aba Pipelines, com a tag `v1.0.3`
no lugar do nome do branch. Ele tem um job, `disparar-esteira`. Quando ele fica
verde, no final do log tem uma linha assim:

```
pipeline de infraestrutura criado: id=4712
acompanhe em: https://gitlab.interno.testegerencianet.com.br/.../pipelines/4712
```

Esse primeiro verde significa apenas **"o pedido foi aceito"**. Ele nao significa
que a sua alteracao esta no ar. O proprio log avisa isso em letras grandes.

**No meio do caminho: alguem da Infra Cloud precisa aprovar.** O pipeline de
infraestrutura constroi o pacote, confere tudo e entao **para de proposito**, num
job de deploy que espera um clique. Enquanto ninguem clicar, nada vai para o ar e
o segundo pipeline **nao aparece**. Isso e intencional: deploy no Aura passa por
uma pessoa. Se voce publicou uma tag e passou de **30 minutos** sem o segundo
pipeline, **cobre no canal da Infra Cloud** com o link que o primeiro pipeline
imprimiu -- provavelmente e so o clique que ainda nao aconteceu.

**Segundo pipeline** -- aparece depois do clique, na mesma tag, com um job chamado
`receber-callback`. **E esse que vale.**

- **verde** -> `DEPLOY CONFIRMADO: v1.0.3 esta no ar`. Pronto, acabou.
- **vermelho** -> algo falhou. O log desse job traz, decodificado, o relatorio de
  quem tentou implantar. Leia antes de repetir.

Se voce quiser acompanhar no meio do caminho, abra o link que o primeiro pipeline
imprimiu. Se esse link devolver **404**, voce nao tem acesso ao projeto de
infraestrutura -- me chame, e ajuste de permissao, nao erro seu.

---

## Se der errado

### O primeiro pipeline ficou vermelho

Abra o job `disparar-esteira` e leia a ultima linha. Sao tres possibilidades:

| O que aparece | O que fazer |
|---|---|
| `a tag ... nao segue o padrao vX.Y.Z` | apague a tag errada e crie a certa (comandos abaixo) |
| `DEPLOY_TRIGGER_TOKEN chegou VAZIA` | nao e coisa sua, e configuracao do projeto. Me chame |
| `o trigger nao criou pipeline` / `HTTP 404` | nao e coisa sua. Me chame |

Apagar uma tag errada:

```bash
git tag -d v1.0.3
git push origin :refs/tags/v1.0.3
```

Depois crie a tag certa normalmente. Nada foi para o ar nesse meio tempo.

### O primeiro ficou verde e o segundo nunca apareceu

Este e o caso mais provavel da primeira semana, e quase sempre **nao e erro**: o
deploy esta esperando o clique da Infra Cloud. Espere ate 30 minutos, depois cobre
no canal com o link do pipeline de infraestrutura. Nao empurre a tag de novo e nao
crie uma tag nova -- isso nao acelera nada e atrapalha o rastro.

### O segundo pipeline ficou vermelho

Leia o log do job `receber-callback`. Ele traz o relatorio do deploy inteiro.

**A aplicacao provavelmente continua no ar na versao anterior.** O processo de
deploy volta atras sozinho quando falha depois de trocar a versao -- ele recria o
processo na release antiga e confere se a aplicacao responde. Procure no log:

- `[rollback] aplicacao saudavel apos <N>s` -> esta tudo estavel na versao velha.
  Nada urgente; me mande o link e a gente investiga com calma.
- `[rollback] CRITICO: aplicacao nao responde depois do rollback` -> **isso e
  urgente.** Chame a Infra Cloud imediatamente, nao espere resposta no canal.

O que **nao** ajuda: empurrar a mesma tag de novo, ou apertar o botao mais vezes.
Se o motivo da falha nao mudou, o resultado nao muda. Me mande o link do pipeline.

### Nao apareceu pipeline nenhum

Confira se a tag chegou no servidor:

```bash
git ls-remote --tags origin | grep v1.0.3
```

Se nao aparecer, o `git push origin v1.0.3` nao foi feito ou foi recusado. Rode de
novo e leia a saida. Se aparecer `protected tag` ou `pre-receive hook declined`,
voce nao tem permissao para criar tag `v*` -- me chame, e ajuste de projeto.

---

## Voltar para a versao anterior

Voce nao precisa fazer isso sozinha, e nao e no seu repositorio. Me chame, ou quem
estiver de plantao na Infra Cloud, com **duas informacoes**:

1. a tag que quebrou (ex. `v1.0.3`)
2. a tag que estava funcionando antes (ex. `v1.0.2`)

**ATENCAO -- ate a SEGUNDA tag publicada por esta esteira, nao existe volta
automatica.** O rollback novo so consegue voltar para uma versao que a **propria
esteira nova** publicou. As versoes antigas (as que tem nome `master-<codigo>`)
nao servem para ele. Enquanto so houver uma tag `vX.Y.Z` publicada, se der errado
a recuperacao e manual, feita pela Infra Cloud -- continua sendo rapida, mas nao e
um botao. Depois da segunda tag isso deixa de valer.

**Nao** apague a tag que quebrou. Ela e a evidencia do que foi publicado.

---

## Duas coisas que valem lembrar

**Cada tag e publicada uma vez.** Se voce esquecer um arquivo, nao reaproveite o
numero: crie a proxima tag. Reempurrar a mesma tag com conteudo diferente faz o
numero deixar de identificar o que foi para o ar, e e isso que quebra o rollback
depois.

**Verde no primeiro pipeline nao e deploy feito.** Vale repetir porque e a
confusao mais provavel nas primeiras semanas. O que conta e o segundo -- e o
segundo so nasce depois que alguem da Infra Cloud aprova.
