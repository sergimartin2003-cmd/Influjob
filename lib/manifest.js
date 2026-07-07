(function () {
  "use strict";

  window.__BRAND__ = {
    name: "Incloo",
    tagline: "Tu talento no tiene límites",
    email: "hola@inclujob.es",
    phone: "+34 900 123 456",

    stats: { ofertas: 0, empresas: 0, personas: 0 },

    jobs: [
    ],

    companies: [
      { name: "Telefónica", badge: "TF", color: "#0066cc", jobs: 8 },
      { name: "BBVA", badge: "BB", color: "#004a97", jobs: 6 },
      { name: "Amazon", badge: "AM", color: "#ff9900", jobs: 12 },
      { name: "Mercadona", badge: "MC", color: "#009a44", jobs: 4 },
      { name: "Deloitte", badge: "DL", color: "#86bc25", jobs: 9 },
      { name: "RENFE", badge: "RF", color: "#e10015", jobs: 3 },
      { name: "Inditex", badge: "IT", color: "#212121", jobs: 7 },
      { name: "NH Hotels", badge: "NH", color: "#c8902a", jobs: 5 },
      { name: "Indra", badge: "IN", color: "#e30016", jobs: 11 },
      { name: "El Corte Inglés", badge: "ECI", color: "#006400", jobs: 14 },
      { name: "Mapfre", badge: "MF", color: "#c62828", jobs: 6 },
      { name: "Acciona", badge: "AC", color: "#00a651", jobs: 8 }
    ],

    // Proyecto Supabase de Incloo (pcvfwlbefnwwexhaenph).
    // "key" debe ser la clave pública del proyecto (anon / publishable):
    // Dashboard → Project Settings → API Keys → anon public / publishable.
    // Es el ÚNICO sitio donde hay que pegarla — el resto de la web la lee de aquí.
    supabase: {
      url: "https://pcvfwlbefnwwexhaenph.supabase.co",
      key: "sb_publishable_tDKJG51pYgsuzCYW8A5Zkg_YAc4MYj7"
    },

    cities: ["Madrid", "Barcelona", "Valencia", "Sevilla", "Zaragoza", "Málaga", "Murcia", "Palma", "Bilbao", "Alicante", "Valladolid", "Remoto"],
    disabilities: ["física", "visual", "auditiva", "intelectual", "múltiple"],
    sectors: ["tecnología", "administración", "atención al cliente", "logística", "hostelería", "comunicación"]
  };
})();
