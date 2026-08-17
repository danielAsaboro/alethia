import hashlib
import tempfile
import unittest
from pathlib import Path

from scripts.build_erb_lexical_index import file_sha256, parse_args


class BuildErbLexicalIndexTests(unittest.TestCase):
    def test_file_sha256_streams_exact_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "input.parquet"
            target.write_bytes(b"canonical-records")
            self.assertEqual(file_sha256(target), hashlib.sha256(b"canonical-records").hexdigest())

    def test_parse_args_requires_all_artifacts(self):
        args = parse_args([
            "--input", "documents.parquet",
            "--database", "index.duckdb",
            "--ontology-ledger", "ontology.json",
            "--output", "report.json",
            "--reuse-existing",
        ])
        self.assertEqual(args.input, Path("documents.parquet"))
        self.assertTrue(args.reuse_existing)
        with self.assertRaises(SystemExit):
            parse_args(["--input", "documents.parquet"])


if __name__ == "__main__":
    unittest.main()
