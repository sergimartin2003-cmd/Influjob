"""
IncluJob — Bot de scraping de ofertas para personas con discapacidad
Fuentes: Infojobs RSS, Trabajo.gob.es, y otras fuentes públicas españolas
"""

import os
import re
import hashlib
import requests
import xml.etree.ElementTree as ET
from datetime import datetime

SB_URL = "https://kqrzdyxziystnsczalus.supabase.co"
SB_KEY = os.environ["SUPABASE_SERVICE_KEY"]

SB_HEADERS = {
    "apikey":        SB_KEY,
    "Authorization": f"Bearer {SB_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal"
}

# Headers para parecer un navegador real
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "es-ES,es;q=0.9",
    "Cache-Control": "no-cache",
}

STRONG_KEYWORDS = [
    "discapacidad", "discapacitad", "diversidad funcional",
    "33%", "45%", "65%",
    "certificado de discapacidad",
    "cupo reservado", "reserva de plaza",
    "personas con discapacidad", "trabajadores con discapacidad",
    "inclusion laboral", "inclusión laboral",
    "minusvalia", "minusvalía"
]

WEAK_KEYWORDS = [
    "diversidad", "inclusión", "accesible", "adaptado",
    "igualdad de oportunidades", "sin discriminacion"
]

# Fuentes RSS — todas accesibles públicamente sin API key
SOURCES = [
    {
        "name": "Infojobs - Discapacidad",
        "url":  "https://www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=discapacidad&rss=true",
    },
    {
        "name": "Infojobs - Certificado discapacidad",
        "url":  "https://www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=certificado+discapacidad&rss=true",
    },
    {
        "name": "Infoempleo - Discapacidad",
        "url":  "https://www.infoempleo.com/w/rss/ofertas/?q=discapacidad",
    },
    # Cuando tengas API de Infojobs aprobada, añade aquí el endpoint oficial
]

SPANISH_CITIES = [
    "Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao",
    "Zaragoza", "Málaga", "Murcia", "Palma", "Alicante",
    "Valladolid", "Granada", "Córdoba", "Vigo", "Gijón",
    "Remoto", "Teletrabajo", "A Coruña", "Santander", "Burgos"
]


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "").strip()


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", strip_html(text)).strip()


def has_strong(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in STRONG_KEYWORDS)


def has_weak(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in WEAK_KEYWORDS)


def get_estado(title: str, description: str):
    full = (title + " " + description).lower()
    if has_strong(full):
        return "publicada"
    if has_weak(full):
        return "pendiente"
    return None


def make_id(url: str) -> str:
    return hashlib.md5(url.encode()).hexdigest()[:20]


def exists(ext_id: str) -> bool:
    r = requests.get(
        f"{SB_URL}/rest/v1/jobs",
        headers={**SB_HEADERS, "Prefer": ""},
        params={"external_id": f"eq.{ext_id}", "select": "id", "limit": "1"}
    )
    return r.ok and len(r.json()) > 0


def city_from(text: str) -> str:
    t = text.lower()
    for c in SPANISH_CITIES:
        if c.lower() in t:
            return c
    if "remoto" in t or "teletrabajo" in t or "remote" in t:
        return "Remoto"
    return "España"


def fetch_rss(url: str):
    """Fetch RSS XML and return list of (title, description, link) tuples."""
    try:
        r = requests.get(url, headers=BROWSER_HEADERS, timeout=20)
        r.raise_for_status()
    except Exception as e:
        print(f"   ✗ Error HTTP: {e}")
        return []

    try:
        root = ET.fromstring(r.content)
    except ET.ParseError as e:
        print(f"   ✗ Error XML: {e}")
        return []

    # Namespace handling
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    items = root.findall(".//item") or root.findall(".//atom:entry", ns)
    print(f"   Entradas recibidas: {len(items)}")

    entries = []
    for item in items:
        def get(tag):
            el = item.find(tag)
            return (el.text or "") if el is not None else ""

        title = clean_text(get("title"))
        desc  = clean_text(get("description") or get("summary"))
        link  = get("link").strip() or get("guid").strip()
        entries.append((title, desc, link))
    return entries


def scrape(source: dict) -> int:
    print(f"\n📡 {source['name']}")
    entries = fetch_rss(source["url"])
    if not entries:
        return 0

    inserted = 0
    for title, desc, link in entries[:30]:
        if not title or not link:
            continue

        estado = get_estado(title, desc)
        print(f"   [{estado or 'descartada'}] {title[:70]}")
        if estado is None:
            continue

        ext_id = make_id(link)
        if exists(ext_id):
            print(f"      → ya existe")
            continue

        puesto = title
        empresa = source["name"]
        if " - " in title:
            parts = title.rsplit(" - ", 1)
            puesto  = parts[0].strip()
            empresa = parts[1].strip()

        ciudad    = city_from(title + " " + desc)
        modalidad = "remoto" if "remoto" in (title + desc).lower() else "presencial"

        job = {
            "puesto":        puesto[:200],
            "empresa":       empresa,
            "ciudad":        ciudad,
            "modalidad":     modalidad,
            "tipo_contrato": "Indefinido",
            "descripcion":   desc[:3000],
            "source_url":    link,
            "external_id":   ext_id,
            "fuente":        source["name"],
            "estado":        estado
        }

        r = requests.post(f"{SB_URL}/rest/v1/jobs", headers=SB_HEADERS, json=job)
        if r.ok:
            icon = "✅" if estado == "publicada" else "⏳"
            print(f"      {icon} insertada")
            inserted += 1
        else:
            print(f"      ✗ Error Supabase: {r.status_code} {r.text[:100]}")

    return inserted


# ── Main ─────────────────────────────────────────────────────────────────────
print(f"🤖 IncluJob Scraper — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
total = sum(scrape(s) for s in SOURCES)
print(f"\n✔ Total insertadas: {total}")
