import json
import tempfile
import unittest
from pathlib import Path

from scripts.fetch_erb_evidence import (
    EvidenceSelection,
    acquire_documents,
    load_conflict_selection,
    load_alignment_selection,
)


QUESTIONS = (
    Path(__file__).resolve().parents[2]
    / "resources"
    / "EnterpriseRAG-Bench"
    / "questions.jsonl"
)


class FetchErbEvidenceTest(unittest.TestCase):
    @unittest.skipUnless(QUESTIONS.is_file(), "private canonical ERB corpus is unavailable")
    def test_conflict_selection_has_twenty_questions_and_39_unique_documents(self):
        selection = load_conflict_selection(QUESTIONS)

        self.assertEqual(len(selection.question_ids), 20)
        self.assertEqual(len(selection.document_ids), 39)

    def test_selection_rejects_duplicate_question_ids(self):
        row = (
            '{"question_id":"qst_1","question_type":"conflicting_info",'
            '"expected_doc_ids":["doc_1"]}\n'
        )
        with tempfile.TemporaryDirectory() as directory:
            questions = Path(directory) / "questions.jsonl"
            questions.write_text(row + row, encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "duplicate question_id"):
                load_conflict_selection(questions)

    def test_alignment_selection_preserves_schema_terms_but_not_answers(self):
        row = {
            "question_id": "qst_1",
            "question_type": "metadata",
            "source_types": ["hubspot"],
            "question": "Who is the opportunity owner?",
            "expected_doc_ids": ["doc_1"],
            "gold_answer": "Secret Person",
            "answer_facts": ["Secret Person owns it"],
        }
        with tempfile.TemporaryDirectory() as directory:
            questions = Path(directory) / "questions.jsonl"
            questions.write_text(json.dumps(row) + "\n", encoding="utf-8")

            selection = load_alignment_selection(questions)

            self.assertEqual(selection.alignment_observations, ({
                "questionId": "qst_1",
                "documentId": "doc_1",
                "sourceSystem": "hubspot",
                "objectType": "opportunity",
                "surface": "owner",
                "contextualRole": "sales_opportunity",
            },))
            self.assertNotIn("Secret Person", json.dumps(selection.alignment_observations))

    def test_acquisition_deduplicates_byte_equivalent_dataset_rows(self):
        selection = EvidenceSelection(
            mode="conflicts",
            question_ids=("question_1",),
            document_ids=("doc_1", "doc_2"),
            selection_rule="test",
        )
        row = {
            "doc_id": "doc_1",
            "source_type": "jira",
            "title": "Ticket",
            "content": "Canonical body",
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = acquire_documents(
                selection,
                [row, dict(row), {**row, "doc_id": "doc_2"}],
                root / "evidence.jsonl",
                root / "manifest.json",
            )

            self.assertEqual(manifest["resolvedDocumentIds"], ["doc_1", "doc_2"])
            self.assertEqual(manifest["duplicateRowCounts"], {"doc_1": 1})

    def test_acquisition_preserves_divergent_versions_under_one_document_id(self):
        selection = EvidenceSelection(
            mode="conflicts",
            question_ids=("question_1",),
            document_ids=("doc_1", "doc_2"),
            selection_rule="test",
        )
        first = {
            "doc_id": "doc_1",
            "source_type": "jira",
            "title": "Ticket",
            "content": "72 hour grace period",
        }
        second = {**first, "content": "5 business day grace period"}
        final = {**first, "doc_id": "doc_2", "content": "Other evidence"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "evidence.jsonl"
            manifest = acquire_documents(
                selection,
                [first, second, final],
                output,
                root / "manifest.json",
            )

            records = [json.loads(line) for line in output.read_text().splitlines()]
            self.assertEqual(len(records), 3)
            self.assertEqual(manifest["resolvedDocumentIds"], ["doc_1", "doc_2"])
            self.assertEqual(manifest["divergentVersionCounts"], {"doc_1": 2})


if __name__ == "__main__":
    unittest.main()
