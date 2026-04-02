# CertifyPro

Gerador web de certificados em lote com upload de template (imagem/PDF), mapeamento de campos, validação de CSV e geração de ZIP com PDFs.

## Deploy no Render (Docker)

1. Faça push deste repositório para o GitHub.
2. No Render, clique em **New +** -> **Blueprint**.
3. Selecione este repositório (o arquivo `render.yaml` será detectado).
4. Confirme a criação do serviço.

### Variáveis importantes

- `NODE_ENV=production`
- `UPLOAD_DIR=/var/data/uploads`

## Execução local

```bash
npm install
npm run dev
```

A aplicação sobe em `http://localhost:3000`.
