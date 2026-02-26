#!/usr/bin/env python3
"""
Convert InceptionV3 (ImageNet, no top) to TensorFlow.js format.

Downloads the pretrained InceptionV3 model from Keras applications,
prints all mixed layer names for reference, then converts and saves
the model in TF.js LayersModel format.

Output: public/models/inception_v3/model.json + weight shard .bin files
"""

import os
import pathlib

import tensorflow as tf
import tensorflowjs as tfjs

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_DIR = str(PROJECT_ROOT / "public" / "models" / "inception_v3")

# ---------------------------------------------------------------------------
# 1. Load InceptionV3 (feature-extractor, no classification head)
# ---------------------------------------------------------------------------
print("Loading InceptionV3 (include_top=False, imagenet weights) ...")
base_model = tf.keras.applications.InceptionV3(
    include_top=False,
    weights="imagenet",
    input_shape=(None, None, 3),
)
print(f"Model loaded: {base_model.name}")
print(f"  Input shape : {base_model.input_shape}")
print(f"  Output shape: {base_model.output_shape}")
print(f"  Total params: {base_model.count_params():,}")

# ---------------------------------------------------------------------------
# 2. Print all "mixed" layer names (used by DeepDream to pick targets)
# ---------------------------------------------------------------------------
print("\nMixed layers available for DeepDream:")
for layer in base_model.layers:
    if "mixed" in layer.name:
        try:
            shape = layer.output_shape
        except (AttributeError, RuntimeError):
            shape = "N/A"
        print(f"  - {layer.name:20s}  output shape: {shape}")

# ---------------------------------------------------------------------------
# 3. Convert & save to TF.js LayersModel format
# ---------------------------------------------------------------------------
os.makedirs(OUTPUT_DIR, exist_ok=True)
print(f"\nConverting model to TF.js format -> {OUTPUT_DIR}")
tfjs.converters.save_keras_model(base_model, OUTPUT_DIR)
print("Conversion complete.")

# ---------------------------------------------------------------------------
# 4. Report total size of saved model files
# ---------------------------------------------------------------------------
total_bytes = 0
for f in pathlib.Path(OUTPUT_DIR).iterdir():
    size = f.stat().st_size
    total_bytes += size
    print(f"  {f.name:40s}  {size / 1024:>10.1f} KB")

print(f"\nTotal model size: {total_bytes / (1024 * 1024):.1f} MB")
print("Done! Model files saved to", OUTPUT_DIR)
