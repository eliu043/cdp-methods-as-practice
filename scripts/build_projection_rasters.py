"""Build derived projection rasters from the public four-band 2022 NAIP export."""

from pathlib import Path
import sys

import numpy as np
from PIL import Image


def ndvi_color(ndvi: np.ndarray) -> np.ndarray:
    """Map NDVI values to a restrained brown–ivory–green scientific ramp."""
    stops = np.array([-0.35, 0.0, 0.18, 0.4, 0.72], dtype=np.float32)
    colors = np.array(
        [
            [55, 45, 38],
            [133, 112, 83],
            [220, 211, 177],
            [118, 151, 88],
            [27, 76, 48],
        ],
        dtype=np.float32,
    )
    output = np.empty((*ndvi.shape, 3), dtype=np.float32)
    for channel in range(3):
        output[..., channel] = np.interp(ndvi, stops, colors[:, channel])
    return np.clip(output, 0, 255).astype(np.uint8)


def main(source: Path, destination: Path) -> None:
    raster = np.asarray(Image.open(source), dtype=np.float32)
    if raster.ndim != 3 or raster.shape[2] != 4:
        raise ValueError(f"Expected four bands; received {raster.shape}")

    red = raster[..., 0]
    nir = raster[..., 3]
    denominator = nir + red
    ndvi = np.divide(nir - red, denominator, out=np.zeros_like(red), where=denominator > 0)
    ndvi = np.clip(ndvi, -1, 1)

    destination.parent.mkdir(parents=True, exist_ok=True)
    rendered = Image.fromarray(ndvi_color(ndvi), mode="RGB")
    rendered.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
        destination, optimize=True
    )

    valid = ndvi[denominator > 0]
    percentiles = np.percentile(valid, [2, 25, 50, 75, 98])
    print("NDVI percentiles (2/25/50/75/98):", " ".join(f"{value:.3f}" for value in percentiles))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: build_projection_rasters.py SOURCE_4BAND_TIFF OUTPUT_PNG")
    main(Path(sys.argv[1]), Path(sys.argv[2]))
