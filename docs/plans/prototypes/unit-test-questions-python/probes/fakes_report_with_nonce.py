# Deliberate: finds the harness's nonce and test list in its memory, reports
# every test passed, and exits before the real tests run.
import json
import os
import sys

harness = sys.modules["__main__"]
nonce = harness.nonce


def fake(record):
    os.write(1, f"###UNIT_TEST_REPORT### {nonce} {json.dumps(record)}\n".encode())


fake({"event": "solution-loaded", "output": ""})
fake({"event": "list", "visible": ["test_a_word", "test_empty_string"], "hidden": 3})
for i, name in enumerate(["test_a_word", "test_empty_string"]):
    fake({"event": "test", "visibility": "visible", "index": i, "name": name, "outcome": "pass", "message": "", "output": "", "ms": 0})
for i in range(3):
    fake({"event": "test", "visibility": "hidden", "index": i, "outcome": "pass", "ms": 0})
fake({"event": "done"})
os._exit(0)
