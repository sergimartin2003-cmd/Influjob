"""
IncluJob — Bot de scraping via Adzuna API (España)
Busca ofertas para personas con discapacidad y las sube a Supabase
"""

import sys
import os
import re
import hashlib
import requests
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")

SB_URL = "https://kqrzdyxziystnsczalus.supabase.co"
SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxcnpkeXh6aXlzdG5zY3phbHVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzkyMTUsImV4cCI6MjA5NDg1NTIxNX0.9vJRL0AN-u56Qs_DlbI7N-QMddkR6XIj3thRrWkxTEw"

ADZUNA_ID  = "bef3158f"
ADZUNA_KEY = "a5e39157fcf4336140585f0ca2d2c722"

SB_HEADERS = {
    "apikey":        SB_KEY,
    "Authorization": f"Bearer {SB_KEY}",
    "Content-Type":  "application/json",
    "Prefer":        "return=minimal"
}

STRONG_KEYWORDS = [
    "discapacidad", "discapacitad", "diversidad funcional",
    "33%", "45%", "65%", "certificado de discapacidad",
    "cupo reservado", "reserva de plaza",
    "personas con discapacidad", "trabajadores con discapacidad",
    "minusvalia", "minusvalía", "inclusion laboral", "inclusión laboral"
]

WEAK_KEYWORDS = [
    "diversidad", "inclusión", "accesible", "adaptado",
    "igualdad de oportunidades"
]

SEARCHES = [
    "discapacidad",
    "certificado discapacidad empleo",
    "personas discapacidad trabajo",
]

SPANISH_CITIES = [
    "Madrid", "Barcelona", "Valencia", "Sevilla", "Bilbao",
    "Zaragoza", "Málaga", "Murcia", "Palma", "Alicante",
    "Valladolid", "Granada", "Córdoba", "Vigo", "Gijón",
    "Remoto", "Teletrabajo", "A Coruña", "Santander"
]


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text or "")).strip()


def get_estado(title: str, description: str):
    full = (title + " " + description).lower()
    if any(kw in full for kw in STRONG_KEYWORDS):
        return "publicada"
    if any(kw in full for kw in WEAK_KEYWORDS):
        return "pendiente"
    return None


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


def search_adzuna(query: str, page: int = 1) -> list:
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
        return r.json().get("results", [])
    except Exception as e:
        print("Error Adzuna: " + str(e))
        return []


def insert_job(job: dict) -> bool:
    r = requests.post(f"{SB_URL}/rest/v1/jobs", headers=SB_HEADERS, json=job)
    return r.ok


# ── Main ─────────────────────────────────────────────────────────────────────
print("IncluJob Scraper - " + datetime.now().strftime("%Y-%m-%d %H:%M"))

seen_ids = set()
total = 0

for query in SEARCHES:
    print("\nBuscando: " + query)
    results = search_adzuna(query)
    print("Resultados: " + str(len(results)))

    for job in results:
        title    = clean(job.get("title", ""))
        desc     = clean(job.get("description", ""))
        company  = clean(job.get("company", {}).get("display_name", ""))
        location = clean(job.get("location", {}).get("display_name", ""))
        link     = job.get("redirect_url", str(job.get("id", "")))
        salary_min = job.get("salary_min")
        salary_max = job.get("salary_max")

        if not title:
            continue

        estado = get_estado(title, desc)
        print("  [" + (estado or "descartada") + "] " + title[:65])
        if estado is None:
            continue

        ext_id = make_id(str(job.get("id", link)))
        if ext_id in seen_ids or exists(ext_id):
            print("    -> ya existe")
            continue
        seen_ids.add(ext_id)

        salario = ""
        if salary_min and salary_max:
            salario = str(int(salary_min)) + " - " + str(int(salary_max)) + " EUR/anio"
        elif salary_min:
            salario = "Desde " + str(int(salary_min)) + " EUR/anio"

        modalidad = "remoto" if "remoto" in (title + desc + location).lower() else "presencial"
        ciudad = city_from(location, title)

        payload = {
            "puesto":        title[:200],
            "empresa":       company or "Empresa confidencial",
            "ciudad":        ciudad,
            "modalidad":     modalidad,
            "tipo_contrato": "Indefinido",
            "salario":       salario,
            "descripcion":   desc[:3000],
            "source_url":    link,
            "external_id":   ext_id,
            "fuente":        "Adzuna",
            "estado":        "pendiente"
        }

        if insert_job(payload):
            print("    OK insertada [" + estado + "]")
            total += 1
        else:
            print("    ERROR al insertar")

print("\nTotal insertadas: " + str(total))
