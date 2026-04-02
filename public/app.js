(function () {
  const API = '';

  const SESSION_STORAGE_KEY = 'certifypro_sessionId';
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  let sessionId = null;
  /** Evita GET de validação em toda chamada; invalidar após 404 de sessão. */
  let sessionValidated = false;
  let refWidth = 0;
  let refHeight = 0;
  let layout = null;
  let csvOk = false;
  let rowCount = 0;
  let fieldOrder = [];
  let fieldLabels = {};
  /** Campos personalizados pendentes: { key, label } */
  let customFieldsLocal = [];

  const $ = (sel) => document.querySelector(sel);

  const panels = [1, 2, 3, 4].map((n) => $(`#panel-${n}`));
  const stepEls = [...document.querySelectorAll('.steps li')];

  function setStep(n) {
    panels.forEach((p, i) => p.classList.toggle('active', i + 1 === n));
    stepEls.forEach((li, i) => {
      li.classList.remove('active', 'done');
      if (i + 1 === n) li.classList.add('active');
      if (i + 1 < n) li.classList.add('done');
    });
    if (n !== 2) {
      const ew = document.getElementById('editor-wrap');
      if (ew) ew.classList.remove('editor-wrap--minimal-chrome');
    }
  }

  /** Limpa dimensões do modelo no cliente (evita layout “fantasma” após nova sessão vazia no servidor). */
  function clearTemplateClientState() {
    refWidth = 0;
    refHeight = 0;
    layout = null;
    csvOk = false;
    rowCount = 0;
    const img = $('#editor-bg');
    if (img) img.removeAttribute('src');
    const fc = $('#field-markers-container');
    if (fc) fc.innerHTML = '';
    const b1 = $('#btn-next-1');
    const b2 = $('#btn-next-2');
    const b3 = $('#btn-next-3');
    if (b1) b1.disabled = true;
    if (b2) b2.disabled = true;
    if (b3) b3.disabled = true;
    const ts = $('#template-status');
    if (ts) {
      ts.textContent = '';
      ts.classList.remove('ok', 'error');
    }
    updateSummary();
  }

  function invalidateSession() {
    sessionId = null;
    sessionValidated = false;
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
    clearTemplateClientState();
  }

  function normalizeSessionPath(path) {
    const p = String(path || '').trim();
    if (!p) return '/';
    return p.startsWith('/') ? p : `/${p}`;
  }

  /**
   * GET/POST etc. com URL `/api/session/:id/...`.
   * `options` pode ser objeto ou função que devolve um novo objeto (obrigatório para FormData em retry).
   * Em 404 com mensagem de sessão, limpa sessão, cria outra e tenta de novo uma vez.
   */
  async function fetchSession(path, optionsOrFn) {
    const rel = normalizeSessionPath(path);
    const build = typeof optionsOrFn === 'function' ? optionsOrFn : () => optionsOrFn;

    await ensureSession();
    const url = () => `${API}/api/session/${sessionId}${rel}`;

    let r = await fetch(url(), build());
    if (r.status !== 404) return r;

    let errText = '';
    try {
      const j = await r.clone().json();
      errText = String(j.error || '');
    } catch (_) {
      try {
        errText = await r.clone().text();
      } catch (_) {
        /* ignore */
      }
    }
    if (!/sessão/i.test(errText)) return r;

    invalidateSession();
    await ensureSession();
    return fetch(url(), build());
  }

  async function ensureSession() {
    if (!sessionId) {
      try {
        const s = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (s && UUID_RE.test(s)) sessionId = s;
      } catch (_) {
        /* ignore */
      }
    }

    if (sessionId && !sessionValidated) {
      const v = await fetch(`${API}/api/session/${sessionId}`);
      if (v.ok) {
        sessionValidated = true;
        return;
      }
      invalidateSession();
    }

    if (sessionId && sessionValidated) return;

    const r = await fetch(`${API}/api/session`, { method: 'POST' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Falha ao criar sessão');
    sessionId = j.sessionId;
    sessionValidated = true;
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } catch (_) {
      /* ignore */
    }
  }

  function showStatus(el, text, type) {
    el.textContent = text || '';
    el.classList.remove('error', 'ok');
    if (type) el.classList.add(type);
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // —— Etapa 1 ——
  const inputTemplate = $('#input-template');
  const dropTemplate = $('#drop-template');
  const templateStatus = $('#template-status');
  const btnNext1 = $('#btn-next-1');

  async function uploadTemplate(file) {
    if (!file) return;
    showStatus(templateStatus, 'Enviando modelo…');
    btnNext1.disabled = true;
    try {
      await ensureSession();
      await persistFieldConfigBeforeNewTemplate();
      const r = await fetchSession('/template', () => {
        const fd = new FormData();
        fd.append('template', file);
        return { method: 'POST', body: fd };
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Falha no upload');
      refWidth = j.width;
      refHeight = j.height;
      layout = j.layout;
      fieldOrder = j.fieldOrder || ['nome'];
      fieldLabels = j.fieldLabels || {};
      customFieldsLocal = Array.isArray(j.customFields)
        ? j.customFields.map((c) => ({ key: c.key, label: c.label || c.key }))
        : [];
      renderCustomList();
      syncCheckboxesFromFieldOrder();
      const img = $('#editor-bg');
      img.src = j.previewUrl.startsWith('http') ? j.previewUrl : `${API}${j.previewUrl}`;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('Não foi possível carregar a prévia.'));
      });
      buildMarkerDom();
      applyLayoutToFields();
      positionFieldsFromLayout();
      showStatus(templateStatus, `Modelo carregado (${j.templateType === 'pdf' ? 'PDF' : 'imagem'}, ${j.width}×${j.height}px).`, 'ok');
      btnNext1.disabled = false;
      $('#btn-next-2').disabled = false;
    } catch (e) {
      showStatus(templateStatus, e.message, 'error');
    }
  }

  inputTemplate.addEventListener('change', () => uploadTemplate(inputTemplate.files[0]));
  setupDrop(dropTemplate, inputTemplate, uploadTemplate);
  btnNext1.addEventListener('click', () => setStep(2));

  function setupDrop(zone, input, handler) {
    zone.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (ev) => {
      ev.preventDefault();
      zone.classList.remove('dragover');
      const f = ev.dataTransfer.files[0];
      if (f) handler(f);
    });
    // Não chamar input.click() aqui: o <label> que envolve o input já abre o seletor;
    // um segundo click() fazia o diálogo abrir duas vezes (fecha e abre de novo).
  }

  // —— Etapa 2 —— editor ——
  const editorCanvas = $('#editor-canvas');
  /** Campos que já existiam no editor (para destacar só os recém-adicionados). */
  let markerKeysSeen = new Set();

  function loadFontChoices() {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${API}/font-choices.json`, false);
      xhr.send(null);
      if (xhr.status === 200) {
        const list = JSON.parse(xhr.responseText);
        if (Array.isArray(list) && list.length) return list;
      }
    } catch (e) {
      /* fallback abaixo */
    }
    return [
      'Segoe UI',
      'Arial',
      'Times New Roman',
      'Georgia',
      'Calibri',
      'Verdana',
      'Courier New',
      'Tahoma',
    ];
  }
  const FONT_CHOICES = loadFontChoices();

  function fontFamilyCss(name) {
    const esc = String(name || 'Segoe UI').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${esc}", Arial, sans-serif`;
  }

  function restoreFontListToPicker(list) {
    if (!list || !list._fontPickerReturn) return;
    if (list.parentNode === document.body) {
      list._fontPickerReturn.appendChild(list);
    }
    list.style.cssText = '';
  }

  function closeAllFontPickers() {
    document.querySelectorAll('.field-font-list').forEach((list) => {
      list.setAttribute('hidden', '');
      restoreFontListToPicker(list);
    });
    document.querySelectorAll('.field-font-trigger').forEach((t) => {
      t.setAttribute('aria-expanded', 'false');
    });
  }

  /** Barra de rolagem nativa nem sempre coloca `target` dentro da lista; usa o ponto do clique. */
  function isPointOverFontPickerUi(clientX, clientY) {
    if (clientX == null || clientY == null) return false;
    const stack = document.elementsFromPoint(clientX, clientY);
    return stack.some((el) => {
      if (!el || !el.classList) return false;
      return (
        el.classList.contains('field-font-list') ||
        el.classList.contains('field-font-option') ||
        el.classList.contains('field-font-picker') ||
        el.classList.contains('field-font-trigger') ||
        el.classList.contains('field-font-trigger-name')
      );
    });
  }

  function scrollEventIsInsideFontList(e) {
    const t = e.target;
    if (t && t.nodeType === 1 && t.closest && t.closest('.field-font-list')) return true;
    return false;
  }

  function positionFontList(list, trigger) {
    const r = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxH = 280;
    const spaceBelow = vh - r.bottom - 8;
    const spaceAbove = r.top - 8;
    let top = r.bottom + 4;
    let maxHeight = Math.min(maxH, Math.max(100, spaceBelow));
    if (spaceBelow < 120 && spaceAbove > spaceBelow) {
      maxHeight = Math.min(maxH, Math.max(100, spaceAbove));
      top = Math.max(8, r.top - maxHeight - 4);
    }
    const w = Math.max(220, r.width);
    let left = r.left;
    if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
    list.style.cssText = [
      'position:fixed',
      'z-index:10000',
      `left:${left}px`,
      `top:${top}px`,
      `width:${w}px`,
      `max-height:${maxHeight}px`,
      'overflow-y:auto',
      'box-sizing:border-box',
    ].join(';');
  }

  function syncFontPickerUi(fieldDrag) {
    const hidden = fieldDrag.querySelector('input.field-font-value');
    const nameSpan = fieldDrag.querySelector('.field-font-trigger-name');
    if (!hidden || !nameSpan) return;
    let v = hidden.value || 'Segoe UI';
    if (!FONT_CHOICES.includes(v)) v = 'Segoe UI';
    hidden.value = v;
    nameSpan.textContent = v;
    nameSpan.style.fontFamily = fontFamilyCss(v);
  }

  function attachFontPickerBehavior(fieldDrag) {
    const picker = fieldDrag.querySelector('.field-font-picker');
    if (!picker) return;
    const trigger = picker.querySelector('.field-font-trigger');
    const list = picker.querySelector('.field-font-list');
    const hidden = picker.querySelector('input.field-font-value');
    if (!trigger || !list || !hidden) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = !list.hasAttribute('hidden');
      closeAllFontPickers();
      if (wasOpen) return;
      if (!list._fontPickerReturn) list._fontPickerReturn = picker;
      document.body.appendChild(list);
      list.removeAttribute('hidden');
      positionFontList(list, trigger);
      trigger.setAttribute('aria-expanded', 'true');
    });

    list.querySelectorAll('.field-font-option').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        hidden.value = btn.dataset.value || 'Segoe UI';
        closeAllFontPickers();
        syncFontPickerUi(fieldDrag);
        updateFieldPreviewFont(fieldDrag);
      });
    });

    list.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    list.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
  }

  document.addEventListener(
    'wheel',
    (e) => {
      if (e.target.closest && e.target.closest('.field-font-list')) e.stopPropagation();
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest && e.target.closest('.field-font-picker')) return;
      if (e.target.closest && e.target.closest('.field-font-list')) return;
      if (isPointOverFontPickerUi(e.clientX, e.clientY)) return;
      closeAllFontPickers();
    },
    true,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllFontPickers();
  });
  window.addEventListener('resize', closeAllFontPickers);
  window.addEventListener(
    'scroll',
    (e) => {
      if (scrollEventIsInsideFontList(e)) return;
      closeAllFontPickers();
    },
    true,
  );
  const editorWrapEl = document.getElementById('editor-wrap');
  if (editorWrapEl) {
    editorWrapEl.addEventListener(
      'scroll',
      (e) => {
        if (scrollEventIsInsideFontList(e)) return;
        closeAllFontPickers();
      },
      { passive: true },
    );
    editorWrapEl.addEventListener('pointerdown', (ev) => {
      if (isPointOverFontPickerUi(ev.clientX, ev.clientY)) return;
      if (ev.target.closest && ev.target.closest('.field-font-list')) return;
      if (ev.target.closest && ev.target.closest('.field-drag')) {
        editorWrapEl.classList.remove('editor-wrap--minimal-chrome');
        return;
      }
      closeAllFontPickers();
      editorWrapEl.classList.add('editor-wrap--minimal-chrome');
    });
  }

  const PREVIEW_STD = {
    nome: 'Maria Silva Santos',
    cpf: '000.000.000-00',
    data: '15/03/2026',
    curso: 'Nome do curso (exemplo)',
    horas: '40 horas',
  };
  const RESERVED_CLIENT_KEYS = new Set(['nome', 'cpf', 'data', 'curso', 'horas']);

  function slugifyClient(s) {
    return String(s || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 42);
  }

  function syncCheckboxesFromFieldOrder() {
    ['cpf', 'data', 'curso', 'horas'].forEach((k) => {
      const el = document.getElementById(`chk-${k}`);
      if (el) el.checked = fieldOrder.includes(k);
    });
  }

  function collectFieldConfigPayload() {
    const enabledStandard = [];
    ['cpf', 'data', 'curso', 'horas'].forEach((k) => {
      const el = document.getElementById(`chk-${k}`);
      if (el && el.checked) enabledStandard.push(k);
    });
    return { enabledStandard, customFields: customFieldsLocal };
  }

  /** Antes de trocar o fundo: grava checkboxes/campos personalizados no servidor para não perder o que ainda não foi “Aplicar”. */
  async function persistFieldConfigBeforeNewTemplate() {
    if (!sessionId || !refWidth || !refHeight) return;
    try {
      await flushLayoutFromDomToServer();
      const r = await fetchSession('/field-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectFieldConfigPayload()),
      });
      const j = await r.json();
      if (!r.ok) return;
      fieldOrder = j.fieldOrder;
      fieldLabels = j.fieldLabels;
      layout = j.layout;
      customFieldsLocal = Array.isArray(j.customFields)
        ? j.customFields.map((c) => ({ key: c.key, label: c.label || c.key }))
        : [];
      renderCustomList();
      syncCheckboxesFromFieldOrder();
    } catch {
      /* upload do modelo segue mesmo assim */
    }
  }

  function renderCustomList() {
    const ul = $('#custom-fields-list');
    ul.innerHTML = '';
    customFieldsLocal.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'custom-field-item';
      li.innerHTML = `<span class="custom-field-label">${escapeHtml(c.label)}</span> <code>${escapeHtml(c.key)}</code> <button type="button" class="btn-remove-custom" data-i="${i}">Remover</button>`;
      ul.appendChild(li);
    });
  }

  $('#custom-fields-list').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.btn-remove-custom');
    if (!btn) return;
    customFieldsLocal.splice(Number(btn.dataset.i), 1);
    renderCustomList();
  });

  const HUD_COLLAPSE_PREFIX = 'certifypro_hudCollapsed_';

  function isHudCollapsedForKey(key) {
    try {
      return sessionStorage.getItem(HUD_COLLAPSE_PREFIX + key) === '1';
    } catch {
      return false;
    }
  }

  function setHudCollapsedForKey(key, collapsed) {
    try {
      if (collapsed) sessionStorage.setItem(HUD_COLLAPSE_PREFIX + key, '1');
      else sessionStorage.removeItem(HUD_COLLAPSE_PREFIX + key);
    } catch {
      /* ignore */
    }
  }

  function wireHudToggle(wrap, key) {
    const btn = wrap.querySelector('.field-hud-toggle');
    if (!btn) return;
    const setLabels = (collapsed) => {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('aria-label', collapsed ? 'Abrir ajustes de texto' : 'Ocultar ajustes de texto');
      btn.title = collapsed ? 'Fonte, tamanho e espessura' : 'Ocultar painel de ajustes';
    };
    if (isHudCollapsedForKey(key)) {
      wrap.classList.add('field-drag--hud-collapsed');
      setLabels(true);
    } else {
      wrap.classList.remove('field-drag--hud-collapsed');
      setLabels(false);
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const wasExpanded = btn.getAttribute('aria-expanded') === 'true';
      const nowCollapsed = wasExpanded;
      btn.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
      wrap.classList.toggle('field-drag--hud-collapsed', nowCollapsed);
      setLabels(nowCollapsed);
      setHudCollapsedForKey(key, nowCollapsed);
    });
  }

  function buildMarkerDom() {
    closeAllFontPickers();
    const ew = document.getElementById('editor-wrap');
    if (ew) ew.classList.remove('editor-wrap--minimal-chrome');
    const container = $('#field-markers-container');
    container.innerHTML = '';
    if (!fieldOrder.length) return;
    fieldOrder.forEach((key) => {
      const spec = layout && layout[key];
      const fs = spec ? Math.round(spec.fontSize) : key === 'nome' ? 28 : 16;
      const fwRaw = spec && Number(spec.fontWeight);
      const weightVal =
        Number.isFinite(fwRaw) ? Math.min(900, Math.max(300, Math.round(fwRaw / 100) * 100)) : 400;
      const initialFont =
        spec && spec.fontFamily && FONT_CHOICES.includes(spec.fontFamily) ? spec.fontFamily : 'Segoe UI';
      const labelText = (fieldLabels && fieldLabels[key]) || key;
      const previewSample = PREVIEW_STD[key] || 'Texto exemplo';
      const wrap = document.createElement('div');
      wrap.className = 'field-drag';
      wrap.id = `field-${key}`;
      wrap.dataset.fieldKey = key;
      wrap.tabIndex = 0;
      wrap.setAttribute('aria-label', `${labelText} — arraste para posicionar`);
      wrap.innerHTML = `
        <span class="field-marker-label">${escapeHtml(labelText)}</span>
        <div class="field-preview-row">
          <div class="field-hud-slot">
            <div class="field-hud">
              <div class="field-hud-inner">
                <label class="font-row">Tamanho <input type="range" class="field-size-range" id="font-${key}" min="8" max="200" step="1" value="${fs}" /></label>
                <label class="font-row" title="Quanto mais à direita, mais grossa a letra">Espessura <input type="range" class="field-weight-range" id="weight-${key}" min="300" max="900" step="100" value="${weightVal}" /></label>
                <div class="font-row field-font-row">
                  <span class="field-font-row-label">Fonte</span>
                  <div class="field-font-picker">
                    <input type="hidden" id="family-${key}" class="field-font-value" value="${escapeHtml(initialFont)}" />
                    <button type="button" class="field-font-trigger" aria-expanded="false" aria-haspopup="listbox" aria-label="Escolher fonte">
                      <span class="field-font-trigger-name"></span>
                    </button>
                    <ul class="field-font-list" role="listbox" hidden></ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p class="field-preview-text">${escapeHtml(previewSample)}</p>
          <button type="button" class="field-hud-toggle" aria-expanded="true" aria-label="Ocultar ajustes de texto" title="Ocultar painel de ajustes">
            <svg class="field-hud-gear-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v1.5M12 20.5V22M4.22 4.22l1.06 1.06M18.72 18.72l1.06 1.06M2 12h1.5M20.5 12H22M4.22 19.78l1.06-1.06M18.72 5.28l1.06-1.06"/></g></svg>
          </button>
        </div>
      `;
      container.appendChild(wrap);
      const list = wrap.querySelector('.field-font-list');
      FONT_CHOICES.forEach((fname) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'none');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'field-font-option';
        btn.setAttribute('role', 'option');
        btn.dataset.value = fname;
        btn.style.fontFamily = fontFamilyCss(fname);
        btn.textContent = fname;
        li.appendChild(btn);
        list.appendChild(li);
      });
      syncFontPickerUi(wrap);
      attachFontPickerBehavior(wrap);
      wireHudToggle(wrap, key);
      makeDraggable(wrap);
      wrap.querySelectorAll('input.field-size-range, input.field-weight-range').forEach((r) => {
        r.addEventListener('input', () => updateFieldPreviewFont(wrap));
      });
    });

    const prevMarkerKeys = new Set(markerKeysSeen);
    if (prevMarkerKeys.size > 0) {
      fieldOrder.forEach((key) => {
        if (prevMarkerKeys.has(key)) return;
        const w = document.getElementById(`field-${key}`);
        if (!w) return;
        w.classList.add('field-drag--newPulse');
        window.setTimeout(() => w.classList.remove('field-drag--newPulse'), 2800);
      });
    }
    markerKeysSeen = new Set(fieldOrder);
  }

  async function applyFieldConfigFromUi() {
    await ensureSession();
    await flushLayoutFromDomToServer();
    const r = await fetchSession('/field-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectFieldConfigPayload()),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Falha ao aplicar campos');
    fieldOrder = j.fieldOrder;
    fieldLabels = j.fieldLabels;
    layout = j.layout;
    customFieldsLocal = j.customFields || [];
    renderCustomList();
    buildMarkerDom();
    applyLayoutToFields();
    positionFieldsFromLayout();
  }

  $('#btn-apply-fields').addEventListener('click', async () => {
    try {
      await applyFieldConfigFromUi();
    } catch (e) {
      alert(e.message);
    }
  });

  $('#btn-add-custom').addEventListener('click', () => {
    const labelIn = $('#custom-label');
    const keyIn = $('#custom-key');
    const label = (labelIn.value || '').trim();
    let key = (keyIn.value || '').trim();
    if (!label && !key) {
      alert('Preencha o nome do campo ou a coluna no CSV.');
      return;
    }
    if (!key) key = slugifyClient(label);
    else key = slugifyClient(key);
    if (!key || !/^[a-z]/.test(key)) {
      alert('A coluna no CSV deve começar com letra (a-z), sem espaços.');
      return;
    }
    if (RESERVED_CLIENT_KEYS.has(key)) {
      alert('Esse nome é reservado para um campo padrão. Use outro identificador.');
      return;
    }
    if (customFieldsLocal.some((c) => c.key === key)) {
      alert('Já existe um campo com essa coluna.');
      return;
    }
    if (customFieldsLocal.length >= 10) {
      alert('Limite de 10 campos personalizados.');
      return;
    }
    customFieldsLocal.push({ key, label: label || key });
    labelIn.value = '';
    keyIn.value = '';
    renderCustomList();
  });

  function applyLayoutToFields() {
    if (!layout) return;
    fieldOrder.forEach((key) => {
      const spec = layout[key];
      if (!spec) return;
      const range = document.getElementById(`font-${key}`);
      const weightEl = document.getElementById(`weight-${key}`);
      const hidden = document.getElementById(`family-${key}`);
      if (range) range.value = spec.fontSize;
      if (weightEl) {
        const w = Number(spec.fontWeight);
        weightEl.value = Number.isFinite(w)
          ? String(Math.min(900, Math.max(300, Math.round(w / 100) * 100)))
          : '400';
      }
      if (hidden) {
        hidden.value = FONT_CHOICES.includes(spec.fontFamily) ? spec.fontFamily : 'Segoe UI';
        const fd = document.getElementById(`field-${key}`);
        if (fd) syncFontPickerUi(fd);
      }
    });
  }

  function displayScaleMin() {
    const img = $('#editor-bg');
    const ir = img.getBoundingClientRect();
    if (!refWidth || !refHeight || ir.width < 1 || ir.height < 1) return 0;
    return Math.min(ir.width / refWidth, ir.height / refHeight);
  }

  function updateFieldPreviewFont(el) {
    const key = el.dataset.fieldKey;
    const m = displayScaleMin();
    const preview = el.querySelector('.field-preview-text');
    const sizeRange = key ? document.getElementById(`font-${key}`) : el.querySelector('input.field-size-range');
    const weightRange = key ? document.getElementById(`weight-${key}`) : el.querySelector('input.field-weight-range');
    const hidden = el.querySelector('input.field-font-value');
    if (!preview || !sizeRange || m <= 0) return;
    const size = Number(sizeRange.value);
    preview.style.fontSize = `${Math.max(8, Math.round(size * m))}px`;
    if (weightRange) preview.style.fontWeight = String(weightRange.value);
    if (hidden) {
      preview.style.fontFamily = fontFamilyCss(hidden.value);
    }
  }

  function positionFieldsFromLayout() {
    if (!layout || !refWidth) return;
    const img = $('#editor-bg');
    const rect = () => img.getBoundingClientRect();
    const scaleX = () => rect().width / refWidth;
    const scaleY = () => rect().height / refHeight;

    fieldOrder.forEach((key) => {
      const el = document.getElementById(`field-${key}`);
      const spec = layout[key];
      if (!el || !spec) return;
      const sx = scaleX();
      const sy = scaleY();
      el.style.left = `${spec.x * sx}px`;
      el.style.top = `${spec.y * sy}px`;
      const range = document.getElementById(`font-${key}`);
      const weightEl = document.getElementById(`weight-${key}`);
      if (range) range.value = spec.fontSize;
      if (weightEl) {
        const w = Number(spec.fontWeight);
        weightEl.value = Number.isFinite(w)
          ? String(Math.min(900, Math.max(300, Math.round(w / 100) * 100)))
          : '400';
      }
      const hidden = document.getElementById(`family-${key}`);
      if (hidden) {
        hidden.value = FONT_CHOICES.includes(spec.fontFamily) ? spec.fontFamily : 'Segoe UI';
        syncFontPickerUi(el);
      }
      updateFieldPreviewFont(el);
    });
  }

  new ResizeObserver(() => positionFieldsFromLayout()).observe(editorCanvas);

  function readLayoutFromDom() {
    if (!refWidth || !refHeight || !fieldOrder.length) return null;
    const img = $('#editor-bg');
    const ir = img.getBoundingClientRect();
    if (ir.width < 1 || ir.height < 1) return null;

    const sx = refWidth / ir.width;
    const sy = refHeight / ir.height;

    function readOne(key) {
      const el = document.getElementById(`field-${key}`);
      const range = document.getElementById(`font-${key}`);
      const weightEl = document.getElementById(`weight-${key}`);
      const hidden = document.getElementById(`family-${key}`);
      if (!el || !range || !hidden) {
        return {
          x: 0,
          y: 0,
          fontSize: 16,
          fontWeight: 400,
          align: 'center',
          fontFamily: 'Segoe UI',
        };
      }
      const preview = el.querySelector('.field-preview-text');
      const target = preview || el;
      const fr = target.getBoundingClientRect();
      const cx = (fr.left - ir.left + fr.width / 2) * sx;
      const cy = (fr.top - ir.top + fr.height / 2) * sy;
      const wv = weightEl ? Number(weightEl.value) : 400;
      return {
        x: cx,
        y: cy,
        fontSize: Number(range.value),
        fontWeight: Number.isFinite(wv) ? wv : 400,
        align: 'center',
        fontFamily: hidden.value || 'Segoe UI',
      };
    }

    const out = {};
    fieldOrder.forEach((key) => {
      out[key] = readOne(key);
    });
    return out;
  }

  function layoutLooksValid(l) {
    if (!l || !fieldOrder.length) return false;
    return fieldOrder.every((key) => {
      const f = l[key];
      return (
        f &&
        typeof f.x === 'number' &&
        typeof f.y === 'number' &&
        Number.isFinite(f.x) &&
        Number.isFinite(f.y)
      );
    });
  }

  async function saveLayout() {
    let payload = readLayoutFromDom();
    if (!payload) {
      if (layoutLooksValid(layout)) {
        payload = layout;
      } else {
        throw new Error(
          'Abra a etapa "Campos", aplique os campos e posicione os marcadores no modelo (ou use Continuar nessa etapa).',
        );
      }
    }
    const r = await fetchSession('/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = String(j.error || '');
      if (/modelo|certificado/i.test(msg)) {
        clearTemplateClientState();
        setStep(1);
        throw new Error(
          'O servidor não tem mais o arquivo do modelo (sessão nova ou reinício). Envie o certificado de novo no passo 1.',
        );
      }
      throw new Error(msg || 'Falha ao salvar layout');
    }
    layout = j.layout;
  }

  /** Grava no servidor posição/fonte dos marcadores que já estão na tela (evita perder edições ao marcar CPF etc.). */
  async function flushLayoutFromDomToServer() {
    if (!sessionId || !refWidth || !refHeight || !fieldOrder.length) return;
    const payload = readLayoutFromDom();
    if (!payload || !layoutLooksValid(payload)) return;
    try {
      const r = await fetchSession('/layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) return;
      layout = j.layout;
    } catch {
      /* segue o fluxo */
    }
  }

  function makeDraggable(el) {
    let startX, startY, origLeft, origTop;

    function start(clientX, clientY) {
      const style = getComputedStyle(el);
      origLeft = parseFloat(style.left) || 0;
      origTop = parseFloat(style.top) || 0;
      startX = clientX;
      startY = clientY;
    }

    function move(clientX, clientY) {
      const dx = clientX - startX;
      const dy = clientY - startY;
      el.style.left = `${origLeft + dx}px`;
      el.style.top = `${origTop + dy}px`;
    }

    el.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.field-hud')) return;
      if (ev.target.closest('.field-hud-toggle')) return;
      ev.preventDefault();
      start(ev.clientX, ev.clientY);
      const onMove = (e) => move(e.clientX, e.clientY);
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    el.addEventListener(
      'touchstart',
      (ev) => {
        if (ev.target.closest('.field-hud')) return;
        if (ev.target.closest('.field-hud-toggle')) return;
        const t = ev.touches[0];
        start(t.clientX, t.clientY);
        const onMove = (e) => {
          const tt = e.touches[0];
          move(tt.clientX, tt.clientY);
        };
        const onEnd = () => {
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onEnd);
        };
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
      },
      { passive: true },
    );
  }

  $('#btn-preview-pdf').addEventListener('click', async () => {
    try {
      await saveLayout();
      const r = await fetchSession('/preview-pdf', { method: 'POST' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Falha na prévia');
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(e.message);
    }
  });

  $('#btn-back-2').addEventListener('click', () => setStep(1));
  $('#btn-next-2').addEventListener('click', async () => {
    try {
      if (!fieldOrder.length) {
        alert('Clique em "Aplicar campos ao modelo" para escolher pelo menos o campo Nome.');
        return;
      }
      await saveLayout();
      setStep(3);
    } catch (e) {
      alert(e.message);
    }
  });

  // —— Etapa 3 —— CSV ——
  const inputCsv = $('#input-csv');
  const dropCsv = $('#drop-csv');
  const csvStatus = $('#csv-status');
  const btnNext3 = $('#btn-next-3');
  const previewWrap = $('#csv-preview-wrap');
  const previewTbody = $('#csv-preview-table tbody');

  async function uploadCsv(file) {
    if (!file) return;
    showStatus(csvStatus, 'Validando CSV…');
    btnNext3.disabled = true;
    csvOk = false;
    previewWrap.classList.add('hidden');
    try {
      await ensureSession();
      const r = await fetchSession('/csv', () => {
        const fd = new FormData();
        fd.append('csv', file);
        return { method: 'POST', body: fd };
      });
      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        showStatus(csvStatus, j.error || `Erro ao enviar CSV (${r.status}).`, 'error');
        return;
      }

      if (j.warnings && j.warnings.length) {
        j.warnings.forEach((w) => console.warn(w));
      }

      if (!j.ok) {
        const msg = Array.isArray(j.errors) && j.errors.length
          ? j.errors.join(' ')
          : (j.error || 'Não foi possível validar o CSV.');
        showStatus(csvStatus, msg, 'error');
        if (j.preview && j.preview.length) {
          refreshCsvThead();
          previewWrap.classList.remove('hidden');
          previewTbody.innerHTML = '';
          j.preview.forEach((row) => {
            const tr = document.createElement('tr');
            tr.innerHTML = csvPreviewRowHtml(row, true);
            previewTbody.appendChild(tr);
          });
        }
        return;
      }

      if (!Array.isArray(j.rows)) {
        showStatus(csvStatus, 'Resposta inválida do servidor.', 'error');
        return;
      }

      rowCount = j.rows.length;
      csvOk = true;
      let msg = `CSV válido: ${rowCount} participante(s).`;
      if (j.warnings && j.warnings.length) msg += ' ' + j.warnings.join(' ');
      showStatus(csvStatus, msg, 'ok');
      refreshCsvThead();
      previewWrap.classList.remove('hidden');
      previewTbody.innerHTML = '';
      j.rows.slice(0, 10).forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = csvPreviewRowHtml(row, false);
        previewTbody.appendChild(tr);
      });
      btnNext3.disabled = false;
      updateSummary();
    } catch (e) {
      showStatus(csvStatus, e.message, 'error');
    }
  }

  function normHeader(s) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .replace(/^\uFEFF/, '');
  }

  function csvPreviewColumns() {
    return fieldOrder.length ? fieldOrder : ['nome'];
  }

  function refreshCsvThead() {
    const theadRow = document.querySelector('#csv-preview-thead tr');
    if (!theadRow) return;
    theadRow.innerHTML = '';
    csvPreviewColumns().forEach((k) => {
      const th = document.createElement('th');
      th.textContent = k;
      theadRow.appendChild(th);
    });
  }

  function csvPreviewRowHtml(row, raw) {
    const keys = csvPreviewColumns();
    if (!raw) {
      return keys.map((k) => `<td>${escapeHtml(String(row[k] ?? ''))}</td>`).join('');
    }
    const map = {};
    Object.keys(row).forEach((k) => {
      map[normHeader(k)] = row[k];
    });
    return keys.map((k) => `<td>${escapeHtml(String(map[k] ?? ''))}</td>`).join('');
  }

  inputCsv.addEventListener('change', () => uploadCsv(inputCsv.files[0]));
  setupDrop(dropCsv, inputCsv, uploadCsv);
  $('#btn-back-3').addEventListener('click', () => setStep(2));
  $('#btn-next-3').addEventListener('click', () => setStep(4));

  function updateSummary() {
    $('#summary').innerHTML = `
      <p><strong>Participantes:</strong> ${csvOk ? rowCount : '—'}</p>
      <p><strong>Limite:</strong> até 300 certificados por geração.</p>
    `;
  }

  // —— Etapa 4 ——
  const progressBlock = $('#progress-block');
  const progressFill = $('#progress-fill');
  const progressText = $('#progress-text');
  const genStatus = $('#gen-status');
  const btnGenerate = $('#btn-generate');
  const btnDownload = $('#btn-download');

  $('#btn-back-4').addEventListener('click', () => setStep(3));

  btnGenerate.addEventListener('click', async () => {
    if (!csvOk) return;
    btnGenerate.disabled = true;
    btnDownload.classList.add('hidden');
    progressBlock.classList.remove('hidden');
    progressFill.style.width = '0%';
    showStatus(genStatus, 'Iniciando…');
    try {
      await saveLayout();
      const r = await fetchSession('/generate', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Falha ao iniciar');

      const es = new EventSource(`${API}/api/jobs/${j.jobId}/progress`);

      es.addEventListener('progress', (ev) => {
        const d = JSON.parse(ev.data);
        const pct = d.total ? Math.round((100 * d.current) / d.total) : 0;
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `${d.current} / ${d.total} certificados`;
      });

      es.addEventListener('complete', (ev) => {
        es.close();
        const d = JSON.parse(ev.data);
        showStatus(genStatus, 'Pronto! Faça o download do ZIP.', 'ok');
        btnDownload.href = `${API}${d.downloadUrl}`;
        btnDownload.classList.remove('hidden');
        btnGenerate.disabled = false;
      });

      es.addEventListener('fail', (ev) => {
        const d = JSON.parse(ev.data);
        showStatus(genStatus, d.message || 'Erro', 'error');
        es.close();
        btnGenerate.disabled = false;
      });

    } catch (e) {
      showStatus(genStatus, e.message, 'error');
      btnGenerate.disabled = false;
    }
  });

  updateSummary();
})();
