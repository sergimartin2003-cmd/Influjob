"""
IncluJob — Bot de scraping de ofertas de empleo para personas con discapacidad
Fuentes: Indeed España (RSS) — se añadirá Infojobs API cuando esté aprobada
Ejecutado automáticamente por GitHub Actions 3 veces al día
"""

import os
import re
import hashlib
import requests
import feedparser

SB_URL = "https://kqrzdyxziystnsczalus.supabase.co"
SB_KEY = os.environ["SUPABASE_SERVICE_KEY"]

HEADERS = {
    "apikey":        SB_KEY,
    "Authorization": f"Bearer {SB_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal"
}

# Si el título o descripción contiene estas palabras → se publica automáticamente
STRONG_KEYWORDS = [
    "discapacidad", "discapacitad", "diversidad funcional",
    "33%", "45%", "65%",
    "certificado de discapacidad",
    "cupo reservado", "reserva de plaza",
    "personas con discapacidad", "trabajadores con discapacidad",
    "inclusion laboral", "inclusión laboral",
    "certificado de minusvalía"
]

# Si solo contiene estas → queda en pendiente para revisión manual
WEAK_KEYWORDS = [
    "diversidad", "inclusión", "accesible", "adaptado",
    "igualdad de oportunidades"
]

# Fuentes de ofertas — añade más aquí cuando tengas más APIs/RSS
SOURCES = [
    {
        "name": "Indeed España",
        "url":  "https://www.indeed.es/rss?q=discapacidad&sort=date&fromage=7",
    },
    {
        "name": "Indeed España - Remoto",
        "url":  "https://www.indeed.es/rss?q=discapacidad+remoto&sort=date&fromage=7",
    },
    # Cuando tengas la API de Infojobs, añade aquí:
    # {
    #     "name": "Infojobs",
    #     "url": "https://api.infojobs.net/api/7/offer?...",
    #     "type": "api",  # tratamiento diferente
    # }
]

SPANISH_CITIES = [
    "Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao",
    "Zaragoza", "Málaga", "Murcia", "Palma", "Alicante",
    "Valladolid", "Granada", "Córdoba", "Vigo", "Gijón",
    "Remoto", "Teletrabajo"
]


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text).strip()


def clean_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def has_strong_keywords(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in STRONG_KEYWORDS)


def has_weak_keywords(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in WEAK_KEYWORDS)


def get_estado(title: str, description: str) -> str | None:
    full_text = (title + " " + description).lower()
    if has_strong_keywords(full_text):
        return "publicada"
    if has_weak_keywords(full_text):
        return "pendiente"
    return None  # no relevante — no insertar


def external_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:20]


def already_exists(ext_id: str) -> bool:
    r = requests.get(
        f"{SB_URL}/rest/v1/jobs",
        headers={**HEADERS, "Prefer": ""},
        params={"external_id": f"eq.{ext_id}", "select": "id", "limit": "1"}
    )
    return r.ok and len(r.json()) > 0


def extract_city(title: str, location: str = "") -> str:
    combined = (title + " " + location).lower()
    for city in SPANISH_CITIES:
        if city.lower() in combined:
            return city
    if "remoto" in combined or "teletrabajo" in combined or "remote" in combined:
        return "Remoto"
    return location.strip() or "España"


def extract_company(title: str) -> tuple[str, str]:
    """Indeed titles are usually 'Puesto - Empresa'. Returns (puesto, empresa)."""
    if " - " in title:
        parts = title.rsplit(" - ", 1)
        return parts[0].strip(), parts[1].strip()
    return title.strip(), ""


def scrape_rss(source: dict) -> int:
    print(f"\n📡 {source['name']}")
    try:
        feed = feedparser.parse(source["url"])
    except Exception as e:
        print(f"   ✗ Error al obtener feed: {e}")
        return 0

    if not feed.entries:
        print("   ℹ Sin resultados")
        return 0

    inserted = 0
    for entry in feed.entries[:30]:
        title_raw   = entry.get("title", "").strip()
        description = clean_whitespace(strip_html(entry.get("summary", entry.get("description", ""))))
        link        = entry.get("link", "")
        location    = getattr(entry, "location", "")

        if not title_raw or not link:
            continue

        estado = get_estado(title_raw, description)
        if estado is None:
            continue  # oferta no relevante para discapacidad

        ext_id = external_id(link)
        if already_exists(ext_id):
            print(f"   → ya existe: {title_raw[:60]}")
            continue

        puesto, empresa = extract_company(title_raw)
        ciudad = extract_city(title_raw, location)
        modalidad = "remoto" if "remoto" in (puesto + description + ciudad).lower() else "presencial"

        job = {
            "puesto":       puesto[:200],
            "empresa":      empresa or source["name"],
            "ciudad":       ciudad,
            "modalidad":    modalidad,
            "tipo_contrato": "Indefinido",
            "descripcion":  description[:3000],
            "source_url":   link,
            "external_id":  ext_id,
            "fuente":       source["name"],
            "estado":       estado
        }

        r = requests.post(f"{SB_URL}/rest/v1/jobs", headers=HEADERS, json=job)
        if r.ok:
            icon = "✅" if estado == "publicada" else "⏳"
            print(f"   {icon} [{estado}] {puesto[:60]}")
            inserted += 1
        else:
            print(f"   ✗ Error al insertar: {r.status_code} {r.text[:120]}")

    return inserted


# ── Ejecución principal ──────────────────────────────────────────────────────
print("🤖 IncluJob Scraper — inicio")

total = 0
for source in SOURCES:
    total += scrape_rss(source)

print(f"\n✔ Total ofertas nuevas insertadas: {total}")
