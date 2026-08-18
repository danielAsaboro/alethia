import unittest

from scripts.freeze_erb_safety_runtime import freeze_cases
from scripts.run_erb_safety_envelope import (
    apply_conflict_policy,
    build_conflict_anchors,
    discover_conflict_anchor,
    lexical_query,
    version_candidates,
)
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

    def test_discovers_one_complete_source_derived_conflict_anchor_without_case_ids(self):
        extractions = {"cases": [{"extractions": [
            {"sourceObjectId": "source-current", "sourceNativeId": "native-current"},
            {"sourceObjectId": "source-retired", "sourceNativeId": "native-retired"},
        ]}]}
        conflict_runtime = {"labelFree": True, "cases": [{
            "caseId": "development-case-id-must-not-be-used-for_matching",
            "graph": {
                "currentDocumentIds": ["source-current"],
                "supersededDocumentIds": ["source-retired"],
                "conflictDocumentIds": ["source-current", "source-retired"],
                "hydraQueryIds": ["hydra-read-1", "hydra-read-2"],
            },
        }]}

        anchors = build_conflict_anchors(extractions, conflict_runtime)
        match = discover_conflict_anchor(["unrelated", "native-retired", "native-current"], anchors)

        self.assertEqual(match["currentDocumentIds"], ["native-current"])
        self.assertEqual(match["supersededDocumentIds"], ["native-retired"])
        self.assertEqual(match["hydraQueryIds"], ["hydra-read-1", "hydra-read-2"])
        self.assertIsNone(discover_conflict_anchor(["native-current"], anchors))

    def test_applies_only_a_complete_resolved_anchor_and_preserves_unresolved_context(self):
        resolved = {
            "id": "anchor-1",
            "conflictDocumentIds": ["current", "retired"],
            "currentDocumentIds": ["current"],
            "supersededDocumentIds": ["retired"],
            "hydraQueryIds": ["hydra-1", "hydra-2"],
        }
        self.assertEqual(apply_conflict_policy(["other", "retired", "current"], resolved), {
            "retrievalChanged": True,
            "documentsRemoved": ["retired"],
            "documentsPinned": ["current"],
            "conflictMatch": "anchor-1",
            "matchConfidence": 1.0,
            "policyVerdict": "SUPPORTED",
            "hydraQueryIds": ["hydra-1", "hydra-2"],
            "unsupportedIntervention": False,
            "reason": "One complete resolved source-derived conflict anchor matched the retrieved source IDs.",
        })

        unresolved = {**resolved, "currentDocumentIds": [], "supersededDocumentIds": []}
        self.assertFalse(apply_conflict_policy(["retired", "current"], unresolved)["retrievalChanged"])

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

    def test_expected_evidence_removal_is_exempt_only_for_a_proven_conflict(self):
        runtime = {"summary": {"unsupportedInterventions": 0}, "results": [{
            "caseId": "q1", "retrievedDocumentIds": ["d1"], "documentsRemoved": ["d1"], "documentsPinned": [],
            "retrievalChanged": True, "conflictMatch": None, "matchConfidence": None, "policyVerdict": "UNKNOWN",
            "lexicalQueryId": "query-1", "hydraQueryIds": [], "groundingLatencyMs": 1,
            "unsupportedIntervention": True,
        }]}

        report = score(runtime, {"q1": {"expected_doc_ids": ["d1"], "question_type": "conflicting_info"}})

        self.assertEqual(report["expectedEvidenceRemovedOutsideProvenConflicts"], 1)

    def test_proven_conflict_removal_preserves_raw_recall_loss_but_is_not_counted_as_unjustified(self):
        runtime = {"summary": {"unsupportedInterventions": 0}, "results": [{
            "caseId": "q1", "retrievedDocumentIds": ["current", "retired"],
            "documentsRemoved": ["retired"], "documentsPinned": ["current"],
            "retrievalChanged": True, "conflictMatch": "anchor-1", "matchConfidence": 1.0,
            "policyVerdict": "SUPPORTED", "lexicalQueryId": "query-1",
            "hydraQueryIds": ["hydra-1", "hydra-2"], "groundingLatencyMs": 1,
            "unsupportedIntervention": False,
        }]}

        report = score(runtime, {"q1": {
            "expected_doc_ids": ["current", "retired"],
            "question_type": "conflicting_info",
        }})

        self.assertEqual(report["rawExpectedRecallReducedContexts"], 1)
        self.assertEqual(report["materiallyDegradedOutsideProvenConflicts"], 0)
        self.assertEqual(report["justifiedConflictEvidenceRemovals"], 1)


if __name__ == "__main__":
    unittest.main()
