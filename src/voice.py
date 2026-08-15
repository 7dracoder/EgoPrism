from __future__ import annotations

import hashlib
import os
from pathlib import Path

import requests

from src.metrics import ComparisonResult
from src.paths import ARTIFACT_DIR

DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"  # George — calm documentary
DEFAULT_MODEL_ID = "eleven_flash_v2_5"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"
AUDIO_DIR = ARTIFACT_DIR / "audio"


class VoiceSynthesisError(RuntimeError):
    pass


def briefing_script(result: ComparisonResult) -> str:
    """Deterministic spoken copy of the ranking. Not an LLM rewrite."""
    a, b = result.subset_a, result.subset_b
    quality = (
        "image and motion coverage"
        if not result.visual_only
        else "image coverage only"
    )
    size_description = (
        "similarly sized"
        if result.count_imbalance or result.duration_imbalance
        else "equal-sized"
    )
    lines = [
        f"We compare {size_description} {result.task} subsets from the same task.",
        f"The score uses {quality}, not text or a language model.",
        (
            f"Subset A scores {a.score:.0f}, "
            f"with a ninety five percent interval from {a.ci_low:.0f} to {a.ci_high:.0f}."
        ),
        (
            f"Subset B scores {b.score:.0f}, "
            f"from {b.ci_low:.0f} to {b.ci_high:.0f}."
        ),
        result.statement,
    ]
    if result.winner in ("A", "B"):
        lines.append(
            "The extra coverage is visible in the cluster plot and the novel episodes below."
        )
    lines.append(
        "This is a data-selection signal, not a claim that it automatically guarantees policy success."
    )
    return " ".join(lines)


def api_key_from_env() -> str:
    return (
        os.environ.get("ELEVENLABS_API_KEY", "").strip()
        or os.environ.get("ELEVEN_API_KEY", "").strip()
    )


def cache_path(
    script: str,
    voice_id: str,
    model_id: str = DEFAULT_MODEL_ID,
    output_format: str = DEFAULT_OUTPUT_FORMAT,
) -> Path:
    digest = hashlib.sha256(
        f"{voice_id}:{model_id}:{output_format}:{script}".encode()
    ).hexdigest()[:16]
    return AUDIO_DIR / f"briefing_{digest}.mp3"


def synthesize_briefing(
    script: str,
    *,
    api_key: str,
    voice_id: str = DEFAULT_VOICE_ID,
    model_id: str = DEFAULT_MODEL_ID,
    output_format: str = DEFAULT_OUTPUT_FORMAT,
) -> Path:
    if not api_key:
        raise ValueError("missing ElevenLabs API key")
    voice_id = os.environ.get("EGOPRISM_ELEVEN_VOICE_ID", "").strip() or voice_id
    model_id = os.environ.get("EGOPRISM_ELEVEN_MODEL_ID", "").strip() or model_id
    dest = cache_path(script, voice_id, model_id, output_format)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    try:
        response = requests.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            params={"output_format": output_format},
            headers={
                "xi-api-key": api_key,
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
            },
            json={
                "text": script,
                "model_id": model_id,
                "voice_settings": {
                    "stability": 0.62,
                    "similarity_boost": 0.78,
                    "style": 0.08,
                    "use_speaker_boost": True,
                    "speed": 1.0,
                },
            },
            timeout=60,
        )
    except requests.RequestException as exc:
        raise VoiceSynthesisError("Could not reach ElevenLabs. Try again in a moment.") from exc
    if response.status_code >= 400:
        raise VoiceSynthesisError(
            f"ElevenLabs returned HTTP {response.status_code}. Check the key, quota, and voice access."
        )
    content_type = response.headers.get("content-type", "")
    if not response.content or (content_type and "audio" not in content_type.lower()):
        raise VoiceSynthesisError("ElevenLabs returned an unexpected non-audio response.")
    temp = dest.with_suffix(".tmp")
    temp.write_bytes(response.content)
    temp.replace(dest)
    return dest
