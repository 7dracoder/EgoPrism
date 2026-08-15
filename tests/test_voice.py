from pathlib import Path

import pytest

from src.metrics import ComparisonResult, SubsetScore
from src.voice import VoiceSynthesisError, briefing_script, synthesize_briefing


def _score(name: str, value: float) -> SubsetScore:
    return SubsetScore(
        name=name,
        score=value,
        ci_low=value - 3,
        ci_high=value + 3,
        visual_entropy=0.2 if name == "A" else 0.8,
        motion_entropy=0.2 if name == "A" else 0.7,
        n_episodes=16,
        n_visual_clusters_used=5,
        n_motion_clusters_used=5,
        visual_occupancy={0: 16} if name == "A" else {0: 4, 1: 4, 2: 4, 3: 4},
        motion_occupancy={0: 16} if name == "A" else {0: 8, 1: 8},
    )


def test_briefing_script_is_deterministic_and_not_an_llm():
    result = ComparisonResult(
        task="fold-clothes",
        subset_a=_score("A", 15),
        subset_b=_score("B", 77),
        winner="B",
        statement=(
            "Subset B covers more distinct visual contexts and manipulation "
            "patterns than subset A."
        ),
        data_quality="visual + motion",
        k=5,
        duration_imbalance=False,
        count_imbalance=False,
        visual_only=False,
    )
    text = briefing_script(result)
    assert briefing_script(result) == text
    assert "language model" in text
    assert "77" in text
    assert "guarantees policy success" in text
    assert "fold-clothes" in text


class _Response:
    def __init__(self, status_code=200, content=b"ID3audio", content_type="audio/mpeg"):
        self.status_code = status_code
        self.content = content
        self.headers = {"content-type": content_type}


def test_elevenlabs_request_is_server_side_and_cached(monkeypatch, tmp_path: Path):
    import src.voice as voice

    calls = []

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        return _Response()

    monkeypatch.setattr(voice, "AUDIO_DIR", tmp_path)
    monkeypatch.setattr(voice.requests, "post", fake_post)
    first = synthesize_briefing("Subset B wins.", api_key="test-key")
    second = synthesize_briefing("Subset B wins.", api_key="test-key")

    assert first == second
    assert first.read_bytes() == b"ID3audio"
    assert len(calls) == 1
    url, request = calls[0]
    assert url.endswith("/JBFqnCBsd6RMkjVDRZzb")
    assert request["headers"]["xi-api-key"] == "test-key"
    assert request["params"]["output_format"] == "mp3_44100_128"
    assert request["json"]["model_id"] == "eleven_flash_v2_5"
    assert request["json"]["text"] == "Subset B wins."


def test_elevenlabs_error_does_not_echo_remote_body(monkeypatch, tmp_path: Path):
    import src.voice as voice

    monkeypatch.setattr(voice, "AUDIO_DIR", tmp_path)
    monkeypatch.setattr(
        voice.requests,
        "post",
        lambda *args, **kwargs: _Response(
            status_code=401,
            content=b'{"detail":"sensitive remote body"}',
            content_type="application/json",
        ),
    )
    with pytest.raises(VoiceSynthesisError, match="HTTP 401") as caught:
        synthesize_briefing("Hello", api_key="bad-key")
    assert "sensitive remote body" not in str(caught.value)
