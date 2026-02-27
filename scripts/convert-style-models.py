#!/usr/bin/env python3
"""
Convert Magenta arbitrary style transfer models to modern TF.js graph model format.

Downloads the pretrained style predictor and transformer models from
Google Storage (old TF.js FrozenModel format: .pb + weights_manifest.json +
binary shards) and converts them to modern TF.js GraphModel format
(model.json + binary shards) compatible with tf.loadGraphModel().

The old format stored graph topology in a binary .pb protobuf and weights
metadata in a separate weights_manifest.json. The modern format merges the
graph topology (as JSON) and the weights manifest into a single model.json.

Source models:
  Predictor  (~9.5 MB): gs://magentadata/js/checkpoints/style/arbitrary/predictor/
  Transformer (~7.8 MB): gs://magentadata/js/checkpoints/style/arbitrary/transformer/

Output:
  public/models/style_predictor/model.json   + weight shard .bin files
  public/models/style_transformer/model.json + weight shard .bin files
"""

import json
import os
import pathlib
import shutil
import tempfile
import urllib.request

import google.protobuf.json_format as json_format
import tensorflow as tf
from tensorflow.core.framework import graph_pb2

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

BASE_URL = "https://storage.googleapis.com/magentadata/js/checkpoints/style/arbitrary"

MODELS = {
    "style_predictor": {
        "url": f"{BASE_URL}/predictor",
        "shards": ["group1-shard1of3", "group1-shard2of3", "group1-shard3of3"],
        "output_dir": PROJECT_ROOT / "public" / "models" / "style_predictor",
    },
    "style_transformer": {
        "url": f"{BASE_URL}/transformer",
        "shards": ["group1-shard1of2", "group1-shard2of2"],
        "output_dir": PROJECT_ROOT / "public" / "models" / "style_transformer",
    },
}

# The format version string for modern TF.js graph models
TFJS_FORMAT = "graph-model"
TFJS_GENERATED_BY = "TensorFlow.js Converter"
TFJS_CONVERTED_BY = "cvlt-tools convert-style-models.py"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def download_file(url: str, dest: pathlib.Path) -> None:
    """Download a file from *url* to *dest*, showing progress."""
    print(f"  Downloading {url} ...")
    urllib.request.urlretrieve(url, str(dest))
    size_kb = dest.stat().st_size / 1024
    print(f"    -> {dest.name} ({size_kb:.1f} KB)")


def read_graph_def(pb_path: pathlib.Path) -> graph_pb2.GraphDef:
    """Read a TensorFlow GraphDef from a binary .pb file."""
    graph_def = graph_pb2.GraphDef()
    with open(pb_path, "rb") as f:
        graph_def.ParseFromString(f.read())
    return graph_def


def graph_def_to_json(graph_def: graph_pb2.GraphDef) -> dict:
    """Convert a GraphDef protobuf to a JSON-serialisable dict.

    Uses protobuf's built-in JSON serialisation, which is exactly
    what TF.js expects for the ``modelTopology`` field.
    """
    return json.loads(json_format.MessageToJson(graph_def))


def build_model_json(
    graph_def: graph_pb2.GraphDef,
    weights_manifest: list,
) -> dict:
    """Build a modern TF.js graph-model ``model.json`` structure.

    Parameters
    ----------
    graph_def : GraphDef
        The frozen graph definition read from the .pb file.
    weights_manifest : list
        The weights manifest loaded from the old weights_manifest.json.
        Each entry has ``paths`` (list of shard filenames) and ``weights``
        (list of dicts with name/shape/dtype).

    Returns
    -------
    dict
        A JSON-serialisable dict ready to be written as model.json.
    """
    topology = graph_def_to_json(graph_def)

    # Rename shard files to use .bin extension (modern convention)
    for group in weights_manifest:
        group["paths"] = [p + ".bin" for p in group["paths"]]

    return {
        "format": TFJS_FORMAT,
        "generatedBy": TFJS_GENERATED_BY,
        "convertedBy": TFJS_CONVERTED_BY,
        "modelTopology": topology,
        "weightsManifest": weights_manifest,
    }


# ---------------------------------------------------------------------------
# Main conversion logic
# ---------------------------------------------------------------------------
def convert_model(name: str, config: dict) -> None:
    """Download and convert a single model."""
    url = config["url"]
    shards = config["shards"]
    output_dir = config["output_dir"]

    print(f"\n{'='*60}")
    print(f"Converting model: {name}")
    print(f"  Source : {url}")
    print(f"  Output : {output_dir}")
    print(f"{'='*60}")

    with tempfile.TemporaryDirectory(prefix=f"cvlt_{name}_") as tmp:
        tmp_path = pathlib.Path(tmp)

        # 1. Download all source files
        print("\n[1/3] Downloading source files ...")
        pb_file = tmp_path / "tensorflowjs_model.pb"
        manifest_file = tmp_path / "weights_manifest.json"
        download_file(f"{url}/tensorflowjs_model.pb", pb_file)
        download_file(f"{url}/weights_manifest.json", manifest_file)
        for shard in shards:
            download_file(f"{url}/{shard}", tmp_path / shard)

        # 2. Read and parse source files
        print("\n[2/3] Parsing graph definition and weights manifest ...")
        graph_def = read_graph_def(pb_file)
        print(f"  Graph nodes: {len(graph_def.node)}")

        with open(manifest_file, "r") as f:
            weights_manifest = json.load(f)
        total_weights = sum(len(g["weights"]) for g in weights_manifest)
        print(f"  Weight entries: {total_weights}")
        print(f"  Shard files: {len(shards)}")

        # 3. Build model.json and write output
        print("\n[3/3] Writing modern TF.js graph model ...")
        os.makedirs(output_dir, exist_ok=True)

        model_json = build_model_json(graph_def, weights_manifest)
        model_json_path = output_dir / "model.json"
        with open(model_json_path, "w") as f:
            json.dump(model_json, f)
        print(f"  Wrote {model_json_path.name} ({model_json_path.stat().st_size / 1024:.1f} KB)")

        # Copy binary weight shards (rename to .bin extension)
        for shard in shards:
            src = tmp_path / shard
            dst = output_dir / (shard + ".bin")
            shutil.copy2(src, dst)
            print(f"  Copied {dst.name} ({dst.stat().st_size / 1024:.1f} KB)")

    # Report total size
    total_bytes = 0
    for f in output_dir.iterdir():
        size = f.stat().st_size
        total_bytes += size
    print(f"\n  Total model size: {total_bytes / (1024 * 1024):.1f} MB")
    print(f"  Model saved to {output_dir}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("Magenta Style Transfer Model Converter")
    print("Converts old TF.js FrozenModel format -> modern TF.js GraphModel format")

    for name, config in MODELS.items():
        convert_model(name, config)

    print("\n" + "=" * 60)
    print("All models converted successfully!")
    print("=" * 60)
