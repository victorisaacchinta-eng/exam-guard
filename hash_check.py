"""Fingerprint and check exam papers from the command line.

    python3 hash_check.py paper.pdf                    # print the SHA-256
    python3 hash_check.py paper.pdf --verify <sha256>  # exit 0 if it matches, 1 if not
    python3 hash_check.py paper.pdf --record "Physics Mid-Sem 2026"   # write record.json

With no arguments it runs the original two-check demo on the mock paper.
"""

import argparse
import datetime
import hashlib
import json
import re
import sys
from pathlib import Path

CHUNK = 1024 * 1024
FINGERPRINT_RE = re.compile(r"^[0-9a-f]{64}$")
METADATA_TEXT_MAX = 64  # bytes, Cardano's limit for one metadata string


def hash_file(filepath):
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def create_record(filepath, exam_name):
    name = exam_name.strip()
    if not name:
        raise ValueError("exam name is empty")
    if len(name.encode("utf-8")) > METADATA_TEXT_MAX:
        raise ValueError(f"exam name is over {METADATA_TEXT_MAX} bytes, too long for Cardano metadata")
    return {
        "exam_name": name,
        "fingerprint": hash_file(filepath),
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
    }


def verify_file(filepath, known_fingerprint):
    known = known_fingerprint.strip().lower()
    if not FINGERPRINT_RE.match(known):
        return False
    return hash_file(filepath) == known


def demo():
    sample = Path(__file__).resolve().parent / "samples" / "physics-midsem-2026.pdf"
    record = create_record(sample, "Physics Mid-Semester 2026 (mock)")
    print(json.dumps(record, indent=2))
    print("Test 1 - checking the real file:")
    print("Untampered:", verify_file(sample, record["fingerprint"]))
    print("Test 2 - checking against a wrong fingerprint:")
    print("Untampered:", verify_file(sample, "wrongfingerprint123"))


def main(argv=None):
    p = argparse.ArgumentParser(description="Fingerprint and check exam papers.")
    p.add_argument("file", nargs="?")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--verify", metavar="SHA256", help="compare the file with this fingerprint")
    g.add_argument("--record", metavar="EXAM_NAME", help="write record.json for push_to_chain.js")
    args = p.parse_args(argv)

    if not args.file:
        demo()
        return 0
    if not Path(args.file).is_file():
        print(f"No such file: {args.file}", file=sys.stderr)
        return 2
    if args.verify:
        ok = verify_file(args.file, args.verify)
        print("match" if ok else "no match")
        return 0 if ok else 1
    if args.record:
        try:
            record = create_record(args.file, args.record)
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 2
        Path("record.json").write_text(json.dumps(record) + "\n")
        print(json.dumps(record, indent=2))
        return 0
    print(hash_file(args.file))
    return 0


if __name__ == "__main__":
    sys.exit(main())
