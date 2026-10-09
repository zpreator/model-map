"""Experiment: do HF Hub downloads/trending give sensible top-N per task?"""
import json, sys, urllib.parse, urllib.request
from datetime import datetime, timezone

TASKS = ["image-classification", "image-feature-extraction", "object-detection",
         "zero-shot-object-detection", "image-segmentation", "mask-generation",
         "image-text-to-text", "text-classification", "feature-extraction",
         "sentence-similarity", "text-generation", "text-to-image",
         "automatic-speech-recognition", "audio-classification",
         "voice-activity-detection", "text-to-speech", "video-classification"]
FIELDS = ["downloads", "likes", "tags", "createdAt", "safetensors", "trendingScore",
          "pipeline_tag", "library_name", "gated"]
DERIVED = ("base_model:finetune", "base_model:quantized", "base_model:merge", "base_model:adapter")

def fetch(task, sort, limit):
    q = [("pipeline_tag", task), ("sort", sort), ("direction", "-1"), ("limit", str(limit))]
    q += [("expand[]", f) for f in FIELDS]
    url = "https://huggingface.co/api/models?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)

def keep(m):
    t = m.get("tags", [])
    return not any(x.startswith(DERIVED) for x in t) and "gguf" not in t

def lic(m):
    return next((t[8:] for t in m.get("tags", []) if t.startswith("license:")), "?")

def params(m):
    s = m.get("safetensors") or {}
    return s.get("total")

def fmt_p(p):
    return "?" if not p else (f"{p/1e9:.1f}B" if p >= 1e9 else f"{p/1e6:.0f}M")

def age_days(m):
    d = datetime.fromisoformat(m["createdAt"].replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - d).days

def row(m):
    return f"  {m['id'][:52]:52} dl={m.get('downloads',0):>10,} ♥={m.get('likes',0):>5} {fmt_p(params(m)):>6} {lic(m)[:14]:14} {age_days(m)}d"

out = {}
for t in TASKS:
    try:
        est = fetch(t, "downloads", 100)
        ris = fetch(t, "trendingScore", 100)
    except Exception as e:
        print(f"## {t}: ERROR {e}"); continue
    est_k = [m for m in est if keep(m)]
    ris_k = [m for m in ris if keep(m) and age_days(m) < 365 and m["id"] not in {x["id"] for x in est_k[:5]}]
    print(f"\n## {t}  (raw {len(est)} → {len(est_k)} after filtering derived)")
    print(" Established:"); [print(row(m)) for m in est_k[:5]]
    print(" Rising (<1y):"); [print(row(m)) for m in ris_k[:3]]
    out[t] = {"established": est_k[:5], "rising": ris_k[:3]}
json.dump(out, open("tools/experiment_out.json", "w"), indent=1)
