/* Incloo — Acceso de empresas (Supabase Auth)
   Requiere: lib/manifest.js (config) y supabase-js v2 (UMD, window.supabase).
   Si falta la clave pública en el manifest o la librería no cargó,
   no se muestra nada y la web funciona como siempre. */
(function () {
  "use strict";

  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };

  // Verificación fiscal española: valida el dígito de control de un CIF (empresa),
  // NIF/DNI (autónomo) o NIE. Mismo algoritmo que la función SQL del servidor;
  // aquí solo da feedback instantáneo — la verdad la decide el servidor.
  function validarNifCif(valor) {
    var v = String(valor || "").toUpperCase().replace(/[\s.\-]/g, "");
    var letras = "TRWAGMYFPDXBNJZSQVHLCKE";
    var m;
    // DNI / NIF: 8 dígitos + letra
    if ((m = v.match(/^(\d{8})([A-Z])$/))) {
      return letras[parseInt(m[1], 10) % 23] === m[2];
    }
    // NIE: X/Y/Z + 7 dígitos + letra
    if ((m = v.match(/^([XYZ])(\d{7})([A-Z])$/))) {
      var pref = { X: "0", Y: "1", Z: "2" }[m[1]];
      return letras[parseInt(pref + m[2], 10) % 23] === m[3];
    }
    // CIF de empresa: letra + 7 dígitos + control (dígito o letra)
    if ((m = v.match(/^([ABCDEFGHJKLMNPQRSUVW])(\d{7})([0-9A-J])$/))) {
      var org = m[1], digs = m[2], ctrl = m[3], s = 0;
      for (var i = 0; i < 7; i++) {
        var n = parseInt(digs[i], 10);
        if (i % 2 === 0) { n *= 2; if (n > 9) n = Math.floor(n / 10) + (n % 10); }
        s += n;
      }
      var e = (10 - (s % 10)) % 10;
      var letraCtrl = "JABCDEFGHI"[e];
      if ("PQRSNW".indexOf(org) !== -1) return ctrl === letraCtrl;
      if ("ABEH".indexOf(org) !== -1)  return ctrl === String(e);
      return ctrl === String(e) || ctrl === letraCtrl;
    }
    return false;
  }

  function boot() {
    var brand = window.__BRAND__ || {};
    var cfg   = brand.supabase || {};
    if (!cfg.url || !cfg.key || !window.supabase) return;

    var client = window.supabase.createClient(cfg.url, cfg.key);

    var companyCache = null;   // fila de public.companies del usuario actual
    var currentUser  = null;

    /* ── API pública para otras páginas (p. ej. publicar-oferta.html) ── */
    window.IncloAuth = {
      client: client,
      getSession: function () {
        return client.auth.getSession().then(function (r) {
          return (r.data && r.data.session) || null;
        });
      },
      getCompany: fetchCompany,
      open: openModal
    };

    /* ─────────────────────────────────────────
       MARKUP: botón en nav + modal
    ───────────────────────────────────────── */
    var SVG_USER = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6"/></svg>';

    var navBtn = document.createElement("button");
    navBtn.type = "button";
    navBtn.id = "auth-btn";
    navBtn.className = "btn btn-outline-blue nav-login";
    navBtn.innerHTML = SVG_USER + '<span id="auth-btn-label">Acceso empresas</span>';
    var navInner = $(".nav-inner");
    if (navInner) navInner.insertBefore(navBtn, $(".nav-cta", navInner));

    var mobileBtn = document.createElement("button");
    mobileBtn.type = "button";
    mobileBtn.className = "btn btn-outline-blue auth-mobile-btn";
    mobileBtn.innerHTML = SVG_USER + '<span>Acceso empresas</span>';
    var navMobile = $("#nav-mobile");
    if (navMobile) navMobile.insertBefore(mobileBtn, $(".btn", navMobile));

    var modal = document.createElement("dialog");
    modal.className = "job-modal auth-modal";
    modal.id = "auth-modal";
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "auth-title");
    modal.innerHTML =
      '<div class="auth-inner">' +
        '<button type="button" class="modal-close auth-close" aria-label="Cerrar">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +

        '<h2 id="auth-title" class="auth-title" tabindex="-1">Acceso empresas</h2>' +
        '<p class="auth-sub" id="auth-sub">Publica ofertas y gestiona tu empresa.</p>' +

        '<div class="auth-alert" id="auth-error" role="alert" hidden></div>' +
        '<div class="auth-alert auth-alert--ok" id="auth-info" role="status" hidden></div>' +

        // ── Vista: iniciar sesión ──
        '<form class="apply-form auth-view" id="auth-view-login" novalidate>' +
          '<div class="form-group"><label for="auth-login-email">Email</label>' +
            '<input type="email" id="auth-login-email" autocomplete="email" required placeholder="tu@empresa.com"></div>' +
          '<div class="form-group"><label for="auth-login-pass">Contraseña</label>' +
            '<input type="password" id="auth-login-pass" autocomplete="current-password" required minlength="6" placeholder="••••••••"></div>' +
          '<button type="submit" class="btn btn-primary auth-submit" id="auth-login-submit">Iniciar sesión</button>' +
          '<p class="auth-switch">¿Aún no tienes cuenta? <button type="button" class="auth-link" data-auth-view="signup">Registra tu empresa</button></p>' +
        '</form>' +

        // ── Vista: registro de empresa ──
        '<form class="apply-form auth-view" id="auth-view-signup" hidden novalidate>' +
          '<div class="form-group"><label for="auth-su-empresa">Nombre de la empresa <span aria-hidden="true">*</span></label>' +
            '<input type="text" id="auth-su-empresa" autocomplete="organization" required placeholder="Mi Empresa S.L."></div>' +
          '<div class="form-group"><label for="auth-su-nif">CIF / NIF de la empresa <span aria-hidden="true">*</span></label>' +
            '<input type="text" id="auth-su-nif" required placeholder="B12345678" autocomplete="off" maxlength="9">' +
            '<span class="auth-field-hint" id="auth-nif-hint">Verificamos que sea un CIF/NIF español válido.</span></div>' +
          '<div class="form-group"><label for="auth-su-email">Email <span aria-hidden="true">*</span></label>' +
            '<input type="email" id="auth-su-email" autocomplete="email" required placeholder="tu@empresa.com"></div>' +
          '<div class="form-group"><label for="auth-su-pass">Contraseña <span aria-hidden="true">*</span></label>' +
            '<input type="password" id="auth-su-pass" autocomplete="new-password" required minlength="6" placeholder="Mínimo 6 caracteres"></div>' +
          '<div class="form-group"><label for="auth-su-tel">Teléfono</label>' +
            '<input type="tel" id="auth-su-tel" autocomplete="tel" placeholder="+34 600 000 000"></div>' +
          '<div class="form-group"><label for="auth-su-web">Página web</label>' +
            '<input type="url" id="auth-su-web" autocomplete="url" placeholder="https://miempresa.com"></div>' +
          '<button type="submit" class="btn btn-primary auth-submit" id="auth-signup-submit">Crear cuenta</button>' +
          '<p class="auth-switch">¿Ya tienes cuenta? <button type="button" class="auth-link" data-auth-view="login">Inicia sesión</button></p>' +
        '</form>' +

        // ── Vista: mi cuenta ──
        '<div class="auth-view" id="auth-view-account" hidden>' +
          '<div class="auth-badge" id="auth-verif-badge" hidden></div>' +
          '<dl class="modal-meta auth-account-meta">' +
            '<div><dt>Empresa</dt><dd id="auth-acc-nombre">—</dd></div>' +
            '<div><dt>CIF / NIF</dt><dd id="auth-acc-nif">—</dd></div>' +
            '<div><dt>Email</dt><dd id="auth-acc-email">—</dd></div>' +
          '</dl>' +
          '<a href="publicar-oferta.html" class="btn btn-primary auth-submit" id="auth-publish-link">Publicar una oferta</a>' +
          '<button type="button" class="btn btn-outline-blue auth-submit" id="auth-logout">Cerrar sesión</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    /* ─────────────────────────────────────────
       HELPERS UI
    ───────────────────────────────────────── */
    var errorBox = $("#auth-error", modal);
    var infoBox  = $("#auth-info", modal);

    function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; infoBox.hidden = true; }
    function showInfo(msg)  { infoBox.textContent = msg; infoBox.hidden = false; errorBox.hidden = true; }
    function clearAlerts()  { errorBox.hidden = true; infoBox.hidden = true; }

    function humanError(err) {
      var m = (err && err.message) || "";
      if (/invalid login credentials/i.test(m))  return "Email o contraseña incorrectos.";
      if (/email not confirmed/i.test(m))        return "Tu email aún no está confirmado. Revisa tu bandeja de entrada.";
      if (/already registered/i.test(m))         return "Ya existe una cuenta con este email. Inicia sesión.";
      if (/password should be at least/i.test(m)) return "La contraseña debe tener al menos 6 caracteres.";
      if (/rate limit|too many/i.test(m))        return "Demasiados intentos. Espera un momento e inténtalo de nuevo.";
      return "No se ha podido completar la operación. " + (m ? "(" + m + ")" : "Inténtalo de nuevo.");
    }

    function setBusy(btn, busy, labelBusy, labelIdle) {
      if (!btn) return;
      btn.disabled = busy;
      btn.textContent = busy ? labelBusy : labelIdle;
    }

    var VIEWS = { login: "#auth-view-login", signup: "#auth-view-signup", account: "#auth-view-account" };
    var TITLES = {
      login:   ["Acceso empresas", "Entra para publicar ofertas y gestionar tu empresa."],
      signup:  ["Registra tu empresa", "Crea tu cuenta gratuita y empieza a publicar ofertas inclusivas."],
      account: ["Mi empresa", "Estos son los datos de tu cuenta."]
    };

    function showView(name) {
      clearAlerts();
      Object.keys(VIEWS).forEach(function (k) {
        var el = $(VIEWS[k], modal);
        if (el) el.hidden = (k !== name);
      });
      $("#auth-title", modal).textContent = TITLES[name][0];
      $("#auth-sub", modal).textContent   = TITLES[name][1];
    }

    function openModal(view) {
      showView(view || (currentUser ? "account" : "login"));
      if (!modal.open) modal.showModal();
      setTimeout(function () {
        var first = $(".auth-view:not([hidden]) input", modal) || $("#auth-title", modal);
        first.focus();
      }, 80);
    }

    function closeModal() { if (modal.open) modal.close(); }

    /* ─────────────────────────────────────────
       DATOS: perfil de empresa
    ───────────────────────────────────────── */
    function fetchCompany(force) {
      if (companyCache && !force) return Promise.resolve(companyCache);
      if (!currentUser) return Promise.resolve(null);
      return client.from("companies").select("*").eq("id", currentUser.id).maybeSingle()
        .then(function (r) {
          companyCache = r.data || null;
          return companyCache;
        })
        .catch(function () { return null; });
    }

    function announceSession(session) {
      fetchCompany().then(function (company) {
        document.dispatchEvent(new CustomEvent("incloo:session", {
          detail: { session: session, company: company }
        }));
        var label = $("#auth-btn-label");
        if (label) {
          label.textContent = session
            ? ((company && company.nombre) || session.user.email)
            : "Acceso empresas";
        }
        navBtn.classList.toggle("is-logged", !!session);
        var badge = $("#auth-verif-badge", modal);
        var pubLink = $("#auth-publish-link", modal);
        if (session && company) {
          $("#auth-acc-nombre", modal).textContent = company.nombre || "—";
          $("#auth-acc-nif", modal).textContent    = company.nif || "—";
          $("#auth-acc-email", modal).textContent  = (company.email || session.user.email || "—");
          var ok = !!company.nif_valido;
          if (badge) {
            badge.hidden = false;
            badge.className = "auth-badge " + (ok ? "auth-badge--ok" : "auth-badge--pending");
            badge.textContent = ok
              ? "✔ Empresa verificada fiscalmente"
              : "⚠ CIF/NIF no verificado — no podrás publicar ofertas hasta corregirlo";
          }
          // Sin verificación fiscal no se puede publicar (lo bloquea también el servidor)
          if (pubLink) {
            pubLink.setAttribute("aria-disabled", ok ? "false" : "true");
            pubLink.classList.toggle("is-disabled", !ok);
          }
        } else if (session) {
          $("#auth-acc-nombre", modal).textContent = "—";
          $("#auth-acc-nif", modal).textContent    = "—";
          $("#auth-acc-email", modal).textContent  = session.user.email || "—";
          if (badge) badge.hidden = true;
        }
      });
    }

    /* ─────────────────────────────────────────
       EVENTOS
    ───────────────────────────────────────── */
    navBtn.addEventListener("click", function () { openModal(); });
    mobileBtn.addEventListener("click", function () {
      // Cierra el menú móvil antes de abrir el modal
      var burger = $(".nav-burger");
      if (burger && navMobile) {
        burger.setAttribute("aria-expanded", "false");
        navMobile.hidden = true;
      }
      openModal();
    });

    $(".auth-close", modal).addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });

    modal.addEventListener("click", function (e) {
      var sw = e.target.closest("[data-auth-view]");
      if (sw) showView(sw.getAttribute("data-auth-view"));
    });

    // Iniciar sesión
    $("#auth-view-login", modal).addEventListener("submit", function (e) {
      e.preventDefault();
      if (!e.target.reportValidity()) return;
      var btn = $("#auth-login-submit", modal);
      setBusy(btn, true, "Entrando…", "Iniciar sesión");
      clearAlerts();
      client.auth.signInWithPassword({
        email:    $("#auth-login-email", modal).value.trim(),
        password: $("#auth-login-pass", modal).value
      }).then(function (r) {
        setBusy(btn, false, "Entrando…", "Iniciar sesión");
        if (r.error) { showError(humanError(r.error)); return; }
        closeModal();
      });
    });

    // Registro de empresa
    $("#auth-view-signup", modal).addEventListener("submit", function (e) {
      e.preventDefault();
      if (!e.target.reportValidity()) return;

      // Verificación fiscal: el CIF/NIF debe ser un documento español válido
      var nif = $("#auth-su-nif", modal).value.trim().toUpperCase();
      if (!validarNifCif(nif)) {
        showError("El CIF/NIF no es válido. Revisa que sea el de tu empresa española (p. ej. B12345678).");
        $("#auth-su-nif", modal).focus();
        return;
      }

      var btn = $("#auth-signup-submit", modal);
      setBusy(btn, true, "Creando cuenta…", "Crear cuenta");
      clearAlerts();
      client.auth.signUp({
        email:    $("#auth-su-email", modal).value.trim(),
        password: $("#auth-su-pass", modal).value,
        options: {
          emailRedirectTo: location.origin + location.pathname,
          // Estos datos los recoge el trigger handle_new_user y los guarda
          // en la tabla public.companies del proyecto Supabase
          data: {
            empresa:  $("#auth-su-empresa", modal).value.trim(),
            nif:      nif,
            telefono: $("#auth-su-tel", modal).value.trim(),
            web:      $("#auth-su-web", modal).value.trim()
          }
        }
      }).then(function (r) {
        setBusy(btn, false, "Creando cuenta…", "Crear cuenta");
        if (r.error) { showError(humanError(r.error)); return; }
        if (r.data && r.data.session) {
          // Confirmación de email desactivada: sesión iniciada directamente
          showView("account");
          showInfo("¡Cuenta creada! Ya puedes publicar ofertas.");
        } else {
          showView("login");
          showInfo("Te hemos enviado un email para confirmar tu cuenta. Ábrelo y después inicia sesión aquí.");
        }
      });
    });

    // Cerrar sesión
    $("#auth-logout", modal).addEventListener("click", function () {
      client.auth.signOut().then(function () { closeModal(); });
    });

    // Estado de sesión (carga inicial + cambios)
    client.auth.onAuthStateChange(function (_event, session) {
      currentUser = session ? session.user : null;
      if (!session) companyCache = null;
      announceSession(session);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
