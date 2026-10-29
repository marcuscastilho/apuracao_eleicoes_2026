"""Read-only audit of the local snapshot against freshly captured TSE sources."""

import concurrent.futures
import gzip
import hashlib
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = "https://resultados.tse.jus.br/oficial/"
ROUNDS = [("6257", "1"), ("6258", "2")]
IDS = ("13", "22")
UF_CODES = set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split())


def read(path):
    return json.loads(path.read_bytes().decode("utf-8-sig"))


def integer(value):
    if not isinstance(value, str) or not value.isdigit():
        raise ValueError(f"Invalid integer vote field: {value!r}")
    return int(value)


def extract(payload, election, turn, code, scope):
    identity = (payload["ele"], payload["t"], payload["cdabr"], payload["tpabr"])
    if identity != (election, turn, code, scope):
        raise ValueError(f"Wrong source identity: {identity}")
    if payload["f"] != "o" or payload["dv"] != "s":
        raise ValueError("Source is not an official disclosed result")
    offices = [office for office in payload["carg"] if office["cd"] == "1"]
    if len(offices) != 1:
        raise ValueError("Presidential office is not unique")
    candidates = [candidate for group in offices[0]["agr"]
                  for party in group["par"] for candidate in party["cand"]]
    by_number = {candidate["n"]: candidate for candidate in candidates}
    if len(by_number) != len(candidates):
        raise ValueError("Duplicate candidate number")
    for number, name in [("13", "LULA"), ("22", "FLAVIO BOLSONARO")]:
        if by_number[number]["nmu"].upper() != name:
            raise ValueError("Candidate identity mismatch")
    valid = integer(payload["v"]["vv"])
    if sum(integer(candidate["vap"]) for candidate in candidates) != valid:
        raise ValueError("All candidate votes do not sum to valid votes")
    votes = {number: integer(by_number[number]["vap"]) for number in IDS}
    for number in IDS:
        published = float(by_number[number]["pvapn"].replace(",", "."))
        computed = votes[number] / valid * 100 if valid else 0
        if abs(computed - published) > 1e-7:
            raise ValueError("Published TSE share does not match candidate votes / valid votes")
    return {"validVotes": valid, "votes": votes, "final": payload["tf"] == "s"}


def source_path(election, uf, code=""):
    uf = uf.lower()
    return f"ele2026/{election}/dados/{uf}/{uf}{code}-c0001-e{election.zfill(6)}-u.json"


def capture(path, folder):
    target = folder / path
    error = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(BASE + path, headers={"User-Agent": "SamuConfere-Audit/1.0"})
            with urllib.request.urlopen(request, timeout=45) as response:
                body = response.read()
            if body[:2] == b"\x1f\x8b":
                body = gzip.decompress(body)
            value = json.loads(body.decode("utf-8-sig"))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            return value
        except (OSError, ValueError) as exc:
            error = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code == 404:
                break
            time.sleep(attempt + 1)
    raise RuntimeError(f"{path}: {error}")


def same(local, official):
    return all(local[key] == official[key] for key in ("validVotes", "votes", "final"))


def aggregate(cities, index):
    return {
        "validVotes": sum(city["rounds"][index]["validVotes"] for city in cities),
        "votes": {number: sum(city["rounds"][index]["votes"][number] for city in cities) for number in IDS},
    }


def run():
    started = datetime.now(timezone.utc)
    target = ROOT / "data" / "audit" / started.strftime("%Y%m%dT%H%M%SZ")
    target.mkdir(parents=True)
    official_folder = target / "official"
    snapshot_path = ROOT / "data" / "elections.json"
    snapshot_body = snapshot_path.read_bytes()
    dataset = json.loads(snapshot_body)
    cities = dataset["cities"]
    pairs = {(city["uf"], city["code"]) for city in cities}
    if len(pairs) != len(cities) or {city["uf"] for city in cities} != UF_CODES:
        raise ValueError("Local identity keys duplicated or UF coverage incomplete")
    report = {
        "startedAt": started.isoformat(), "source": BASE, "elections": ROUNDS,
        "snapshotSha256": hashlib.sha256(snapshot_body).hexdigest(),
        "cities": len(cities), "ufCount": len(UF_CODES), "errors": [],
        "rawMismatches": [], "liveMismatches": [], "states": [], "national": [],
    }
    config_maps = []
    for election, _ in ROUNDS:
        config_path = f"ele2026/{election}/config/mun-e{election.zfill(6)}-cm.json"
        config = capture(config_path, official_folder)
        mapping = {}
        for state in config["abr"]:
            uf = state["cd"].upper()
            if uf not in UF_CODES:
                continue
            for city in state["mu"]:
                key = (uf, city["cd"])
                if key in mapping:
                    raise ValueError("Duplicate city in live TSE config")
                mapping[key] = city["cdi"]
        config_maps.append(mapping)
    report["liveConfigPairingMatches"] = pairs == (set(config_maps[0]) & set(config_maps[1]))
    index = read(ROOT / "data" / "municipality-index.json")
    index_pairs = {(row["uf"], row["code"]): row["ibge"] for row in index["cities"]}
    report["ibgeCodesMatchBothLiveTurns"] = all(
        index_pairs.get(key) == config_maps[0].get(key) == config_maps[1].get(key) for key in pairs
    ) and len(index_pairs) == len(pairs)

    jobs = [(city, index, election, turn) for city in cities
            for index, (election, turn) in enumerate(ROUNDS)]

    def check_city(job):
        city, index, election, turn = job
        path = source_path(election, city["uf"], city["code"])
        result = {"uf": city["uf"], "code": city["code"], "turn": turn}
        try:
            original = extract(read(ROOT / "data" / "raw" / path), election, turn, city["code"], "mu")
            result["rawMatches"] = same(city["rounds"][index], original)
            current = extract(capture(path, official_folder), election, turn, city["code"], "mu")
            result["liveMatches"] = same(city["rounds"][index], current)
            if not result["liveMatches"]:
                result["local"] = city["rounds"][index]
                result["official"] = current
        except (RuntimeError, OSError, ValueError, KeyError, TypeError) as error:
            result["error"] = str(error)
        return result

    report["municipalTurnSourcesExpected"] = len(jobs)
    report["municipalTurnSourcesChecked"] = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        for count, result in enumerate(pool.map(check_city, jobs), 1):
            if "error" in result:
                report["errors"].append(result)
            else:
                report["municipalTurnSourcesChecked"] += 1
                if not result["rawMatches"]:
                    report["rawMismatches"].append(result)
                if not result["liveMatches"]:
                    report["liveMismatches"].append(result)
            if count % 1000 == 0 or count == len(jobs):
                print(f'{count}/{len(jobs)} official municipal sources; errors={len(report["errors"])}; live mismatches={len(report["liveMismatches"])}', flush=True)

    for uf in sorted(UF_CODES):
        selected = [city for city in cities if city["uf"] == uf]
        for index, (election, turn) in enumerate(ROUNDS):
            current = extract(capture(source_path(election, uf), official_folder), election, turn, uf.lower(), "uf")
            local = aggregate(selected, index)
            report["states"].append({
                "uf": uf, "turn": turn, "matches": local["votes"] == current["votes"] and local["validVotes"] == current["validVotes"],
                "local": local, "official": current,
            })
    for index, (election, turn) in enumerate(ROUNDS):
        national = extract(capture(source_path(election, "br"), official_folder), election, turn, "br", "br")
        exterior = extract(capture(source_path(election, "zz"), official_folder), election, turn, "zz", "uf")
        domestic = aggregate(cities, index)
        reconstructed = {
            "validVotes": domestic["validVotes"] + exterior["validVotes"],
            "votes": {number: domestic["votes"][number] + exterior["votes"][number] for number in IDS},
        }
        report["national"].append({
            "turn": turn, "domestic": domestic, "exterior": exterior, "officialBrazil": national,
            "domesticPlusExteriorMatchesBrazil": reconstructed["votes"] == national["votes"] and reconstructed["validVotes"] == national["validVotes"],
        })
    report["snapshotUnchanged"] = snapshot_path.read_bytes() == snapshot_body
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    report["passed"] = all([
        not report["errors"], not report["rawMismatches"], not report["liveMismatches"],
        report["liveConfigPairingMatches"], report["ibgeCodesMatchBothLiveTurns"], report["snapshotUnchanged"],
        report["municipalTurnSourcesChecked"] == report["municipalTurnSourcesExpected"],
        all(row["matches"] for row in report["states"]),
        all(row["domesticPlusExteriorMatchesBrazil"] for row in report["national"]),
    ])
    report_path = target / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(report_path), "passed": report["passed"], "checked": report["municipalTurnSourcesChecked"],
                      "errors": len(report["errors"]), "liveMismatches": len(report["liveMismatches"])}), flush=True)
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    run()
