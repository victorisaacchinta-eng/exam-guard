import hashlib
import json
import datetime

def hash_file(filepath):
    with open(filepath, "rb") as f:
        file_bytes = f.read()
    return hashlib.sha256(file_bytes).hexdigest()

def create_record(filepath, exam_name):
    fingerprint = hash_file(filepath)
    record = {
        "exam_name": exam_name,
        "fingerprint": fingerprint,
        "timestamp": datetime.datetime.now(datetime.UTC).isoformat()
    }
    return record

def verify_file(filepath, known_fingerprint):
    current_fingerprint = hash_file(filepath)
    return current_fingerprint == known_fingerprint

if __name__ == "__main__":
    record = create_record("sample_exam.pdf", "Physics Mid-Sem 2026")
    print(json.dumps(record, indent=2))

    print("Test 1 - checking real file:")
    is_valid = verify_file("sample_exam.pdf", record["fingerprint"])
    print("Untampered:", is_valid)

    print("Test 2 - checking against a wrong fingerprint:")
    is_valid_fake = verify_file("sample_exam.pdf", "wrongfingerprint123")
    print("Untampered:", is_valid_fake)
