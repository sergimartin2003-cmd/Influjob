"""
Incloo — Agregador de ofertas para personas con discapacidad
=============================================================
Recoge ofertas de empleo REALES de otras plataformas (vía las APIs de Adzuna y,
opcionalmente, Jooble), filtra las que son de verdad para personas con
discapacidad, EXTRAE los detalles importantes (tipo(s) de discapacidad,
certificado mínimo exigido, plataforma de origen, ciudad, modalidad, salario) y
las sube a Supabase. En la web se muestran en la sección
"Ofertas en otras plataformas".

Se ejecuta desde GitHub Actions (ver .github/workflows/scrape_jobs.yml).
"""

import os
import sys
import re
import hashlib
import requests
from urllib.parse import urlparse
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")

SB_URL = "https://pcvfwlbefnwwexhaenph.supabase.co"
# Clave service_role del proyecto (Dashboard → Project Settings → API Keys).
# Llega como secreto SUPABASE_SERVICE_KEY desde GitHub Actions — nunca hardcodearla.
SB_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

ADZUNA_ID  = "bef3158f"
ADZUNA_KEY = "a5e39157fcf4336140585f0ca2d2c722"

# Jooble es OPCIONAL: solo se consulta si existe el secreto JOOBLE_KEY.
# Consíguela gratis en https://jooble.org/api/about y añádela como secreto de
# GitHub Actions con el nombre JOOBLE_KEY. Si no está, el bot usa solo Adzuna.
JOOBLE_KEY = os.environ.get("JOOBLE_KEY", "")

# Con las claves nuevas de Supabase (sb_secret_…) la clave va SOLO en "apikey";
# en Authorization: Bearer la interpretarían como JWT y la rechazarían.
SB_HEADERS = {
    "apikey":       SB_KEY,
    "Content-Type": "application/json",
    "Prefer":       "return=minimal"
}

# ── Palabras clave que confirman que la oferta es para personas con discapacidad
STRONG_KEYWORDS = [
    "discapacidad", "discapacitad", "diversidad funcional",
    "33%", "45%", "65%", "certificado de discapacidad",
    "cupo reservado", "reserva de plaza", "centro especial de empleo",
    "personas con discapacidad", "trabajadores con discapacidad",
    "minusvalia", "minusvalía", "inclusion laboral", "inclusión laboral"
]

WEAK_KEYWORDS = [
    "diversidad", "inclusión", "accesible", "adaptado",
    "igualdad de oportunidades"
]

# ── Detección del TIPO de discapacidad a partir del texto de la oferta.
# Cada tipo canónico (el que entiende la web) tiene sus sinónimos/pistas.
DISABILITY_PATTERNS = {
    "física":      ["física", "fisica", "motora", "motórica", "motorica",
                    "movilidad reducida", "silla de ruedas", "paraplej",
                    "amputa", "físico-motora"],
    "visual":      ["visual", "ceguera", "ciego", "invidente", "baja visión",
                    "baja vision", "deficiencia visual", "resto visual"],
    "auditiva":    ["auditiva", "sordo", "sordera", "hipoacusia",
                    "lengua de signos", "deficiencia auditiva", "sordomud"],
    "intelectual": ["intelectual", "cognitiva", "discapacidad intelectual",
                    "síndrome de down", "sindrome de down"],
    "psicosocial": ["psicosocial", "salud mental", "enfermedad mental",
                    "psíquica", "psiquica", "trastorno mental"],
    "orgánica":    ["orgánica", "organica", "enfermedad crónica",
                    "enfermedad cronica", "visceral"],
    "tea":         ["tea", "autismo", "asperger", "espectro autista",
                    "neurodivergent"],
}

# Empresas/títulos que son falsos positivos (no son ofertas para discapacidad)
BLACKLIST_COMPANIES = ["veterinary staff", "the vet office", "gmail"]
BLACKLIST_TITLE_PATTERNS = ["irlanda", "ireland", "uk jobs", "reino unido"]

# Búsquedas: genéricas + por tipo de discapacidad, para ampliar la cobertura
SEARCHES = [
    "discapacidad",
    "certificado discapacidad empleo",
    "personas con discapacidad trabajo",
    "empleo inclusivo discapacidad",
    "centro especial de empleo",
    "discapacidad intelectual empleo",
    "discapacidad auditiva trabajo",
    "discapacidad visual empleo",
    "movilidad reducida empleo",
]

SPANISH_CITIES = [
    "Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao",
    "Zaragoza", "Málaga", "Murcia", "Palma", "Alicante",
    "Valladolid", "Granada", "Córdoba", "Vigo", "Gijón",
    "Remoto", "Teletrabajo", "A Coruña", "Santander"
]

# Mapa de dominios → nombre "bonito" de la plataforma de origen
PLATFORM_BY_DOMAIN = {
    "infojobs":         "InfoJobs",
    "indeed":           "Indeed",
    "linkedin":         "LinkedIn",
    "turijobs":         "Turijobs",
    "tecnoempleo":      "Tecnoempleo",
    "jobatus":          "Jobatus",
    "jobtoday":         "Job Today",
    "milanuncios":      "Milanuncios",
    "trabajos":         "Trabajos.com",
    "trovit":           "Trovit",
    "ticjob":           "Ticjob",
    "empleate":         "Empléate",
    "computrabajo":     "Computrabajo",
    "fundaciononce":    "Fundación ONCE",
    "portalento":       "Portalento",
    "inserta":          "Inserta Empleo",
    "disjob":           "Disjob",
    "fundacionadecco":  "Fundación Adecco",
    "adzuna":           "Adzuna",
    "jooble":           "Jooble",
}


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def get_estado(title: str, description: str):
    full = (title + " " + description).lower()
    if any(kw in full for kw in STRONG_KEYWORDS):
        return "publicada"
    if any(kw in full for kw in WEAK_KEYWORDS):
        return "pendiente"
    return None


def detect_disability_types(title: str, description: str) -> str:
    """Devuelve los tipos de discapacidad detectados, separados por comas.
    Si el texto no especifica ninguno, devuelve "" (apta para cualquiera)."""
    full = (title + " " + description).lower()
    found = []
    for canon, hints in DISABILITY_PATTERNS.items():
        if any(h in full for h in hints):
            found.append(canon)
    # "discapacidad múltiple" explícita, o varios tipos a la vez → múltiple
    if "múltiple" in full or "multiple" in full or len(found) >= 3:
        return "múltiple"
    return ", ".join(found)


def detect_certificate(title: str, description: str) -> str:
    """Certificado mínimo exigido: 33%, 45% o 65%. Se queda con el menor
    porcentaje mencionado (el umbral mínimo). "" si no se menciona ninguno."""
    full = (title + " " + description)
    pcts = set(int(m) for m in re.findall(r"\b(33|45|65)\s*%", full))
    if not pcts:
        return ""
    return str(min(pcts)) + "%"


def platform_from_url(url: str, fallback: str) -> str:
    """Nombre legible de la plataforma de origen a partir de la URL."""
    try:
        host = urlparse(url).netloc.lower()
    except Exception:
        host = ""
    for domain, name in PLATFORM_BY_DOMAIN.items():
        if domain in host:
            return name
    if host:
        # p.ej. "www.ejemplo.es" → "Ejemplo"
        parts = [p for p in host.split(".") if p not in ("www", "es", "com", "org", "net")]
        if parts:
            return parts[0].capitalize()
    return fallback


def make_id(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()[:20]


def exists(ext_id: str) -> bool:
    r = requests.get(
        f"{SB_URL}/rest/v1/jobs",
        headers={**SB_HEADERS, "Prefer": ""},
        params={"external_id": f"eq.{ext_id}", "select": "id", "limit": "1"}
    )
    return r.ok and len(r.json()) > 0


def city_from(location: str, title: str = "") -> str:
    combined = (location + " " + title).lower()
    for c in SPANISH_CITIES:
        if c.lower() in combined:
            return c
    if "remoto" in combined or "teletrabajo" in combined:
        return "Remoto"
    return location.strip() or "España"


# ── Fuentes ───────────────────────────────────────────────────────────────────
def search_adzuna(query: str, page: int = 1) -> list:
    """Devuelve ofertas normalizadas de Adzuna (agrega muchos portales reales)."""
    url = f"https://api.adzuna.com/v1/api/jobs/es/search/{page}"
    params = {
        "app_id":          ADZUNA_ID,
        "app_key":         ADZUNA_KEY,
        "what":            query,
        "results_per_page": 50,
        "sort_by":         "date",
        "content-type":    "application/json"
    }
    try:
        r = requests.get(url, params=params, timeout=20)
        r.raise_for_status()
        results = r.json().get("results", [])
    except Exception as e:
        print("Error Adzuna: " + str(e))
        return []

    jobs = []
    for job in results:
        link = job.get("redirect_url", str(job.get("id", "")))
        salary = ""
        smin, smax = job.get("salary_min"), job.get("salary_max")
        if smin and smax:
            salary = str(int(smin)) + " – " + str(int(smax)) + " €/año"
        elif smin:
            salary = "Desde " + str(int(smin)) + " €/año"
        jobs.append({
            "title":       clean(job.get("title", "")),
            "description": clean(job.get("description", "")),
            "company":     clean((job.get("company") or {}).get("display_name", "")),
            "location":    clean((job.get("location") or {}).get("display_name", "")),
            "link":        link,
            "salary":      salary,
            "source_id":   str(job.get("id", link)),
            "platform":    platform_from_url(link, "Adzuna"),
        })
    return jobs


def search_jooble(query: str, page: int = 1) -> list:
    """Devuelve ofertas normalizadas de Jooble (solo si hay JOOBLE_KEY)."""
    if not JOOBLE_KEY:
        return []
    url = f"https://es.jooble.org/api/{JOOBLE_KEY}"
    try:
        r = requests.post(url, json={
            "keywords": query, "location": "España", "page": str(page)
        }, timeout=20)
        r.raise_for_status()
        results = r.json().get("jobs", [])
    except Exception as e:
        print("Error Jooble: " + str(e))
        return []

    jobs = []
    for job in results:
        link = job.get("link", "")
        source = clean(job.get("source", "")) or "Jooble"
        jobs.append({
            "title":       clean(job.get("title", "")),
            "description": clean(job.get("snippet", "")),
            "company":     clean(job.get("company", "")),
            "location":    clean(job.get("location", "")),
            "link":        link,
            "salary":      clean(job.get("salary", "")),
            "source_id":   str(job.get("id", link)),
            "platform":    platform_from_url(link, source),
        })
    return jobs


def insert_job(job: dict) -> bool:
    r = requests.post(f"{SB_URL}/rest/v1/jobs", headers=SB_HEADERS, json=job)
    if not r.ok:
        # Sin esto solo veríamos "ERROR al insertar" sin saber la causa real
        print("      -> HTTP " + str(r.status_code) + ": " + (r.text or "")[:200])
    return r.ok


def preflight() -> None:
    """Comprueba que la SUPABASE_SERVICE_KEY es válida para ESTE proyecto antes
    de scrapear. Si la clave es incorrecta (típico tras cambiar de proyecto),
    la lectura/escritura devuelve 401/403 y aquí se ve claramente en el log."""
    try:
        r = requests.get(
            f"{SB_URL}/rest/v1/jobs",
            headers={**SB_HEADERS, "Prefer": ""},
            params={"select": "id", "limit": "1"},
            timeout=20
        )
    except Exception as e:
        print("Preflight: no se pudo conectar a Supabase: " + str(e))
        return
    print("Preflight (lectura tabla jobs): HTTP " + str(r.status_code))
    if r.status_code in (401, 403):
        print("  ⚠ La SUPABASE_SERVICE_KEY NO es válida para el proyecto "
              + SB_URL + ".")
        print("  ⚠ Actualiza el secreto SUPABASE_SERVICE_KEY con la clave "
              "service_role (sb_secret_…) de este proyecto en:")
        print("     GitHub → Settings → Secrets and variables → Actions.")
        print("  Respuesta de Supabase: " + (r.text or "")[:300])


# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    if not SB_KEY:
        sys.exit("Falta la variable de entorno SUPABASE_SERVICE_KEY (secreto de GitHub Actions)")

    print("Incloo — Agregador de ofertas externas - " + datetime.now().strftime("%Y-%m-%d %H:%M"))
    print("Fuentes activas: Adzuna" + (" + Jooble" if JOOBLE_KEY else ""))

    preflight()

    seen_ids = set()
    total = 0

    for query in SEARCHES:
        print("\nBuscando: " + query)
        results = search_adzuna(query) + search_jooble(query)
        print("Resultados: " + str(len(results)))

        for job in results:
            title    = job["title"]
            desc     = job["description"]
            company  = job["company"]
            location = job["location"]
            link     = job["link"]
            platform = job["platform"]

            if not title:
                continue

            # Filtro blacklist: empresas y títulos que no son ofertas para discapacidad
            company_lower = company.lower()
            title_lower = title.lower()
            if any(b in company_lower for b in BLACKLIST_COMPANIES):
                print("  [blacklist-empresa] " + title[:65])
                continue
            if any(b in title_lower for b in BLACKLIST_TITLE_PATTERNS):
                print("  [blacklist-titulo] " + title[:65])
                continue

            estado = get_estado(title, desc)
            print("  [" + (estado or "descartada") + "] " + title[:65])
            if estado is None:
                continue

            ext_id = make_id(job["source_id"])
            if ext_id in seen_ids or exists(ext_id):
                print("    -> ya existe")
                continue
            seen_ids.add(ext_id)

            modalidad = "remoto" if "remoto" in (title + desc + location).lower() else "presencial"
            ciudad = city_from(location, title)
            tipos = detect_disability_types(title, desc)
            certificado = detect_certificate(title, desc)

            payload = {
                "puesto":             title[:200],
                "empresa":            company or "Empresa confidencial",
                "ciudad":             ciudad,
                "modalidad":          modalidad,
                "tipo_contrato":      "Indefinido",
                "salario":            job["salary"],
                "descripcion":        desc[:3000],
                "discapacidad_tipos": tipos,        # "" = apta para cualquier discapacidad
                "certificado_minimo": certificado,  # "" = sin mínimo indicado
                "source_url":         link,
                "external_id":        ext_id,
                "fuente":             platform,     # plataforma real de origen
                "estado":             estado
            }

            detalle = tipos or "cualquiera"
            cert = (" · cert " + certificado) if certificado else ""
            if insert_job(payload):
                print("    OK insertada [" + estado + "] (" + platform + " · " + detalle + cert + ")")
                total += 1
            else:
                print("    ERROR al insertar")

    print("\nTotal insertadas: " + str(total))


if __name__ == "__main__":
    main()
