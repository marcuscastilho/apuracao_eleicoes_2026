"""Capture IBGE municipal maps and a validated TSE-to-IBGE identity index."""

import argparse
import concurrent.futures
import gzip
import hashlib
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
IBGE = {
    "RO": "11", "AC": "12", "AM": "13", "RR": "14", "PA": "15", "AP": "16",
    "TO": "17", "MA": "21", "PI": "22", "CE": "23", "RN": "24", "PB": "25",
    "PE": "26", "AL": "27", "SE": "28", "BA": "29", "MG": "31", "ES": "32",
    "RJ": "33", "SP": "35", "PR": "41", "SC": "42", "RS": "43", "MS": "50",
    "MT": "51", "GO": "52", "DF": "53",
}
URL = "https://servicodados.ibge.gov.br/api/v3/malhas/estados/{}?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio"


def read_json(path):
    return json.loads(path.read_bytes().decode("utf-8-sig"))


def validate_geometry(geojson, uf):
    if geojson.get("type") != "FeatureCollection" or not geojson.get("features"):
        raise ValueError(f"Invalid feature collection: {uf}")
    codes = []
    for feature in geojson["features"]:
        code = feature["properties"]["codarea"]
        if not isinstance(code, str) or len(code) != 7 or not code.isdigit() or not code.startswith(IBGE[uf]):
            raise ValueError(f"Invalid geographic municipality identifier: {uf}/{code}")
        if feature["geometry"]["type"] not in ("Polygon", "MultiPolygon"):
            raise ValueError(f"Unsupported geometry: {uf}/{code}")
        codes.append(code)
    if len(codes) != len(set(codes)):
        raise ValueError(f"Duplicate geographic codes: {uf}")
    return set(codes)


def load_index():
    mappings = []
    for election in ("6257", "6258"):
        config = read_json(DATA / "raw" / "ele2026" / election / "config" / f"mun-e{election.zfill(6)}-cm.json")
        mapping = {}
        for state in config["abr"]:
            uf = state["cd"].upper()
            if uf not in IBGE:
                continue
            for city in state["mu"]:
                key = (uf, city["cd"])
                code = city["cdi"]
                if key in mapping:
                    raise ValueError(f"Duplicate TSE identity: {key}")
                if len(code) != 7 or not code.isdigit() or not code.startswith(IBGE[uf]):
                    raise ValueError(f"Invalid TSE IBGE identity: {key}/{code}")
                mapping[key] = {"uf": uf, "code": city["cd"], "ibge": code, "name": city["nm"].title()}
        mappings.append(mapping)
    dataset = read_json(DATA / "elections.json")
    rows = []
    for city in dataset["cities"]:
        key = (city["uf"], city["code"])
        a, b = mappings[0][key], mappings[1][key]
        if a["ibge"] != b["ibge"]:
            raise ValueError(f"IBGE identity differs between turns: {key}")
        rows.append(a)
    if len({(row["uf"], row["ibge"]) for row in rows}) != len(rows):
        raise ValueError("Non-unique TSE/IBGE municipality association")
    return rows


def download(uf, refresh):
    path = DATA / "municipalities" / f"{uf.lower()}.geojson"
    source = URL.format(IBGE[uf])
    if path.exists() and not refresh:
        body = path.read_bytes()
    else:
        for attempt in range(4):
            try:
                request = urllib.request.Request(source, headers={"User-Agent": "SamuConfere/1.0"})
                with urllib.request.urlopen(request, timeout=60) as response:
                    body = response.read()
                if body[:2] == b"\x1f\x8b":
                    body = gzip.decompress(body)
                validate_geometry(json.loads(body), uf)
                path.write_bytes(body)
                break
            except (OSError, ValueError) as error:
                if attempt == 3:
                    raise RuntimeError(f"IBGE download failed: {uf}: {error}") from error
                time.sleep(attempt + 1)
    identifiers = validate_geometry(json.loads(body), uf)
    return {"uf": uf, "source": source, "file": f"municipalities/{uf.lower()}.geojson",
            "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "identifiers": identifiers}


def build(refresh=False):
    rows = load_index()
    (DATA / "municipalities").mkdir(exist_ok=True)
    reports = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(lambda uf: download(uf, refresh), sorted(IBGE)):
            electoral = {row["ibge"] for row in rows if row["uf"] == result["uf"]}
            geography = result.pop("identifiers")
            result.update({"expected": len(electoral), "areas": len(geography),
                           "mapped": len(electoral & geography),
                           "citiesWithoutGeometry": sorted(electoral - geography),
                           "areasWithoutVotes": sorted(geography - electoral)})
            reports.append(result)
            print(json.dumps(result), flush=True)
    metadata = {
        "downloadedAt": datetime.now(timezone.utc).isoformat(),
        "join": "UF + TSE cd to TSE cdi (same in both turns) to IBGE properties.codarea; no name matching",
        "sourceTSE": ["raw/ele2026/6257/config/mun-e006257-cm.json", "raw/ele2026/6258/config/mun-e006258-cm.json"],
        "sourceIBGE": URL,
    }
    index = {"metadata": metadata, "cities": rows}
    (DATA / "municipality-index.json").write_text(json.dumps(index, ensure_ascii=True, separators=(",", ":")), encoding="utf-8")
    report = {"metadata": metadata, "expected": len(rows), "mapped": sum(row["mapped"] for row in reports), "states": reports}
    (DATA / "municipal-validation.json").write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    print(f'Mapped {report["mapped"]}/{report["expected"]} electoral units; unmatched codes recorded explicitly.', flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    build(parser.parse_args().refresh)
