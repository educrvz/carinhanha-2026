#!/usr/bin/env python3
"""Build route-data.js from the ordered points in the Carinhanha KML."""

import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_KML = ROOT / "data" / "Pontos Carinhanha.kml"
OUTPUT = ROOT / "route-data.js"


def haversine(a, b):
    lon1, lat1 = a
    lon2, lat2 = b
    radius_km = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    value = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * radius_km * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def load_points(kml_path):
    root = ET.parse(kml_path).getroot()
    points = []
    for element in root.iter():
        if element.tag.endswith("coordinates") and element.text:
            lon, lat, *_ = map(float, element.text.strip().split(","))
            points.append([lon, lat])
    if len(points) < 2:
        raise ValueError("The KML must contain at least two ordered Point coordinates")
    return points


def interpolate_markers(points):
    segment_lengths = [haversine(a, b) for a, b in zip(points, points[1:])]
    total_km = sum(segment_lengths)
    targets = [float(km) for km in range(math.floor(total_km) + 1)]
    if not math.isclose(targets[-1], total_km, abs_tol=0.001):
        targets.append(total_km)

    markers = []
    segment_index = 0
    distance_before = 0.0
    for target in targets:
        while (
            segment_index < len(segment_lengths) - 1
            and distance_before + segment_lengths[segment_index] < target
        ):
            distance_before += segment_lengths[segment_index]
            segment_index += 1

        segment_length = segment_lengths[segment_index]
        fraction = 0.0 if segment_length == 0 else (target - distance_before) / segment_length
        start = points[segment_index]
        end = points[segment_index + 1]
        lon = start[0] + (end[0] - start[0]) * fraction
        lat = start[1] + (end[1] - start[1]) * fraction
        markers.append(
            {
                "km": round(target, 2),
                "lat": round(lat, 8),
                "lon": round(lon, 8),
            }
        )
    return total_km, markers


def main():
    kml_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_KML
    points = load_points(kml_path)
    total_km, markers = interpolate_markers(points)
    data = {
        "name": "Carinhanha 2026",
        "totalKm": round(total_km, 2),
        "route": points,
        "kmMarkers": markers,
        "pois": [
            {
                "name": "Hospital Municipal de Feira da Mata",
                "lat": -14.2116564,
                "lon": -44.2814858,
                "type": "hospital",
                "phone": "(77) 99846-2395",
                "info": "Botrópico · Crotálico · Escorpiônico",
                "sourceDate": "2026-07-03",
            },
            {
                "name": "Hospital Municipal de Carinhanha",
                "lat": -14.3019166,
                "lon": -43.7677139,
                "type": "hospital",
                "phone": "(77) 3485-2038",
                "info": "Botrópico · Crotálico · Elapídico · Escorpiônico · Aracnídico",
                "sourceDate": "2026-07-03",
            },
        ],
        "altRoute": [],
    }
    OUTPUT.write_text(
        "const ROUTE_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT.name}: {len(points)} route points, {len(markers)} markers, {total_km:.2f} km")


if __name__ == "__main__":
    main()
