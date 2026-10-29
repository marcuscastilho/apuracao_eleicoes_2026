import copy
import unittest

from download_data import parse_result


class ResultValidationTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "ele": "6257", "t": "1", "tpabr": "mu", "cdabr": "71072", "f": "o",
            "dv": "s", "tf": "s", "dg": "05/10/2026", "hg": "12:00:00",
            "v": {"vv": "200"}, "carg": [{"cd": "1", "agr": [{"par": [{"cand": [
                {"n": "13", "nmu": "LULA", "vap": "100"},
                {"n": "22", "nmu": "FLAVIO BOLSONARO", "vap": "80"},
                {"n": "55", "nmu": "OUTRO", "vap": "20"},
            ]}]}]}],
        }

    def parse(self, payload=None):
        return parse_result(payload or self.payload, "6257", "1", "71072")

    def test_valid_votes_include_other_candidates(self):
        self.assertEqual(self.parse()["validVotes"], 200)
        self.assertEqual(self.parse()["votes"], {"13": 100, "22": 80})

    def test_identity_mismatch_rejected(self):
        for field in ["ele", "t", "cdabr", "tpabr", "f", "dv"]:
            with self.subTest(field=field):
                payload = copy.deepcopy(self.payload)
                payload[field] = "wrong"
                with self.assertRaises(ValueError):
                    self.parse(payload)

    def test_missing_candidate_not_treated_as_zero(self):
        self.payload["carg"][0]["agr"][0]["par"][0]["cand"].pop(0)
        with self.assertRaises(KeyError):
            self.parse()

    def test_inconsistent_sum_rejected(self):
        self.payload["v"]["vv"] = "201"
        with self.assertRaises(ValueError):
            self.parse()

    def test_partial_is_preserved(self):
        self.payload["tf"] = "n"
        self.assertFalse(self.parse()["final"])

    def test_candidate_name_is_validated(self):
        self.payload["carg"][0]["agr"][0]["par"][0]["cand"][1]["nmu"] = "OTHER"
        with self.assertRaises(ValueError):
            self.parse()


if __name__ == "__main__":
    unittest.main()
