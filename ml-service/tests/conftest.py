import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture(scope="session")
def artifacts(tmp_path_factory):
    """Tiny model trained through the real pipeline (smoke config, CPU, no baselines)."""
    from fraud_gnn import train
    out = tmp_path_factory.mktemp("gnn_artifacts")
    train.main(["--smoke", "--skip-baselines", "--out", str(out)])
    return out
