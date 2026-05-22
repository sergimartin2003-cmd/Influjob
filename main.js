(function () {
  "use strict";

  const data    = window.__BRAND__ || {};
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fineHover = matchMedia("(hover: hover) and (pointer: fine)").matches;

  const $  = (sel, scope) => (scope || document).querySelector(sel);
  const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));
  const escHTML = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Normalize: lowercase + strip accents so "telefonica" matches "Telefónica"
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  /* ─────────────────────────────────────────
     SUPABASE CONFIG
  ───────────────────────────────────────── */
  const SB_URL = (data.supabase && data.supabase.url) || "";
  const SB_KEY = (data.supabase && data.supabase.key) || "";

  function sbHeaders(extra) {
    return Object.assign({
      "apikey": SB_KEY,
      "Authorization": "Bearer " + SB_KEY,
      "Content-Type": "application/json"
    }, extra || {});
  }

  function sbGet(path) {
    if (!SB_URL || !SB_KEY) return Promise.resolve(null);
    return fetch(SB_URL + "/rest/v1/" + path, { headers: sbHeaders() })
      .then(function(r) { return r.ok ? r.json() : null; })
      .catch(function() { return null; });
  }

  function sbPost(path, body) {
    if (!SB_URL || !SB_KEY) return Promise.resolve(false);
    return fetch(SB_URL + "/rest/v1/" + path, {
      method: "POST",
      headers: sbHeaders({ "Prefer": "return=minimal" }),
      body: JSON.stringify(body)
    })
    .then(function(r) { return r.ok; })
    .catch(function() { return false; });
  }

  /* ─────────────────────────────────────────
     JOB CARD BUILDER
  ───────────────────────────────────────── */
  const SECTOR_OFICIO = {
    "Tecnología e informática": "informática",
    "Atención al cliente": "atención al cliente",
    "Administración y oficina": "administrativo",
    "Logística y transporte": "almacén",
    "Sanidad y servicios sociales": "auxiliar sanitario",
    "Educación y formación": "educación",
    "Comercio y ventas": "dependiente",
    "Hostelería y turismo": "hostelería",
    "Industria y manufactura": "mantenimiento",
    "Comunicación y marketing": "marketing",
    "Recursos humanos": "recursos humanos",
    "Finanzas y banca": "contabilidad"
  };
  const DISA_ICONS = {
    "física": "♿", "visual": "👁", "auditiva": "👂",
    "intelectual": "🧠", "múltiple": "★", "tea": "🧩",
    "psicosocial": "💙", "orgánica": "❤"
  };
  const PALETTE = ["#1a3a6b","#2a5298","#0066cc","#004a97","#2ecc71",
                   "#27ae60","#e74c3c","#9b59b6","#f39c12","#16a085"];

  function companyColor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return PALETTE[h % PALETTE.length];
  }
  function getInitials(name) {
    return (name || "??").split(/\s+/).slice(0, 2).map(function(w) { return w[0] || ""; }).join("").toUpperCase() || "??";
  }
  function formatJobDate(iso) {
    try { return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }); }
    catch(e) { return ""; }
  }

  function guessSector(title, desc) {
    var t = ((title || "") + " " + (desc || "")).toLowerCase();
    if (/inform|programad|develop|software|\bit\b|soporte.ti|datos|digital|web|tech/.test(t)) return "tecnología";
    if (/admin|secretar|ofici|recepcion|contab|factur|auxiliar.admin/.test(t)) return "administración";
    if (/limpiez|operario|almac[eé]n|log[ií]stic|transport|conductor|mensajer/.test(t)) return "logística";
    if (/atenci[oó]n.al.cliente|call.center|teleoper|atencion.cliente/.test(t)) return "atención al cliente";
    if (/hotel|restaur|hostel|camarero|cocinero|cocina|recepci[oó]n.hotel/.test(t)) return "hostelería";
    if (/marketing|comunicaci[oó]n|community|redact|periodis|prensa/.test(t)) return "comunicación";
    return "";
  }

  function adaptSbJob(j) {
    var tipos = j.discapacidad_tipos
      ? j.discapacidad_tipos.split(",").map(function(s) { return s.trim().toLowerCase(); })
      : [];
    return {
      id:           String(j.id),
      title:        j.puesto        || "",
      company:      j.empresa       || "",
      initials:     getInitials(j.empresa),
      color:        companyColor(j.empresa || ""),
      city:         j.ciudad        || "",
      modality:     (j.modalidad    || "").toLowerCase(),
      contract:     j.tipo_contrato || "",
      oficio:       SECTOR_OFICIO[j.sector] || guessSector(j.puesto, j.descripcion),
      salary:       j.salario       || "",
      disabilities: tipos,
      description:  j.descripcion   || "",
      requirements: (j.requisitos   || "").split("\n").map(function(s){return s.trim();}).filter(Boolean),
      benefits:     (j.beneficios   || "").split("\n").map(function(s){return s.trim();}).filter(Boolean),
      source_url:     j.source_url    || "",
      date:           j.created_at ? j.created_at.substring(0, 10) : "",
      email_contacto: j.email_contacto || ""
    };
  }

  var SVG_PIN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';

  function buildCardHTML(job) {
    var mod      = job.modality.toLowerCase();
    var modClass = mod === "híbrido" ? "hibrido" : mod;
    var modLabel = mod.charAt(0).toUpperCase() + mod.slice(1);
    var dateStr  = job.date ? formatJobDate(job.date) : "";
    var disaList = job.disabilities || [];
    var disaBadges = disaList.length
      ? disaList.map(function(d) { return '<span class="disability-badge" title="Discapacidad ' + d + '">' + (DISA_ICONS[d] || "●") + "</span>"; }).join("")
      : '<span class="disability-badge disability-badge--generic" title="Oferta para personas con discapacidad">♿</span>';

    return '<article class="job-card reveal" role="listitem"' +
      ' data-job-id="'       + escHTML(job.id)       + '"' +
      ' data-city="'         + escHTML(norm(job.city))+ '"' +
      ' data-modality="'     + escHTML(job.modality)  + '"' +
      ' data-contract="'     + escHTML(job.contract)  + '"' +
      ' data-oficio="'       + escHTML(job.oficio)    + '"' +
      ' data-disabilities="' + escHTML((job.disabilities||[]).join(" ")) + '">' +
      '<div class="job-card-top">' +
        '<div class="job-logo" aria-hidden="true" style="--logo-color:' + job.color + '">' + escHTML(job.initials) + '</div>' +
        '<div class="job-meta-top">' +
          '<span class="job-modality job-modality--' + modClass + '">' + modLabel + '</span>' +
          (dateStr ? '<span class="job-date"><time datetime="' + job.date + '">' + dateStr + '</time></span>' : '') +
        '</div>' +
      '</div>' +
      '<h3 class="job-title">' + escHTML(job.title) + '</h3>' +
      '<p class="job-company">' + escHTML(job.company) + '</p>' +
      '<div class="job-info">' +
        '<span class="job-city">' + SVG_PIN + ' ' + escHTML(job.city) + '</span>' +
        '<span class="job-contract">' + escHTML(job.contract) + '</span>' +
        '<span class="job-salary">' + escHTML(job.salary || "A negociar") + '</span>' +
      '</div>' +
      '<div class="job-disabilities" aria-label="Compatible con discapacidad">' + disaBadges + '</div>' +
      '<div class="job-actions">' +
        '<button type="button" class="btn btn-detail" data-open-modal="' + escHTML(job.id) + '" aria-label="Ver detalles de ' + escHTML(job.title) + ' en ' + escHTML(job.company) + '">Ver detalles</button>' +
        '<button type="button" class="btn btn-apply"  data-open-modal="' + escHTML(job.id) + '" aria-label="Enviar currículum para ' + escHTML(job.title) + '">Enviar CV</button>' +
      '</div>' +
      '</article>';
  }

  // Shared filter state — set by hero search form, consumed by applyFilters
  let activeCity = "";
  let activeText = "";

  // Pagination — currentShownCount persists across auto-refreshes so jobs don't "disappear"
  const CARDS_PER_PAGE = 12;
  let totalMatches = 0;
  let currentShownCount = CARDS_PER_PAGE;

  // resetPage=true when the user changes a filter; false on auto-refresh (preserves shown count)
  function applyFilters(resetPage) {
    if (resetPage) currentShownCount = CARDS_PER_PAGE;

    const cards       = $$(".job-card");
    const selModality   = $("#filter-modality");
    const selContract   = $("#filter-contract");
    const selOficio     = $("#filter-oficio");
    const selDisability = $("#filter-disability");
    const counter       = $("[data-results-count]");

    const mod  = norm(selModality   ? selModality.value   : "");
    const con  = norm(selContract   ? selContract.value   : "");
    const ofi  = norm(selOficio     ? selOficio.value     : "");
    const dis  = norm(selDisability ? selDisability.value : "");
    const city = norm(activeCity);
    const text = norm(activeText);

    const matchingCards = [];
    cards.forEach(card => {
      const cm  = norm(card.dataset.modality     || "");
      const cc  = norm(card.dataset.contract     || "");
      const co  = norm(card.dataset.oficio       || "");
      const cd  = norm(card.dataset.disabilities || "");
      const cit = norm(card.dataset.city         || "");
      const title   = norm(card.querySelector(".job-title")?.textContent   || "");
      const company = norm(card.querySelector(".job-company")?.textContent || "");

      const match =
        (!mod  || cm.includes(mod))          &&
        (!con  || cc.includes(con))          &&
        (!ofi  || !co || co.includes(ofi))   &&
        (!dis  || !cd || cd.includes(dis))   &&
        (!city || cit.includes(city))        &&
        (!text || title.includes(text) || company.includes(text));

      card.classList.toggle("is-hidden", !match);
      if (match) matchingCards.push(card);
    });

    totalMatches = matchingCards.length;

    // Pagination — use currentShownCount so auto-refresh doesn't collapse what the user expanded
    matchingCards.forEach((card, i) => {
      const paginated = i >= currentShownCount;
      card.classList.toggle("is-paginated", paginated);
      card.setAttribute("aria-hidden", paginated ? "true" : "false");
    });
    cards.forEach(card => {
      if (card.classList.contains("is-hidden")) card.setAttribute("aria-hidden", "true");
    });

    const visibleNow = Math.min(totalMatches, currentShownCount);
    if (counter) counter.textContent = String(totalMatches);

    const emptyEl  = $("#jobs-empty");
    const loadMore = $("#jobs-load-more");
    if (emptyEl)  emptyEl.hidden  = totalMatches > 0;
    if (loadMore) {
      loadMore.hidden = totalMatches <= currentShownCount;
      const hint = $(".jobs-load-hint");
      if (hint) hint.textContent = `Mostrando ${visibleNow} de ${totalMatches} ofertas`;
    }

    // Mostrar "Limpiar filtros" solo cuando hay filtros activos
    const hasFilters = !!(mod || con || ofi || dis || city || text);
    const resetBtn = $("#reset-filters");
    if (resetBtn) resetBtn.hidden = !hasFilters;
  }

  // "Limpiar filtros" — funciona desde la barra de filtros y desde el estado vacío
  document.addEventListener("click", e => {
    if (!e.target.closest("[data-reset-filters]")) return;
    activeCity = "";
    activeText = "";
    $$(".hero-tag").forEach(t => t.setAttribute("aria-pressed", "false"));
    ["#filter-city", "#filter-modality", "#filter-contract", "#filter-oficio", "#filter-disability"].forEach(id => {
      const sel = $(id);
      if (sel) sel.value = "";
    });
    const heroCity = $("#search-city");
    const heroQ    = $("#search-q");
    const heroDis  = $("#search-disability");
    if (heroCity) heroCity.value = "";
    if (heroQ)    heroQ.value    = "";
    if (heroDis)  heroDis.value  = "";
    applyFilters(true);
  });

  function safe(fn, name) {
    try { fn(); } catch (e) { console.warn("[" + name + "]", e); }
  }

  /* ─────────────────────────────────────────
     NAV
  ───────────────────────────────────────── */
  function initNav() {
    const nav    = $(".nav");
    const burger = $(".nav-burger");
    const mobile = $("#nav-mobile");
    if (!nav) return;

    window.addEventListener("scroll", () => {
      nav.classList.toggle("is-scrolled", scrollY > 20);
    }, { passive: true });

    if (burger && mobile) {
      burger.addEventListener("click", () => {
        const isOpen = burger.getAttribute("aria-expanded") === "true";
        burger.setAttribute("aria-expanded", String(!isOpen));
        mobile.hidden = isOpen;
        burger.setAttribute("aria-label", isOpen ? "Abrir menú" : "Cerrar menú");
      });

      mobile.querySelectorAll("a").forEach(a => {
        a.addEventListener("click", () => {
          burger.setAttribute("aria-expanded", "false");
          mobile.hidden = true;
          burger.setAttribute("aria-label", "Abrir menú");
        });
      });

      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !mobile.hidden) {
          burger.setAttribute("aria-expanded", "false");
          mobile.hidden = true;
          burger.setAttribute("aria-label", "Abrir menú");
          burger.focus();
        }
      });
    }
  }

  /* ─────────────────────────────────────────
     SMOOTH SCROLL (anchor links)
  ───────────────────────────────────────── */
  function getNavHeight() {
    return ($(".nav")?.getBoundingClientRect().height || 72) + 8;
  }

  function initSmoothScroll() {
    document.addEventListener("click", e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute("href");

      // Prevent dead "#" links from jumping to top
      if (!id || id === "#") {
        if (!a.classList.contains("nav-logo")) e.preventDefault();
        return;
      }

      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      window.scrollTo({
        top: target.getBoundingClientRect().top + scrollY - getNavHeight(),
        behavior: reduced ? "auto" : "smooth"
      });
    });
  }

  /* ─────────────────────────────────────────
     SCROLL REVEALS
  ───────────────────────────────────────── */
  function initReveals() {
    const els = $$(".reveal");
    if (!els.length) return;

    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.04, rootMargin: "0px 0px -4% 0px" });

    els.forEach((el, i) => {
      if (el.classList.contains("job-card")) {
        el.style.setProperty("--card-i", String(i % 3));
      }
      io.observe(el);
    });

    // Safety: force-reveal anything still hidden after 5s
    setTimeout(() => {
      $$(".reveal:not(.is-visible)").forEach(el => {
        if (el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add("is-visible");
        }
      });
    }, 5000);
  }

  /* ─────────────────────────────────────────
     GSAP SCROLL ANIMATIONS
  ───────────────────────────────────────── */
  function initGsap() {
    if (!window.gsap || !window.ScrollTrigger) return;
    gsap.registerPlugin(ScrollTrigger);

    // NOTE: hero text elements use the CSS reveal system (.reveal + IntersectionObserver).
    // Do NOT use gsap.from() on them — it sets inline opacity:0 which overrides .is-visible.

    // Stats count-up triggered by scroll
    // target is read at fire time so initSupabase can update data-count-to before scroll
    const statEls = $$("[data-count-to]");
    statEls.forEach(el => {
      if (reduced) {
        el.textContent = parseInt(el.getAttribute("data-count-to"), 10).toLocaleString("es-ES");
        return;
      }
      ScrollTrigger.create({
        trigger: el,
        start: "top 85%",
        once: true,
        onEnter() {
          const target = parseInt(el.getAttribute("data-count-to"), 10);
          gsap.to({ val: 0 }, {
            val: target,
            duration: 2,
            ease: "power2.out",
            onUpdate() {
              el.textContent = Math.round(this.targets()[0].val).toLocaleString("es-ES");
            }
          });
        }
      });
    });

    // Parallax en imagen hero — desactivado con movimiento reducido
    const heroImg = $(".hero-img");
    if (heroImg && !reduced) {
      gsap.to(heroImg, {
        yPercent: 20,
        ease: "none",
        scrollTrigger: {
          trigger: ".hero",
          start: "top top",
          end: "bottom top",
          scrub: true
        }
      });
    }
  }

  /* ─────────────────────────────────────────
     JOB FILTERS
  ───────────────────────────────────────── */
  function initFilters() {
    ["#filter-modality", "#filter-contract", "#filter-oficio", "#filter-disability"].forEach(id => {
      const sel = $(id);
      if (sel) sel.addEventListener("change", () => applyFilters(true));
    });

    // Filtro de ciudad en la barra (sincroniza con activeCity del hero)
    const cityBar = $("#filter-city");
    if (cityBar) {
      cityBar.addEventListener("change", () => {
        activeCity = cityBar.value;
        // Sync el select del hero si existe
        const heroCity = $("#search-city");
        if (heroCity) heroCity.value = cityBar.value;
        applyFilters(true);
      });
    }

    // Establecer estado inicial (aria-hidden + paginación)
    applyFilters();

    // "Ver más ofertas" — paginación real
    const loadMore = $("#jobs-load-more");
    const loadMoreBtn = loadMore && loadMore.querySelector("button");
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", () => {
        const paginated = $$(".job-card.is-paginated");
        if (!paginated.length) return;

        currentShownCount += CARDS_PER_PAGE;
        paginated.slice(0, CARDS_PER_PAGE).forEach(card => {
          card.classList.remove("is-paginated");
          card.setAttribute("aria-hidden", "false");
        });

        const stillPaginated = $$(".job-card.is-paginated").length;
        const shown = totalMatches - stillPaginated;
        const hint = $(".jobs-load-hint");
        if (hint) hint.textContent = `Mostrando ${shown} de ${totalMatches} ofertas`;

        if (stillPaginated === 0) {
          if (loadMore) loadMore.hidden = true;
        }
      });
    }
  }

  /* ─────────────────────────────────────────
     HERO SEARCH → SCROLL + FILTER
  ───────────────────────────────────────── */
  function scrollToJobs() {
    const empleos = $("#empleos");
    if (!empleos) return;
    window.scrollTo({
      top: empleos.getBoundingClientRect().top + scrollY - getNavHeight(),
      behavior: reduced ? "auto" : "smooth"
    });
  }

  function initHeroSearch() {
    const form = $("#hero-form");
    if (!form) return;

    form.addEventListener("submit", e => {
      e.preventDefault();
      activeCity = norm($("#search-city")?.value || "");
      activeText = norm($("#search-q")?.value || "");

      // Mirror city into the filter bar
      const cityBar2 = $("#filter-city");
      if (cityBar2) cityBar2.value = $("#search-city")?.value || "";

      // Mirror disability into the filter bar
      const disVal = ($("#search-disability")?.value || "");
      const selDis = $("#filter-disability");
      if (selDis) selDis.value = disVal;

      applyFilters(true);
      scrollToJobs();
    });

    // Tag-to-filter mapping
    const tagToOficio = { "tecnología": "informática", "administración": "administrativo" };

    $$(".hero-tag").forEach(tag => {
      tag.setAttribute("aria-pressed", "false");
      tag.addEventListener("click", () => {
        const filter = tag.dataset.filter;
        if (!filter) return;

        const selModality = $("#filter-modality");
        const selContract = $("#filter-contract");
        const selOficio   = $("#filter-oficio");

        // Toggle: clicking active tag resets that filter
        const isActive = tag.getAttribute("aria-pressed") === "true";

        // Clear all tags first
        $$(".hero-tag").forEach(t => t.setAttribute("aria-pressed", "false"));

        if (isActive) {
          // Deactivate — reset the relevant filter
          if (["remoto", "presencial", "híbrido"].includes(filter)) {
            if (selModality) selModality.value = "";
          } else if (filter === "indefinido") {
            if (selContract) selContract.value = "";
          } else {
            if (selOficio) selOficio.value = "";
          }
        } else {
          tag.setAttribute("aria-pressed", "true");
          if (["remoto", "presencial", "híbrido"].includes(filter)) {
            if (selModality) selModality.value = filter;
          } else if (filter === "indefinido") {
            if (selContract) selContract.value = "Indefinido";
          } else {
            const oficio = tagToOficio[filter] || filter;
            if (selOficio) selOficio.value = oficio;
          }
        }

        applyFilters(true);
        scrollToJobs();
      });
    });
  }

  /* ─────────────────────────────────────────
     JOB MODAL
  ───────────────────────────────────────── */
  var modalInitialized = false;
  function initModal() {
    const modal = $("#job-modal");
    if (!modal || modalInitialized) return;
    modalInitialized = true;

    function openModal(jobId, focusApply) {
      // data.jobs puede ser undefined si manifest.js no cargó; fallback a window.__BRAND__
      const jobs = data.jobs || (window.__BRAND__ && window.__BRAND__.jobs) || [];
      const job = jobs.find(j => j.id === jobId);
      if (!job) {
        // Fallback: extraer datos básicos del DOM de la card
        const card = document.querySelector('[data-job-id="' + jobId + '"]');
        if (!card) return;
        const logoEl = card.querySelector(".job-logo");
        const mi = $("#modal-logo");
        if (mi) {
          mi.textContent = logoEl ? logoEl.textContent : "??";
          mi.style.setProperty("--logo-color", logoEl ? logoEl.style.getPropertyValue("--logo-color") : "#1a3a6b");
        }
        const si = (id, val) => { const el = $("#" + id); if (el) el.textContent = val; };
        si("modal-job-title", card.querySelector(".job-title")?.textContent || "—");
        si("modal-company",   card.querySelector(".job-company")?.textContent || "—");
        si("modal-city",      card.dataset.city || "—");
        si("modal-modality",  card.dataset.modality || "—");
        si("modal-contract",  card.dataset.contract || "—");
        si("modal-salary",    "A negociar");
        si("modal-description", "");
        const rw = $("#modal-requirements-wrap"); if (rw) rw.hidden = true;
        const bw = $("#modal-benefits-wrap");     if (bw) bw.hidden = true;
        const sl = $("#modal-source-link");       if (sl) sl.hidden = true;
        const form = $("#apply-form"); const succ = $("#apply-success");
        if (form) { form.reset(); form.hidden = false; }
        if (succ) succ.hidden = true;
        modal.showModal();
        setTimeout(() => { const t = $(".modal-title"); if (t) t.focus(); }, 100);
        return;
      }

      // Track current job for apply form
      currentModalJob = job;

      // Populate info
      const logoEl = $("#modal-logo");
      if (logoEl) {
        logoEl.textContent = job.initials;
        logoEl.style.setProperty("--logo-color", job.color || "#1a3a6b");
      }
      const setInner = (id, val) => { const el = $("#" + id); if (el) el.textContent = val; };
      setInner("modal-job-title", job.title);
      setInner("modal-company", job.company);
      setInner("modal-city", job.city);
      setInner("modal-modality", job.modality);
      setInner("modal-contract", job.contract);
      setInner("modal-salary", job.salary || "A negociar");
      setInner("modal-description", job.description || "");

      // Requisitos
      const reqWrap = $("#modal-requirements-wrap");
      const reqList = $("#modal-requirements");
      if (reqList && reqWrap) {
        if (job.requirements && job.requirements.length) {
          reqList.innerHTML = job.requirements.map(r => `<li>${escHTML(r)}</li>`).join("");
          reqWrap.hidden = false;
        } else {
          reqWrap.hidden = true;
        }
      }

      // Beneficios
      const benWrap = $("#modal-benefits-wrap");
      const benList = $("#modal-benefits");
      if (benList && benWrap) {
        if (job.benefits && job.benefits.length) {
          benList.innerHTML = job.benefits.map(b => `<li>${escHTML(b)}</li>`).join("");
          benWrap.hidden = false;
        } else {
          benWrap.hidden = true;
        }
      }

      // Enlace a la oferta original (jobs de Adzuna tienen source_url)
      var linkWrap = $("#modal-source-link");
      if (linkWrap) {
        var srcUrl = job.source_url || "";
        if (srcUrl && srcUrl.startsWith("http")) {
          linkWrap.href = srcUrl;
          linkWrap.hidden = false;
        } else {
          linkWrap.hidden = true;
        }
      }

      // Reset form and button state
      const form = $("#apply-form");
      const success = $("#apply-success");
      if (form) { form.reset(); form.hidden = false; }
      if (success) success.hidden = true;
      const submitBtn = $("#apply-submit");
      if (submitBtn) {
        submitBtn.disabled = false;
        const btnText = $(".btn-text", submitBtn);
        const btnLoad = $(".btn-loading", submitBtn);
        if (btnText) btnText.hidden = false;
        if (btnLoad) btnLoad.hidden = true;
      }

      modal.showModal();

      if (focusApply) {
        setTimeout(() => { const n = $("#apply-name"); if (n) n.focus(); }, 100);
      } else {
        setTimeout(() => { const t = $(".modal-title"); if (t) t.focus(); }, 100);
      }
    }

    function closeModal() {
      modal.close();
    }

    // Open via "Ver detalles" or "Enviar CV"
    document.addEventListener("click", e => {
      const openBtn = e.target.closest("[data-open-modal]");
      if (!openBtn) return;
      const jobId = openBtn.dataset.openModal;
      const isApply = openBtn.classList.contains("btn-apply");
      openModal(jobId, isApply);
    });

    const closeBtn = modal.querySelector(".modal-close") || $("#modal-close");
    closeBtn && closeBtn.addEventListener("click", closeModal);

    modal.addEventListener("click", e => {
      if (e.target === modal) closeModal();
    });

    modal.addEventListener("keydown", e => {
      if (e.key === "Escape") closeModal();
    });

    // Apply form submit — only attach once
    const applyForm = $("#apply-form");
    if (applyForm && !applyForm.dataset.listenerAttached) {
      applyForm.dataset.listenerAttached = "1";

      applyForm.addEventListener("submit", async function(e) {
        e.preventDefault();
        if (!applyForm.reportValidity()) return;

        const submitBtn = $("#apply-submit");
        const btnText   = $(".btn-text", submitBtn);
        const btnLoad   = $(".btn-loading", submitBtn);
        if (btnText) btnText.hidden = true;
        if (btnLoad) btnLoad.hidden = false;
        if (submitBtn) submitBtn.disabled = true;

        try {
          // 1. Upload CV to Supabase Storage if provided
          var cvUrl = "";
          var fileInput = $("#apply-cv");
          var file = fileInput && fileInput.files && fileInput.files[0];
          if (file && SB_URL && SB_KEY) {
            var ext = file.name.split(".").pop() || "pdf";
            var fname = "cv-" + Date.now() + "-" + Math.random().toString(36).slice(2) + "." + ext;
            var uploadRes = await fetch(SB_URL + "/storage/v1/object/cvs/" + fname, {
              method: "POST",
              headers: {
                "apikey": SB_KEY,
                "Authorization": "Bearer " + SB_KEY,
                "Content-Type": file.type || "application/octet-stream"
              },
              body: file
            });
            if (uploadRes.ok) {
              cvUrl = SB_URL + "/storage/v1/object/public/cvs/" + fname;
            }
          }

          // 2. Get current job snapshot for the application record
          var job = currentModalJob || {};

          // 3. POST application to Supabase
          var payload = {
            job_id:        job.id ? Number(job.id) : null,
            job_title:     job.title     || "",
            company_name:  job.company   || "",
            company_email: job.email_contacto || "",
            nombre:        (applyForm.querySelector("[name=name]")      || {}).value || "",
            email:         (applyForm.querySelector("[name=email]")     || {}).value || "",
            telefono:      (applyForm.querySelector("[name=phone]")     || {}).value || "",
            discapacidad:  (applyForm.querySelector("[name=disability]")|| {}).value || "",
            carta:         (applyForm.querySelector("[name=message]")   || {}).value || "",
            cv_url:        cvUrl
          };

          var ok = await sbPost("applications", payload);

          if (ok) {
            applyForm.hidden = true;
            var success = $("#apply-success");
            if (success) success.hidden = false;
          } else {
            throw new Error("POST failed");
          }
        } catch(err) {
          // Restore button on error
          if (btnText) btnText.hidden = false;
          if (btnLoad) btnLoad.hidden = true;
          if (submitBtn) { submitBtn.disabled = false; }
          alert("Hubo un problema al enviar tu candidatura. Inténtalo de nuevo.");
        }
      });
    }

    // File upload label
    const fileInput = $("#apply-cv");
    const hint = $("#cv-hint");
    if (fileInput && hint) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        hint.innerHTML = file
          ? `<strong>${escHTML(file.name)}</strong> seleccionado`
          : `Arrastra tu CV aquí o <strong>haz clic</strong>`;
      });
    }
  }

  /* ─────────────────────────────────────────
     BOT WIDGET
  ───────────────────────────────────────── */
  function initBot() {
    const toggle  = $("#bot-toggle");
    const panel   = $("#bot-panel");
    const closeBtn = $(".bot-close");
    const badge   = $(".bot-badge");
    const iconOpen  = $(".bot-icon-open");
    const iconClose = $(".bot-icon-close");
    if (!toggle || !panel) return;

    function openBot() {
      panel.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      if (iconOpen) iconOpen.hidden = true;
      if (iconClose) iconClose.hidden = false;
      if (badge) badge.style.display = "none";
    }

    function closeBot() {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      if (iconOpen) iconOpen.hidden = false;
      if (iconClose) iconClose.hidden = true;
    }

    function loadBotJobs() {
      var list = $(".bot-jobs-list", panel);
      if (!list) return;

      // Use liveJobs if available, else fall back to manifest jobs
      var jobs = (liveJobs && liveJobs.length ? liveJobs : data.jobs || []).slice(0, 3);
      if (!jobs.length) {
        list.innerHTML = '<p class="bot-empty">No hay ofertas disponibles aún.</p>';
        return;
      }

      list.innerHTML = jobs.map(function(j) {
        return '<div class="bot-job-card">' +
          '<div class="bot-job-logo" style="background:' + j.color + '">' + escHTML(j.initials) + '</div>' +
          '<div class="bot-job-info">' +
            '<strong class="bot-job-title">' + escHTML(j.title) + '</strong>' +
            '<span class="bot-job-meta">' + escHTML(j.company) + ' · ' + escHTML(j.city) + '</span>' +
          '</div>' +
          '<button type="button" class="bot-job-btn btn btn-sm btn-primary" data-open-modal="' + escHTML(j.id) + '">Ver</button>' +
        '</div>';
      }).join("");

      // Wire up modal buttons inside bot panel
      $$(".bot-job-btn", list).forEach(function(btn) {
        btn.addEventListener("click", function() {
          var id = btn.dataset.openModal;
          closeBot();
          // Trigger the existing modal open logic
          var detailBtn = $('[data-open-modal="' + id + '"]');
          if (detailBtn) detailBtn.click();
        });
      });
    }

    toggle.addEventListener("click", () => {
      if (panel.hidden) { openBot(); loadBotJobs(); } else { closeBot(); }
    });

    closeBtn && closeBtn.addEventListener("click", () => { closeBot(); toggle.focus(); });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !panel.hidden) {
        closeBot();
        toggle.focus();
      }
    });

    // Quick replies
    $$(".bot-quick").forEach(btn => {
      btn.addEventListener("click", () => {
        const city = btn.dataset.city;
        if (!city || city === "otra") {
          closeBot();
          const citysel = $("#search-city");
          if (citysel) citysel.focus();
          return;
        }

        // Coordinate with the shared filter system
        activeCity = norm(city);
        const heroCity = $("#search-city");
        if (heroCity) heroCity.value = city.charAt(0).toUpperCase() + city.slice(1);
        applyFilters(true);
        closeBot();
        const empleos = $("#empleos");
        if (empleos) empleos.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      });
    });
  }

  /* ─────────────────────────────────────────
     NEWSLETTER FORM
  ───────────────────────────────────────── */
  function initNewsletter() {
    const form = $(".newsletter-form");
    if (!form) return;

    form.addEventListener("submit", e => {
      e.preventDefault();
      if (!form.reportValidity()) return;

      const btn     = $(".btn-nl-submit");
      const btnText = $(".btn-text", btn);
      const btnLoad = $(".btn-loading", btn);
      const btnOk   = $(".btn-success", btn);

      if (btnText) btnText.hidden = true;
      if (btnLoad) btnLoad.hidden = false;
      if (btn) btn.disabled = true;

      setTimeout(() => {
        if (btnLoad) btnLoad.hidden = true;
        if (btnOk)   btnOk.hidden = false;
        if (btn) btn.style.background = "var(--green-dark)";

        // Allow re-submit after 4s in case user made a mistake
        setTimeout(() => {
          if (btnText) btnText.hidden = false;
          if (btnOk)   btnOk.hidden = true;
          if (btn) { btn.disabled = false; btn.style.background = ""; }
          form.reset();
        }, 4000);
      }, 1500);
    });
  }

  /* ─────────────────────────────────────────
     ACCESSIBILITY TOOLBAR
  ───────────────────────────────────────── */
  function initA11yToolbar() {
    const root = document.documentElement;
    let fontScale = 1;

    $$("[data-a11y]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.a11y;

        if (action === "font-inc") {
          fontScale = Math.min(fontScale + 0.1, 1.4);
          root.style.setProperty("--font-scale", fontScale.toFixed(1));
        } else if (action === "font-dec") {
          fontScale = Math.max(fontScale - 0.1, 0.85);
          root.style.setProperty("--font-scale", fontScale.toFixed(1));
        } else if (action === "contrast") {
          const isHC = document.body.dataset.hc === "1";
          document.body.dataset.hc = isHC ? "0" : "1";
          btn.setAttribute("aria-pressed", String(!isHC));
        }
      });
    });
  }

  /* ─────────────────────────────────────────
     CARD HOVER TILT (desktop only)
  ───────────────────────────────────────── */
  function initTilt() {
    if (!fineHover || reduced) return;

    $$(".job-card, .step, .company-badge").forEach(card => {
      card.addEventListener("mousemove", e => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width  - 0.5;
        const y = (e.clientY - rect.top)  / rect.height - 0.5;
        card.style.transform = `translateY(-3px) rotateX(${(-y * 5).toFixed(1)}deg) rotateY(${(x * 5).toFixed(1)}deg)`;
        card.style.transition = "transform .1s";
      });

      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
        card.style.transition = "all .4s var(--ease-out)";
      });
    });
  }

  /* ─────────────────────────────────────────
     MOUSE GRADIENT (hero mesh)
  ───────────────────────────────────────── */
  function initMouseGradient() {
    if (!fineHover) return;
    const hero = $(".hero");
    if (!hero) return;

    hero.addEventListener("mousemove", e => {
      const rect = hero.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width  * 100).toFixed(1);
      const y = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1);
      document.documentElement.style.setProperty("--mx", x + "%");
      document.documentElement.style.setProperty("--my", y + "%");
    });
  }

  /* ─────────────────────────────────────────
     SUPABASE LIVE JOBS
  ───────────────────────────────────────── */
  var liveJobs = [];
  var currentModalJob = null;
  var fetchInFlight = false;

  function renderJobsToGrid(jobs) {
    var grid = $("[data-jobs]");
    if (!grid || !jobs.length) return;
    grid.innerHTML = jobs.map(buildCardHTML).join("");
    // Cards injected after boot are not observed by IntersectionObserver — reveal immediately
    $$(".job-card.reveal", grid).forEach(function(el) { el.classList.add("is-visible"); });
    applyFilters();
  }

  function initSupabase() {
    if (!SB_URL || !SB_KEY) return;

    // Render mock jobs immediately so grid is never empty while Supabase loads
    if (data.jobs && data.jobs.length) renderJobsToGrid(data.jobs);

    function fetchAndRender() {
      if (fetchInFlight) return;
      fetchInFlight = true;
      sbGet("jobs?estado=eq.publicada&order=created_at.desc")
        .then(function(rows) {
          fetchInFlight = false;
          if (!rows || !rows.length) return;

          // Empresas y patrones bloqueados en cliente (falsos positivos del bot)
          var BLOCKED_COMPANIES = ["veterinary staff", "the vet office", "gmail"];
          var BLOCKED_TITLE_WORDS = ["irlanda", "ireland", "uk jobs"];

          // Adapt rows to normalized job objects, filtering blocked entries
          var companyCount = {};
          var MAX_PER_COMPANY = 5;
          liveJobs = rows.map(adaptSbJob).filter(function(job) {
            var co = (job.company || "").toLowerCase();
            var ti = (job.title  || "").toLowerCase();
            if (BLOCKED_COMPANIES.some(function(b) { return co.includes(b); })) return false;
            if (BLOCKED_TITLE_WORDS.some(function(b) { return ti.includes(b); })) return false;
            // Máximo 5 ofertas por empresa para evitar monopolio en el listado
            companyCount[co] = (companyCount[co] || 0) + 1;
            if (companyCount[co] > MAX_PER_COMPANY) return false;
            return true;
          });

          // Merge with manifest fallback — live takes priority over mock
          data.jobs = liveJobs;

          var grid = $("[data-jobs]");
          if (!grid) return;

          // Replace grid contents with live cards
          grid.innerHTML = liveJobs.map(buildCardHTML).join("");

          // Re-run tilt on new cards
          if (fineHover && !reduced) {
            $$(".job-card", grid).forEach(function(card) {
              card.addEventListener("mousemove", function(e) {
                var rect = card.getBoundingClientRect();
                var x = (e.clientX - rect.left) / rect.width  - 0.5;
                var y = (e.clientY - rect.top)  / rect.height - 0.5;
                card.style.transform = "translateY(-3px) rotateX(" + (-y * 5).toFixed(1) + "deg) rotateY(" + (x * 5).toFixed(1) + "deg)";
                card.style.transition = "transform .1s";
              });
              card.addEventListener("mouseleave", function() {
                card.style.transform = "";
                card.style.transition = "all .4s var(--ease-out)";
              });
            });
          }

          // Update all offer counters with real count
          var n = liveJobs.length;
          // Filter bar counter (e.g. "70 ofertas")
          var resultsCount = $("[data-results-count]");
          if (resultsCount) resultsCount.textContent = String(n);
          // Animated stats counter in the stats section
          var statCount = $("[data-count-to]");
          if (statCount) {
            statCount.setAttribute("data-count-to", n);
            statCount.setAttribute("aria-label", n + " ofertas activas");
            statCount.textContent = n.toLocaleString("es-ES");
          }

          // Update bot badge
          var badge = $(".bot-badge");
          if (badge) {
            badge.textContent = liveJobs.length;
            badge.style.display = liveJobs.length ? "" : "none";
          }

          // Re-apply current filters so any active filter still works
          applyFilters();
        }).catch(function() { fetchInFlight = false; });
    }

    fetchAndRender();
    // Poll every 5 minutes
    setInterval(fetchAndRender, 5 * 60 * 1000);
  }

  /* ─────────────────────────────────────────
     DARK MODE
  ───────────────────────────────────────── */
  function initDarkMode() {
    const saved = localStorage.getItem("ij-theme");
    const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
    if (saved === "dark" || (!saved && prefersDark)) {
      document.body.dataset.theme = "dark";
    }

    const btn = $("[data-a11y='dark-mode']");
    if (!btn) return;

    function syncBtn() {
      const isDark = document.body.dataset.theme === "dark";
      btn.setAttribute("aria-pressed", String(isDark));
      btn.setAttribute("aria-label", isDark ? "Desactivar modo oscuro" : "Activar modo oscuro");
      btn.title = isDark ? "Modo claro" : "Modo oscuro";
    }
    syncBtn();

    btn.addEventListener("click", () => {
      const isDark = document.body.dataset.theme === "dark";
      document.body.dataset.theme = isDark ? "light" : "dark";
      localStorage.setItem("ij-theme", document.body.dataset.theme);
      syncBtn();
    });
  }

  /* ─────────────────────────────────────────
     BOOT
  ───────────────────────────────────────── */
  function boot() {
    safe(initNav,           "initNav");
    safe(initSmoothScroll,  "initSmoothScroll");
    safe(initSupabase,      "initSupabase");   // render jobs first so initTilt/initReveals see them
    safe(initReveals,       "initReveals");
    safe(initFilters,       "initFilters");
    safe(initHeroSearch,    "initHeroSearch");
    safe(initModal,         "initModal");
    safe(initBot,           "initBot");
    safe(initNewsletter,    "initNewsletter");
    safe(initA11yToolbar,   "initA11yToolbar");
    safe(initTilt,          "initTilt");
    safe(initMouseGradient, "initMouseGradient");
    safe(initDarkMode,      "initDarkMode");

    if (window.gsap && window.ScrollTrigger) {
      safe(initGsap, "initGsap");
    }

    document.documentElement.classList.add("is-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
