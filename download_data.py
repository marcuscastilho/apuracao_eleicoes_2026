"""Download and validate the official TSE presidential municipal snapshots."""

import argparse
import concurrent.futures
import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = "https://resultados.tse.jus.br/oficial"
CYCLE = "ele2026"
ROUNDS = (("6257", "1", "04/10/2026"), ("6258", "2", "25/10/2026"))
UF_CODES = set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split())
CANDIDATES = [
    {"id": "13", "name": "Lula", "party": "PT"},
    {"id": "22", "name": "Flavio Bolsonaro", "party": "PL"},
]


def fetch(path, refresh=False):
    cache = ROOT / "data" / "raw" / path
    if cache.exists() and not refresh:
        return json.loads(cache.read_bytes().decode("utf-8-sig"))
    error = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": "EntreTurnos/1.0"})
            with urllib.request.urlopen(request, timeout=40) as response:
                body = response.read()
            value = json.loads(body.decode("utf-8-sig"))
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(body)
            return value
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            error = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code == 404:
                break
            time.sleep(attempt + 1)
    raise RuntimeError(f"{path}: {error}")


def integer(value):
    if not isinstance(value, str) or not value.isdigit():
        raise ValueError(f"Invalid TSE vote count: {value!r}")
    return int(value)


def parse_result(payload, election, turn, code, scope="mu"):
    if (payload["ele"], payload["t"], payload["tpabr"], payload["cdabr"]) != (
        election, turn, scope, code
    ):
        raise ValueError("Election/turn/municipality identity mismatch")
    if payload["f"] != "o" or payload["dv"] != "s":
        raise ValueError("Not an official disclosed result")
    cargos = [cargo for cargo in payload["carg"] if cargo["cd"] == "1"]
    if len(cargos) != 1:
        raise ValueError("Expected exactly one presidential office")
    candidates = {}
    for group in cargos[0]["agr"]:
        for party in group["par"]:
            for candidate in party["cand"]:
                number = candidate["n"]
                if number in candidates:
                    raise ValueError("Duplicate candidate number")
                candidates[number] = candidate
    votes = {}
    for candidate in CANDIDATES:
        number = candidate["id"]
        actual = candidates[number]
        expected = "LULA" if number == "13" else "FLAVIO BOLSONARO"
        if actual["nmu"].upper() != expected:
            raise ValueError("Candidate identity mismatch")
        votes[number] = integer(actual["vap"])
    valid = integer(payload["v"]["vv"])
    if sum(integer(candidate["vap"]) for candidate in candidates.values()) != valid:
        raise ValueError("Candidate votes do not reconcile with valid votes")
    return {
        "validVotes": valid,
        "votes": votes,
        "final": payload["tf"] == "s",
        "updatedAt": f'{payload["dg"]} {payload["hg"]}',
    }


def result_path(election, uf, code=""):
    return f"{CYCLE}/{election}/dados/{uf.lower()}/{uf.lower()}{code}-c0001-e{election.zfill(6)}-u.json"


def build(refresh=False):
    configs = [fetch(f"{CYCLE}/{election}/config/mun-e{election.zfill(6)}-cm.json", refresh)
               for election, _, _ in ROUNDS]
    mappings = []
    states = {}
    for config in configs:
        mapping = {}
        for state in config["abr"]:
            uf = state["cd"].upper()
            if uf not in UF_CODES:
                continue
            states[uf] = state["ds"].title()
            for city in state["mu"]:
                key = (uf, city["cd"])
                if key in mapping:
                    raise ValueError(f"Duplicate municipality: {key}")
                mapping[key] = city
        mappings.append(mapping)
    keys = sorted(set(mappings[0]) | set(mappings[1]))
    paired_keys = sorted(set(mappings[0]) & set(mappings[1]))
    errors = []

    def load_city(key):
        uf, code = key
        try:
            rounds = []
            for election, turn, _ in ROUNDS:
                path = result_path(election, uf, code)
                rounds.append(parse_result(fetch(path, refresh), election, turn, code))
            return {"uf": uf, "code": code, "name": mappings[0][key]["nm"].title(), "rounds": rounds}
        except (RuntimeError, ValueError, KeyError, TypeError) as exc:
            return {"uf": uf, "code": code, "error": str(exc)}

    cities = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        for index, result in enumerate(executor.map(load_city, paired_keys), 1):
            (errors if "error" in result else cities).append(result)
            if index % 250 == 0 or index == len(paired_keys):
                print(f"{index}/{len(paired_keys)} municipalities; {len(errors)} errors", flush=True)
    if not cities:
        raise RuntimeError("No valid paired municipalities; existing snapshot preserved")
    # Reconcile complete states against the TSE state-level presidential totals.
    validation = []
    for uf in sorted(states):
        selected = [city for city in cities if city["uf"] == uf]
        expected = sum(key[0] == uf for key in keys)
        complete = len(selected) == expected
        for index, (election, turn, _) in enumerate(ROUNDS):
            official = parse_result(fetch(result_path(election, uf), refresh), election, turn, uf.lower(), "uf")
            local = {
                "validVotes": sum(city["rounds"][index]["validVotes"] for city in selected),
                "votes": {candidate["id"]: sum(city["rounds"][index]["votes"][candidate["id"]] for city in selected)
                          for candidate in CANDIDATES},
            }
            matches = local["validVotes"] == official["validVotes"] and local["votes"] == official["votes"]
            validation.append({"uf": uf, "turn": turn, "complete": complete, "matches": matches,
                               "municipalSum": local, "official": official})
            if complete and not matches:
                raise ValueError(f"Municipal totals mismatch TSE state totals for {uf}, turn {turn}; snapshot preserved")
    dataset = {
        "metadata": {
            "year": 2026,
            "sourceUrl": "https://resultados.tse.jus.br/oficial/app/index.html#/eleicao/6257/uf/br/cargo/1/vis/nominal/resultados",
            "downloadedAt": datetime.now(timezone.utc).isoformat(),
            "rounds": [{"id": election, "turn": turn, "date": date} for election, turn, date in ROUNDS],
            "coverage": {"expected": len(keys), "paired": len(cities), "excluded": len(keys) - len(cities), "errors": len(errors)},
            "states": [{"uf": uf, "name": states[uf], "expected": sum(key[0] == uf for key in keys),
                        "paired": sum(city["uf"] == uf for city in cities)} for uf in sorted(states)],
            "exclusions": "Exterior (ZZ) excluido. DF mantido como unidade eleitoral do TSE.",
            "cachePolicy": "Arquivos brutos locais reutilizados; --refresh baixa novamente.",
            "unpaired": [{"uf": uf, "code": code} for uf, code in keys if (uf, code) not in set(paired_keys)],
            "failures": errors,
        },
        "candidates": CANDIDATES,
        "cities": cities,
    }
    target = ROOT / "data" / "elections.json"
    body = json.dumps(dataset, ensure_ascii=True, separators=(",", ":")).encode()
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(body)
    temporary.replace(target)
    report = {"sha256": hashlib.sha256(body).hexdigest(), "coverage": dataset["metadata"]["coverage"],
              "states": validation}
    (ROOT / "data" / "validation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"coverage": report["coverage"], "sha256": report["sha256"]}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="Fetch all sources again instead of reusing the local raw cache")
    build(parser.parse_args().refresh)
