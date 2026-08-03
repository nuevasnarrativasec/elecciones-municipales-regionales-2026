/* ¿Sabes por quién votar? — filtros funcionales conectados al Excel (JSON) */
(() => {
  'use strict';

  const SLUG = {
    'GOBERNADOR REGIONAL': 'gobernador',
    'ALCALDE PROVINCIAL': 'alcalde_prov',
    'ALCALDE DISTRITAL': 'alcalde_dist'
  };
  const PAGE = 40;
  // Base de las fotos de candidatos/regidores (debe terminar en '/').
  //  - Desarrollo local:  'assets/fotos/'
  //  - Producción: Backblaze B2 servido por un Cloudflare Worker (gratis, sin dominio).
  //      Reemplaza TU-SUBDOMINIO por el subdominio de tu cuenta de Workers.
  //      Guía completa: deploy/README-cdn-fotos-b2.md
  const FOTOS = 'https://elecciones-fotos.nuevasnarrativas-ec.workers.dev/fotos/';
  // const FOTOS = 'assets/fotos/'; // <- descomenta esta para desarrollo local
  const LOGOS = 'assets/logos/';
  // slug estable del partido para el nombre de archivo del logo (ej. "Avanza País" -> "avanza_pais")
  const slugOrg = s => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  const el = {
    cargoGroup: document.getElementById('cargoGroup'),
    region: document.getElementById('selRegion'),
    prov: document.getElementById('selProv'),
    dist: document.getElementById('selDist'),
    wrapProv: document.getElementById('wrapProv'),
    wrapDist: document.getElementById('wrapDist'),
    org: document.getElementById('selOrg'),
    name: document.getElementById('txtName'),
    list: document.getElementById('candList'),
    count: document.getElementById('resultCount'),
    loadWrap: document.getElementById('loadMoreWrap'),
    loadMore: document.getElementById('loadMore'),
    modal: document.getElementById('modal'),
    ficha: document.getElementById('fichaCard')
  };

  let INDEX = null;          // index.json
  let cache = {};            // slug -> candidatos[]
  let current = [];          // candidatos del cargo activo
  let filtered = [];         // resultado filtrado
  let shown = 0;

  const norm = s => (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, "");
  const cap = s => (s || '').toLowerCase().replace(/(^|\s|\/)\p{L}/gu, m => m.toUpperCase());
  const val = (v, dash = 'No especifica') => (v === '' || v == null) ? dash : v;

  async function loadJSON(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error('No se pudo cargar ' + path);
    return r.json();
  }

  function getCargo() {
    const c = el.cargoGroup.querySelector('input[name="cargo"]:checked');
    return c ? c.value : 'GOBERNADOR REGIONAL';
  }

  // ---- Poblar dropdowns según cargo ----
  function fillSelect(sel, items, placeholder) {
    sel.innerHTML = '<option value="">' + placeholder + '</option>' +
      items.map(v => `<option value="${escAttr(v)}">${cap(v)}</option>`).join('');
  }
  const escAttr = s => (s || '').replace(/"/g, '&quot;');

  function refreshForCargo() {
    const cargo = getCargo();
    const ci = INDEX[cargo];
    // Región
    fillSelect(el.region, Object.keys(ci.deps).sort(), 'Región');
    // Partido
    fillSelect(el.org, ci.orgs, 'Partido');
    // reset provincia/distrito
    el.prov.innerHTML = '<option value="">Provincia</option>';
    el.dist.innerHTML = '<option value="">Distrito</option>';
    el.prov.disabled = true; el.dist.disabled = true;
    // visibilidad de niveles según cargo
    const showProv = cargo !== 'GOBERNADOR REGIONAL';
    const showDist = cargo === 'ALCALDE DISTRITAL';
    el.wrapProv.style.display = showProv ? '' : 'none';
    el.wrapDist.style.display = showDist ? '' : 'none';
  }

  function onRegionChange() {
    const cargo = getCargo();
    const dep = el.region.value;
    el.prov.innerHTML = '<option value="">Provincia</option>';
    el.dist.innerHTML = '<option value="">Distrito</option>';
    el.dist.disabled = true;
    if (dep && INDEX[cargo].deps[dep]) {
      const provs = Object.keys(INDEX[cargo].deps[dep]).sort();
      fillSelect(el.prov, provs, 'Provincia');
      el.prov.disabled = false;
    } else {
      el.prov.disabled = true;
    }
  }

  function onProvChange() {
    const cargo = getCargo();
    const dep = el.region.value, prov = el.prov.value;
    el.dist.innerHTML = '<option value="">Distrito</option>';
    if (dep && prov && INDEX[cargo].deps[dep] && INDEX[cargo].deps[dep][prov]) {
      fillSelect(el.dist, INDEX[cargo].deps[dep][prov], 'Distrito');
      el.dist.disabled = false;
    } else {
      el.dist.disabled = true;
    }
  }

  // Partidos disponibles en la jurisdicción seleccionada (deriva de los candidatos
  // ya cargados). Sin jurisdicción, muestra la lista completa del cargo.
  function refreshOrgs(dep, prov, dist) {
    let orgs;
    if (dep || prov || dist) {
      const set = new Set();
      for (const c of current) {
        if (dep && c.dep !== dep) continue;
        if (prov && c.prov !== prov) continue;
        if (dist && c.dist !== dist) continue;
        set.add(c.org);
      }
      orgs = [...set].sort((a, b) => a.localeCompare(b, 'es'));
    } else {
      orgs = INDEX[getCargo()].orgs;
    }
    const prev = el.org.value;
    fillSelect(el.org, orgs, 'Partido');
    el.org.value = orgs.includes(prev) ? prev : '';
  }

  // ---- Aplicar filtros ----
  async function applyFilters() {
    const cargo = getCargo();
    const slug = SLUG[cargo];
    el.count.textContent = 'Cargando…';
    if (!cache[slug]) {
      try { cache[slug] = await loadJSON(`assets/data/cand_${slug}.json`); }
      catch (e) { el.count.textContent = 'Error al cargar los datos.'; return; }
    }
    current = cache[slug];

    const dep = el.region.value;
    const prov = el.prov.value;
    const dist = el.dist.value;
    refreshOrgs(dep, prov, dist);
    const org = el.org.value;
    const q = norm(el.name.value.trim());

    filtered = current.filter(c => {
      if (dep && c.dep !== dep) return false;
      if (prov && c.prov !== prov) return false;
      if (dist && c.dist !== dist) return false;
      if (org && c.org !== org) return false;
      if (q && !norm(c.nom).includes(q)) return false;
      return true;
    });

    shown = 0;
    el.list.innerHTML = '';
    renderMore();
    el.count.textContent = `${filtered.length.toLocaleString('es-PE')} candidato${filtered.length === 1 ? '' : 's'} · ${cap(cargo)}`;
  }

  function renderMore() {
    if (!filtered.length) {
      el.list.innerHTML = '<li class="empty">No se encontraron candidatos con estos filtros.</li>';
      el.loadWrap.hidden = true;
      return;
    }
    const slice = filtered.slice(shown, shown + PAGE);
    const html = slice.map(c => cardHTML(c)).join('');
    el.list.insertAdjacentHTML('beforeend', html);
    shown += slice.length;
    el.loadWrap.hidden = shown >= filtered.length;
  }

  function initials(name) {
    const p = (name || '').trim().split(/\s+/);
    return ((p[0] || '')[0] || '') + ((p[p.length - 1] || '')[0] || '');
  }

  function cardHTML(c) {
    const loc = [cap(c.dist), cap(c.prov), cap(c.dep)].filter(Boolean).join(', ');
    return `<li><button class="candcard" data-id="${c.id}">
      <span class="candcard__avatar"><span class="ini">${initials(c.nom).toUpperCase()}</span><img src="${FOTOS}${c.dni}.jpg" alt="" loading="lazy" onerror="this.remove()"></span>
      <span class="candcard__body">
        <span class="candcard__name">${cap(c.nom)}</span>
        <span class="candcard__meta">${cap(c.org)}</span>
        <span class="candcard__loc">${loc}</span>
      </span></button></li>`;
  }

  // ---- Ficha ----
  function money(v) {
    if (v === '' || v == null || v === 0) return null;
    const n = Number(v);
    if (isNaN(n)) return v;
    return 'S/ ' + n.toLocaleString('es-PE');
  }

  // celda etiqueta + valor
  function cell(label, value, dash) {
    const empty = value === '' || value == null;
    return `<div class="fx__cell"><div class="lbl">${label}</div>` +
      `<div class="v${empty ? ' dash' : ''}">${empty ? (dash || 'No especifica') : value}</div></div>`;
  }
  const yn = b => b ? 'Sí' : 'No';

  // sentence-case para texto legal en mayúsculas
  const sc = s => {
    s = (s || '').toString().trim().toLowerCase();
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  // "TÍTULO | Fallo: X | Modalidad: Y || OTRA | Fallo: Z" -> lista estructurada
  function parseSentencias(raw) {
    if (!raw) return [];
    return raw.split('||').map(s => s.trim()).filter(Boolean).map(block => {
      const parts = block.split('|').map(p => p.trim()).filter(Boolean);
      const titulo = parts.length ? parts[0] : '';
      const campos = parts.slice(1).map(p => {
        const i = p.indexOf(':');
        return i > -1 ? { k: p.slice(0, i).trim(), v: p.slice(i + 1).trim() } : { k: '', v: p };
      });
      return { titulo, campos };
    });
  }

  function sentBlock(title, has, raw) {
    const items = has ? parseSentencias(raw) : [];
    if (!items.length) {
      return `<div class="fx__subhead">${title}</div><div class="fx__nosent">No registra</div>`;
    }
    const lis = items.map((s, i) => {
      const campos = s.campos.map(f => f.k
        ? `<div class="sf"><b>${sc(f.k)}:</b> ${sc(f.v)}</div>`
        : `<div class="sf">${sc(f.v)}</div>`).join('');
      return `<li><div class="st">${i + 1}. ${sc(s.titulo)}</div>${campos}</li>`;
    }).join('');
    return `<div class="fx__subhead">${title} · ${items.length}</div><ul class="fx__sent">${lis}</ul>`;
  }

  // "Alcalde distrital San Miguel, Lima." según el cargo
  function postulaTxt(c) {
    const cargo = cap(c.cargo);
    let lugar = '';
    if (c.cargo === 'GOBERNADOR REGIONAL') lugar = cap(c.dep);
    else if (c.cargo === 'ALCALDE PROVINCIAL') lugar = `${cap(c.prov)}, ${cap(c.dep)}`;
    else lugar = `${cap(c.dist)}, ${cap(c.dep)}`;
    return { cargo, lugar };
  }

  // Formación académica: muestra únicamente el grado más alto completado
  // declarado por el candidato (posgrado > universitaria > técnica >
  // secundaria > primaria). Los niveles inferiores no se muestran.
  function formacionHTML(c) {
    const posg = (c.posg || '').toString().trim();
    let nivel, cells;
    if (posg) {
      nivel = 'Posgrado';
      cells = [
        cell('Profesión declarada', cap(c.prof), 'No declara'),
        cell('Posgrado declarado', cap(c.posg), 'No declara'),
        cell('Institución de posgrado', cap(c.instp))
      ];
    } else if (c.univ) {
      nivel = 'Educación superior universitaria';
      cells = [
        cell('Profesión declarada', cap(c.prof), 'No declara'),
        cell('Institución educativa', cap(c.inst))
      ];
    } else if (c.tecn) {
      nivel = 'Educación superior técnica';
      cells = [
        cell('Profesión declarada', cap(c.prof), 'No declara'),
        cell('Institución educativa', cap(c.inst))
      ];
    } else if (c.secu) {
      nivel = 'Educación secundaria completa';
      cells = [
        cell('Estudios primarios', yn(c.prim)),
        cell('Estudios secundarios', yn(c.secu))
      ];
    } else if (c.prim) {
      nivel = 'Educación primaria completa';
      cells = [
        cell('Estudios primarios', yn(c.prim)),
        cell('Estudios secundarios', yn(c.secu))
      ];
    } else {
      nivel = 'No especifica';
      cells = [];
    }
    const grid = cells.length ? `<div class="fx__grid2">${cells.join('')}</div>` : '';
    return `<div class="fx__bar">Formación académica</div>
        <div class="fx__subhead">${nivel}</div>
        ${grid}`;
  }

  function fichaHTML(c) {
    const p = postulaTxt(c);
    const edad = c.edad ? `${c.edad} años` : 'Edad no declarada';

    const inmV = c.ninm ? money(c.vinm) : '';
    const mueV = c.nmue ? money(c.vmue) : '';

    const pdfBtn = `<span class="fx__pdf is-disabled" title="No disponible en esta versión">
        <svg width="20" height="24" viewBox="0 0 20 24" fill="none" stroke="#555" stroke-width="1.5">
          <path d="M3 1h9l5 5v17H3z"/><path d="M12 1v5h5"/><path d="M10 11v7M7 15l3 3 3-3"/></svg>
        <span>Descargar hoja<br>de vida original<br>en PDF</span></span>`;

    return `
      <button class="ficha__close" data-close aria-label="Cerrar">&times;</button>
      <div class="fx">

        <div class="fx__top">
          <div class="fx__idcol">
            <div class="fx__name">${cap(c.nom)}</div>
            <div class="fx__age">${edad}</div>
            <div class="fx__party">${cap(c.org)}</div>
          </div>
          <div class="fx__photowrap">
            <div class="fx__photo"><span class="ini">${initials(c.nom).toUpperCase()}</span><img src="${FOTOS}${c.dni}.jpg" alt="${cap(c.nom)}" loading="lazy" onerror="this.remove()"></div>
            <img class="fx__plogo" src="${LOGOS}${slugOrg(c.org)}.png" alt="" onerror="this.remove()">
          </div>
          <div class="fx__rcol">
            <div class="fx__postula"><span class="lbl">Postula:</span><br>${p.cargo}<br>${p.lugar}.</div>
            <div class="fx__pdfwrap">
              <div class="lbl">Transparencia:</div>
              ${pdfBtn}
            </div>
          </div>
        </div>

        ${formacionHTML(c)}

        <div class="fx__bar">Experiencia laboral</div>
        <div class="fx__grid2">
          ${cell('Ocupación', cap(c.ocup))}
          ${cell('Centro de trabajo', cap(c.ct))}
        </div>

        <div class="fx__mid">
          <div class="fx__midcol">
            <div class="fx__bar">Trayectoria política</div>
            <div class="fx__grid2" style="grid-template-columns:1fr">
              ${cell('Tiene cargos de elección popular', yn(c.tce))}
              ${cell('Cargos de elección popular', c.tce ? cap(c.cep) : '', 'No registra')}
              ${cell('Tiene cargos partidarios', yn(c.tcp))}
              ${cell('Cargo partidario', c.tcp ? cap(c.cp) : '', 'No registra')}
            </div>
          </div>
          <div class="fx__midcol">
            <div class="fx__bar">Patrimonio</div>
            <div class="fx__grid2" style="grid-template-columns:1fr">
              ${cell('Bienes inmuebles', yn(!!c.ninm))}
              ${cell('Valor total declarado de inmuebles', inmV, '—')}
              ${cell('Bienes muebles', yn(!!c.nmue))}
              ${cell('Valor total declarado de bienes muebles', mueV, '—')}
              ${cell('Tiene acciones o participaciones', yn(c.tacc))}
            </div>
          </div>
        </div>

        <div class="fx__income">
          <div class="fx__bar">Ingresos</div>
          <div class="fx__grid2">
            <div class="fx__cell">
              <div class="lbl">Ingresos declarados (último año)</div>
              <div class="big">${c.ting ? (money(c.ing) || 'No declara') : 'No declara'}</div>
            </div>
            <div class="fx__cell">
              <div class="lbl">Año de la declaración</div>
              <div class="big">${val(c.anio, '—')}</div>
            </div>
          </div>
        </div>

        <div class="fx__bar">Sentencias</div>
        <div class="fx__grid2">
          ${cell('Tiene sentencias penales declaradas', yn(c.tsp))}
          ${cell('Tiene sentencias civiles declaradas', yn(c.tsc))}
        </div>
        <div class="fx__sentcols">
          <div>${sentBlock('Sentencias penales declaradas', c.tsp, c.sp)}</div>
          <div>${sentBlock('Sentencias civiles declaradas', c.tsc, c.sc)}</div>
        </div>

        <div class="fx__fuente">
          <b>Fuente:</b><br>
          Declaración Jurada de Hoja de Vida presentada ante el Jurado Nacional de Elecciones (JNE).
        </div>
      </div>`;
  }

  function showFicha(c) {
    if (!c) return;
    el.ficha.innerHTML = fichaHTML(c);
    el.modal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function openFicha(id) {
    showFicha(current.find(x => x.id === +id));
  }
  function closeFicha() {
    el.modal.hidden = true;
    document.body.style.overflow = '';
  }

  // ---- Eventos ----
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  el.cargoGroup.addEventListener('change', () => { refreshForCargo(); applyFilters(); });
  el.region.addEventListener('change', () => { onRegionChange(); applyFilters(); });
  el.prov.addEventListener('change', () => { onProvChange(); applyFilters(); });
  el.dist.addEventListener('change', applyFilters);
  el.org.addEventListener('change', applyFilters);
  el.name.addEventListener('input', debounce(applyFilters, 220));
  el.loadMore.addEventListener('click', renderMore);

  el.list.addEventListener('click', e => {
    const b = e.target.closest('.candcard');
    if (b) openFicha(b.dataset.id);
  });
  el.modal.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) closeFicha(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.modal.hidden) closeFicha(); });

  /* =======================================================================
     REGIDORES — buscador de quienes acompañan a cada candidato.
     Nivel según jurisdicción: solo Región -> consejeros regionales (acompañan
     al gobernador); + Provincia -> regidores provinciales (alcalde provincial);
     + Distrito -> regidores distritales (alcalde distrital).
     ======================================================================= */
  const rg = {
    region: document.getElementById('rgRegion'),
    prov: document.getElementById('rgProv'),
    dist: document.getElementById('rgDist'),
    wrapProv: document.getElementById('rgWrapProv'),
    wrapDist: document.getElementById('rgWrapDist'),
    org: document.getElementById('rgOrg'),
    cand: document.getElementById('rgCand'),
    name: document.getElementById('rgName'),
    list: document.getElementById('rgList'),
    count: document.getElementById('rgCount'),
    loadWrap: document.getElementById('rgLoadWrap'),
    loadMore: document.getElementById('rgLoadMore')
  };

  const REG_HEAD = { cons: 'gobernador', prov: 'alcalde_prov', dist: 'alcalde_dist' };
  const REG_NOUN = {
    cons: ['consejero regional', 'consejeros regionales'],
    prov: ['regidor provincial', 'regidores provinciales'],
    dist: ['regidor distrital', 'regidores distritales']
  };
  let REG_INDEX = null;
  let regCache = {};        // depSlug -> regidores[]
  let regData = [];         // regidores del departamento activo
  let regHeads = [];        // candidatos cabeza de lista en la jurisdicción
  let regFiltered = [];
  let regShown = 0;

  function regLevel() {
    if (rg.dist.value) return 'dist';
    if (rg.prov.value) return 'prov';
    if (rg.region.value) return 'cons';
    return null;
  }

  function onRgRegion() {
    const dep = rg.region.value;
    rg.prov.innerHTML = '<option value="">Provincia</option>';
    rg.dist.innerHTML = '<option value="">Distrito</option>';
    rg.dist.disabled = true;
    if (dep && REG_INDEX.deps[dep]) {
      fillSelect(rg.prov, Object.keys(REG_INDEX.deps[dep].provs).sort(), 'Provincia');
      rg.prov.disabled = false;
    } else {
      rg.prov.disabled = true;
    }
    regApply();
  }

  function onRgProv() {
    const dep = rg.region.value, prov = rg.prov.value;
    rg.dist.innerHTML = '<option value="">Distrito</option>';
    const provs = dep ? REG_INDEX.deps[dep].provs : null;
    if (prov && provs && provs[prov]) {
      fillSelect(rg.dist, provs[prov], 'Distrito');
      rg.dist.disabled = false;
    } else {
      rg.dist.disabled = true;
    }
    regApply();
  }

  // Candidatos cabeza de lista dentro de la jurisdicción/nivel activos
  function regHeadsInScope(lvl) {
    const dep = rg.region.value, prov = rg.prov.value, dist = rg.dist.value;
    return regHeads.filter(c => {
      if (c.dep !== dep) return false;
      if (lvl !== 'cons' && c.prov !== prov) return false;
      if (lvl === 'dist' && c.dist !== dist) return false;
      return true;
    });
  }

  // Rellena Partido y Candidato preservando la selección si sigue siendo válida
  function fillRgHeadSelects(lvl) {
    const heads = regHeadsInScope(lvl);
    const orgs = [...new Set(heads.map(c => c.org))].sort((a, b) => a.localeCompare(b, 'es'));
    const prevOrg = rg.org.value;
    fillSelect(rg.org, orgs, 'Partido');
    rg.org.value = orgs.includes(prevOrg) ? prevOrg : '';
    rg.org.disabled = !orgs.length;

    const org = rg.org.value;
    const cands = heads
      .filter(c => !org || c.org === org)
      .sort((a, b) => cap(a.nom).localeCompare(cap(b.nom), 'es'));
    const prevCand = rg.cand.value;
    rg.cand.innerHTML = '<option value="">Candidato</option>' +
      cands.map(c => `<option value="${escAttr(c.org)}">${cap(c.nom)} · ${cap(c.org)}</option>`).join('');
    // Si el candidato previo sigue siendo válido, se conserva. Si hay un partido
    // elegido y candidatos disponibles, se autoselecciona el candidato para que
    // el usuario no tenga que elegirlo manualmente.
    if (cands.some(c => c.org === prevCand)) {
      rg.cand.value = prevCand;
    } else if (org && cands.length) {
      rg.cand.value = cands[0].org;
    } else {
      rg.cand.value = '';
    }
    rg.cand.disabled = !cands.length;
  }

  async function regApply() {
    const lvl = regLevel();
    rg.wrapProv.style.display = '';
    rg.wrapDist.style.display = '';

    if (!lvl) {
      rg.org.innerHTML = '<option value="">Partido</option>'; rg.org.disabled = true;
      rg.cand.innerHTML = '<option value="">Candidato</option>'; rg.cand.disabled = true;
      regFiltered = []; regShown = 0; rg.list.innerHTML = '';
      rg.loadWrap.hidden = true;
      rg.count.textContent = 'Elige una región para empezar.';
      return;
    }

    rg.count.textContent = 'Cargando…';

    // Cargar regidores del departamento y candidatos cabeza de lista del nivel
    const depSlug = REG_INDEX.deps[rg.region.value].slug;
    const headSlug = REG_HEAD[lvl];
    try {
      if (!regCache[depSlug]) regCache[depSlug] = await loadJSON(`assets/data/reg/${depSlug}.json`);
      if (!cache[headSlug]) cache[headSlug] = await loadJSON(`assets/data/cand_${headSlug}.json`);
    } catch (e) {
      rg.count.textContent = 'Error al cargar los datos.'; return;
    }
    regData = regCache[depSlug];
    regHeads = cache[headSlug];

    fillRgHeadSelects(lvl);

    const prov = rg.prov.value, dist = rg.dist.value;
    const org = rg.cand.value || rg.org.value;   // candidato define su partido
    const q = norm(rg.name.value.trim());

    regFiltered = regData.filter(r => {
      if (r.lvl !== lvl) return false;
      if (lvl !== 'cons' && r.prov !== prov) return false;
      if (lvl === 'dist' && r.dist !== dist) return false;
      if (org && r.org !== org) return false;
      if (q && !norm(r.nom).includes(q)) return false;
      return true;
    });

    regShown = 0;
    rg.list.innerHTML = '';
    regRenderMore();
    const noun = REG_NOUN[lvl][regFiltered.length === 1 ? 0 : 1];
    rg.count.textContent = `${regFiltered.length.toLocaleString('es-PE')} ${noun}`;
  }

  function regRenderMore() {
    if (!regFiltered.length) {
      rg.list.innerHTML = '<li class="empty">No se encontraron regidores con estos filtros.</li>';
      rg.loadWrap.hidden = true;
      return;
    }
    const slice = regFiltered.slice(regShown, regShown + PAGE);
    rg.list.insertAdjacentHTML('beforeend', slice.map(c => cardHTML(c)).join(''));
    regShown += slice.length;
    rg.loadWrap.hidden = regShown >= regFiltered.length;
  }

  rg.region.addEventListener('change', onRgRegion);
  rg.prov.addEventListener('change', onRgProv);
  rg.dist.addEventListener('change', regApply);
  rg.org.addEventListener('change', regApply);
  rg.cand.addEventListener('change', regApply);
  rg.name.addEventListener('input', debounce(regApply, 220));
  rg.loadMore.addEventListener('click', regRenderMore);
  rg.list.addEventListener('click', e => {
    const b = e.target.closest('.candcard');
    if (b) showFicha(regData.find(x => x.id === +b.dataset.id));
  });

  // ---- Init ----
  (async function init() {
    try {
      INDEX = await loadJSON('assets/data/index.json');
      refreshForCargo();
      await applyFilters();
      REG_INDEX = await loadJSON('assets/data/reg_index.json');
      fillSelect(rg.region, Object.keys(REG_INDEX.deps).sort(), 'Región');
      rg.count.textContent = 'Elige una región para empezar.';
    } catch (e) {
      el.count.textContent = 'No se pudieron cargar los datos. Sirve el sitio por HTTP (localhost).';
      console.error(e);
    }
  })();
})();
