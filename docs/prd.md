📄 PRD — Sistema de Emissão de Certificados (Versão para Execução)
1. 📌 Visão do Produto

Nome (temporário): CertifyPro
Objetivo: Permitir que empresas gerem certificados em massa de forma simples, rápida e sem conhecimento técnico.

2. 🎯 Proposta de Valor

“Gere centenas de certificados em minutos, sem precisar usar Canva ou editar um por um.”

3. 👤 Usuário-Alvo
Empresas de cursos presenciais (ex: bombeiro civil)
Pequenos treinamentos
Instrutores independentes
4. 🚀 Estratégia de Desenvolvimento

O sistema será construído em ETAPAS (Sprints):

👉 Cada etapa gera valor real
👉 Cada etapa pode ser testada com usuário

🧩 ETAPA 1 — MVP BASE (FUNCIONAL)
🎯 Objetivo:

Gerar certificados em lote a partir de imagem

✅ Funcionalidades
Upload de modelo (PNG/JPG)
Definir posição fixa de campos (hardcoded)
Upload de CSV
Gerar certificados em PDF
Download em ZIP
⚙️ Requisitos Técnicos
Backend: Node.js (Express)
Lib imagem: canvas
Lib PDF: pdf-lib
ZIP: archiver
📦 Entrega esperada

👉 Sistema funcional rodando local
👉 Geração de até 100 certificados

🧩 ETAPA 2 — SUPORTE A PDF (FUNDO)
🎯 Objetivo:

Permitir uso de certificados profissionais em PDF

✅ Funcionalidades
Upload de PDF
Renderização como fundo
Escrita de texto por cima
📌 Regra técnica
NÃO usar campos editáveis (AcroForm)
Apenas sobreposição
📦 Entrega esperada

👉 Sistema aceitando imagem + PDF
👉 Layout preservado

🧩 ETAPA 3 — EDITOR VISUAL (CORE)
🎯 Objetivo:

Eliminar necessidade de coordenadas no código

✅ Funcionalidades
Exibir certificado na tela
Adicionar campos (Nome, CPF)
Arrastar campos
Salvar posição (X, Y)
Preview com dados fictícios
📌 Requisitos UX
Drag-and-drop fluido
Feedback visual
Interface simples
📦 Entrega esperada

👉 Usuário posiciona campos sozinho
👉 Sem depender de dev

🧩 ETAPA 4 — CSV + VALIDAÇÃO
🎯 Objetivo:

Garantir entrada de dados confiável

✅ Funcionalidades
Upload CSV
Validação de colunas obrigatórias:
nome
cpf
Preview dos dados
Tratamento de erro
📦 Entrega esperada

👉 CSV validado antes da geração
👉 Menos erro de usuário

🧩 ETAPA 5 — PERFORMANCE E ESCALA
🎯 Objetivo:

Evitar travamentos

✅ Funcionalidades
Processamento em lote (50 por vez)
Limite de 300 certificados
Barra de progresso
Geração otimizada de ZIP
📦 Entrega esperada

👉 Sistema estável
👉 Tempo de resposta aceitável

🧩 ETAPA 6 — UX FINAL
🎯 Objetivo:

Deixar produto pronto para uso real

✅ Funcionalidades
Feedback visual (loading, sucesso)
Nome automático dos arquivos
Fluxo guiado (step-by-step)
Botões claros
📦 Entrega esperada

👉 Produto utilizável por leigo

🧩 ETAPA 7 — (PÓS-MVP / FUTURO)
Login e autenticação
Histórico de certificados
QR Code de validação
Página de verificação
Multiempresa (SaaS)
Cobrança
5. ⚙️ Arquitetura Geral
Backend
Node.js + Express
Frontend
HTML + CSS + JS (ou React depois)
Fluxo:
Upload → Configurar → CSV → Processar → ZIP
6. 📊 Regras de Negócio
Máximo 300 certificados por geração
Campos obrigatórios:
nome
cpf
Nome do arquivo:
certificado-{nome}.pdf
7. ⚠️ Riscos Técnicos
Alinhamento de texto
Escala do PDF
Nomes longos
Encoding CSV
8. 📈 Critérios de Sucesso
100 certificados em < 5 segundos
0 erros de geração
Usuário consegue usar sem ajuda