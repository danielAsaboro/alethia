import unittest

from scripts.freeze_erb_safety_runtime import freeze_cases
from scripts.run_erb_safety_envelope import lexical_query, version_candidates
from scripts.score_erb_safety_envelope import score


class ErbSafetyEnvelopeTests(unittest.TestCase):
    def test_freeze_discards_every_evaluation_field(self):
        cases = freeze_cases([{
            "question_id": "qst_0001", "question": "What changed?", "source_types": ["jira"],
            "question_type": "basic", "expected_doc_ids": ["secret"], "gold_answer": "secret", "answer_facts": ["secret"],
        }])
        self.assertEqual(cases, [{"id": "qst_0001", "question": "What changed?", "sourceSystems": ["jira"]}])

    def test_query_normalization_and_version_detection_are_deterministic(self):
        self.assertEqual(lexical_query("What is the Regional failover policy?"), "regional failover policy")
        candidates = version_candidates([
            {"rowId": 1, "docId": "d1", "sourceSystem": "jira"},
            {"rowId": 2, "docId": "d1", "sourceSystem": "confluence"},
        ])
        self.assertEqual(candidates, [{"docId": "d1", "rowIds": [1, 2], "sourceSystems": ["confluence", "jira"]}])

    def test_scorer_preserves_zero_intervention_weakness(self):
        runtime = {"summary": {"unsupportedInterventions": 0}, "results": [{
            "caseId": "q1", "retrievedDocumentIds": ["d1"], "documentsRemoved": [], "documentsPinned": [],
            "retrievalChanged": False, "conflictMatch": None, "matchConfidence": None, "policyVerdict": "NO_INTERVENTION",
            "lexicalQueryId": "query-1", "hydraQueryIds": [], "groundingLatencyMs": 1,
        }]}
        report = score(runtime, {"q1": {"expected_doc_ids": ["d1"], "question_type": "basic"}})
        self.assertEqual(report["interventions"], 0)
        self.assertEqual(report["materiallyDegradedContexts"], 0)
        self.assertEqual(report["meanExpectedDocumentRecall"], 1)

    def test_scorer_rejects_duplicate_results_that_hide_a_missing_case(self):
        result = {
            "caseId": "q1", "retrievedDocumentIds": ["d1"], "documentsRemoved": [], "documentsPinned": [],
            "retrievalChanged": False, "conflictMatch": None, "matchConfidence": None, "policyVerdict": "NO_INTERVENTION",
            "lexicalQueryId": "query-1", "hydraQueryIds": [], "groundingLatencyMs": 1,
        }
        labels = {
            "q1": {"expected_doc_ids": ["d1"], "question_type": "basic"},
            "q2": {"expected_doc_ids": ["d2"], "question_type": "basic"},
        }

        with self.assertRaisesRegex(ValueError, "exactly once"):
            score({"summary": {"unsupportedInterventions": 0}, "results": [result, dict(result)]}, labels)

    def test_scorer_recomputes_unsupported_interventions_from_case_rows(self):
        runtime = {"summary": {"unsupportedInterventions": 0}, "results": [{
            "caseId": "q1", "retrievedDocumentIds": ["d1"], "documentsRemoved": ["d1"], "documentsPinned": [],
            "retrievalChanged": True, "conflictMatch": None, "matchConfidence": None, "policyVerdict": "UNKNOWN",
            "lexicalQueryId": "query-1", "hydraQueryIds": [], "groundingLatencyMs": 1,
            "unsupportedIntervention": True,
        }]}

        report = score(runtime, {"q1": {"expected_doc_ids": ["d1"], "question_type": "basic"}})

        self.assertEqual(report["unsupportedInterventions"], 1)
        self.assertEqual(report["interventionsByCategory"], {"basic": 1})


if __name__ == "__main__":
    unittest.main()
