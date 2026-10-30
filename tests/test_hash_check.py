import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import hash_check  # noqa: E402

FIRST = ROOT / "sample_exam.pdf"
needs_first = pytest.mark.skipif(not FIRST.exists(), reason="sample_exam.pdf removed")
HACKATHON_FP = "ee47d1dab3dd41ada1687923306bd864523bf1ac53269fb681e183e6ddc3c581"


@needs_first
def test_hash_matches_the_sealed_file():
    assert hash_check.hash_file(ROOT / "sample_exam.pdf") == HACKATHON_FP


def test_hash_streams_large_files(tmp_path):
    big = tmp_path / "big.bin"
    big.write_bytes(b"\x00" * (3 * hash_check.CHUNK + 7))
    import hashlib
    assert hash_check.hash_file(big) == hashlib.sha256(big.read_bytes()).hexdigest()


@needs_first
def test_verify_is_case_insensitive_and_rejects_junk():
    f = ROOT / "sample_exam.pdf"
    assert hash_check.verify_file(f, HACKATHON_FP.upper())
    assert not hash_check.verify_file(f, "wrongfingerprint123")
    assert not hash_check.verify_file(f, "")


def test_mock_and_tampered_papers_differ():
    a = hash_check.hash_file(ROOT / "samples/physics-midsem-2026.pdf")
    b = hash_check.hash_file(ROOT / "samples/physics-midsem-2026-tampered.pdf")
    assert a != b and a != HACKATHON_FP


@needs_first
def test_create_record_limits_the_name():
    f = ROOT / "sample_exam.pdf"
    assert hash_check.create_record(f, " Physics ")["exam_name"] == "Physics"
    with pytest.raises(ValueError):
        hash_check.create_record(f, "x" * 65)
    with pytest.raises(ValueError):
        hash_check.create_record(f, "   ")


def run(*args, cwd=ROOT):
    return subprocess.run([sys.executable, str(ROOT / "hash_check.py"), *args], cwd=cwd, capture_output=True, text=True)


@needs_first
def test_cli_exit_codes(tmp_path):
    assert run("sample_exam.pdf").stdout.strip() == HACKATHON_FP
    assert run("sample_exam.pdf", "--verify", HACKATHON_FP).returncode == 0
    assert run("sample_exam.pdf", "--verify", "0" * 64).returncode == 1
    assert run("missing.pdf").returncode == 2
    r = run(str(ROOT / "sample_exam.pdf"), "--record", "Physics", cwd=tmp_path)
    assert r.returncode == 0
    assert json.loads((tmp_path / "record.json").read_text())["fingerprint"] == HACKATHON_FP


def test_demo_still_runs():
    r = run()
    assert r.returncode == 0 and "Untampered: True" in r.stdout and "Untampered: False" in r.stdout
