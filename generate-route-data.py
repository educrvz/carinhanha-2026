#!/usr/bin/env python3
"""Build a river-following route constrained by the team's KML points."""

import bisect
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_KML = ROOT / "data" / "Pontos Carinhanha.kml"
OSM_SOURCE = ROOT / "data" / "osm-waterways.json"
OUTPUT = ROOT / "route-data.js"

# Connected downstream sequence: Rio Itaguari, its confluence connector, then
# Rio Carinhanha. The snapshot is committed so builds remain reproducible.
OSM_WAY_ORDER = [
    308745698,
    333850161,
    326121109,
    43959319,
    408893778,
    178700008,
    178700009,
    178700007,
    178700006,
]


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


def load_control_points(kml_path):
    root = ET.parse(kml_path).getroot()
    points = []
    for placemark in root.iter():
        if not placemark.tag.endswith("Placemark"):
            continue
        name = ""
        coordinate = None
        for element in placemark.iter():
            if element.tag.endswith("name") and not name:
                name = (element.text or "").strip()
            if element.tag.endswith("coordinates") and element.text:
                lon, lat, *_ = map(float, element.text.strip().split(","))
                coordinate = [lon, lat]
        if coordinate:
            points.append({"id": name, "coordinate": coordinate})
    if len(points) < 2:
        raise ValueError("The KML must contain at least two ordered Point coordinates")
    return points


def load_osm_centerline():
    data = json.loads(OSM_SOURCE.read_text(encoding="utf-8"))
    ways = {
        element["id"]: [[point["lon"], point["lat"]] for point in element["geometry"]]
        for element in data["elements"]
        if element.get("type") == "way"
    }
    missing = set(OSM_WAY_ORDER) - set(ways)
    if missing:
        raise ValueError(f"Missing OSM ways: {sorted(missing)}")

    line = []
    for way_id in OSM_WAY_ORDER:
        geometry = ways[way_id]
        if line and geometry[0] != line[-1]:
            if geometry[-1] == line[-1]:
                geometry = list(reversed(geometry))
            else:
                raise ValueError(f"OSM way {way_id} is disconnected")
        line.extend(geometry if not line else geometry[1:])
    return line


class LocalProjection:
    def __init__(self, latitude):
        self.x_scale = 111.32 * math.cos(math.radians(latitude))
        self.y_scale = 110.574

    def to_xy(self, point):
        return point[0] * self.x_scale, point[1] * self.y_scale

    def to_lon_lat(self, point):
        return point[0] / self.x_scale, point[1] / self.y_scale


def cumulative_lengths(points):
    cumulative = [0.0]
    for start, end in zip(points, points[1:]):
        cumulative.append(cumulative[-1] + math.dist(start, end))
    return cumulative


def point_at_station(points, cumulative, station):
    index = max(0, min(len(points) - 2, bisect.bisect_right(cumulative, station) - 1))
    segment_length = cumulative[index + 1] - cumulative[index]
    fraction = 0.0 if segment_length == 0 else (station - cumulative[index]) / segment_length
    start, end = points[index], points[index + 1]
    return (
        start[0] + (end[0] - start[0]) * fraction,
        start[1] + (end[1] - start[1]) * fraction,
    )


def project_onto_line(point, line, cumulative):
    best = None
    for index, (start, end) in enumerate(zip(line, line[1:])):
        dx, dy = end[0] - start[0], end[1] - start[1]
        denominator = dx * dx + dy * dy
        fraction = 0.0 if denominator == 0 else (
            (point[0] - start[0]) * dx + (point[1] - start[1]) * dy
        ) / denominator
        fraction = max(0.0, min(1.0, fraction))
        projected = (start[0] + dx * fraction, start[1] + dy * fraction)
        distance = math.dist(point, projected)
        station = cumulative[index] + math.dist(start, projected)
        if best is None or distance < best[0]:
            best = (distance, station, projected)
    return best


def build_constrained_centerline(controls, source_line):
    """Warp detailed source geometry so every authoritative KML point is exact."""
    mean_latitude = sum(point["coordinate"][1] for point in controls) / len(controls)
    projection = LocalProjection(mean_latitude)
    source_xy = [projection.to_xy(point) for point in source_line]
    source_cumulative = cumulative_lengths(source_xy)

    anchors = []
    previous_station = -math.inf
    for index, control in enumerate(controls):
        target = projection.to_xy(control["coordinate"])
        distance, station, projected = project_onto_line(target, source_xy, source_cumulative)
        if station <= previous_station:
            raise ValueError(f"Control point {control['id']} is out of downstream order")
        previous_station = station
        anchors.append(
            {
                "index": index,
                "station": station,
                "target": target,
                "offset": (target[0] - projected[0], target[1] - projected[1]),
                "source_distance": distance,
            }
        )

    # Retain every detailed source vertex between start and finish and insert
    # every KML control station. Linear offset interpolation preserves bends
    # while making the final path pass through all 151 team coordinates.
    samples = {}
    for station in source_cumulative:
        if anchors[0]["station"] < station < anchors[-1]["station"]:
            samples[round(station, 9)] = {"station": station, "control": None}
    for anchor in anchors:
        samples[round(anchor["station"], 9)] = {
            "station": anchor["station"],
            "control": anchor["index"],
        }

    anchor_stations = [anchor["station"] for anchor in anchors]
    route = []
    control_route_indexes = {}
    for sample in sorted(samples.values(), key=lambda item: item["station"]):
        station = sample["station"]
        right = bisect.bisect_right(anchor_stations, station)
        left_index = max(0, min(len(anchors) - 1, right - 1))
        right_index = min(len(anchors) - 1, left_index + 1)
        left_anchor, right_anchor = anchors[left_index], anchors[right_index]
        span = right_anchor["station"] - left_anchor["station"]
        fraction = 0.0 if span == 0 else (station - left_anchor["station"]) / span
        fraction = max(0.0, min(1.0, fraction))
        offset = (
            left_anchor["offset"][0]
            + (right_anchor["offset"][0] - left_anchor["offset"][0]) * fraction,
            left_anchor["offset"][1]
            + (right_anchor["offset"][1] - left_anchor["offset"][1]) * fraction,
        )
        raw = point_at_station(source_xy, source_cumulative, station)
        adjusted = (raw[0] + offset[0], raw[1] + offset[1])
        if sample["control"] is not None:
            adjusted = anchors[sample["control"]]["target"]
        lon, lat = projection.to_lon_lat(adjusted)
        point = [round(lon, 8), round(lat, 8)]
        if not route or point != route[-1]:
            route.append(point)
        if sample["control"] is not None:
            control_route_indexes[sample["control"]] = len(route) - 1

    route_distances = [0.0]
    for start, end in zip(route, route[1:]):
        route_distances.append(route_distances[-1] + haversine(start, end))

    control_points = []
    for index, control in enumerate(controls):
        lon, lat = control["coordinate"]
        control_points.append(
            {
                "id": control["id"],
                "lat": lat,
                "lon": lon,
                "km": round(route_distances[control_route_indexes[index]], 2),
            }
        )
    return route, control_points, anchors


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
        start, end = points[segment_index], points[segment_index + 1]
        markers.append(
            {
                "km": round(target, 2),
                "lat": round(start[1] + (end[1] - start[1]) * fraction, 8),
                "lon": round(start[0] + (end[0] - start[0]) * fraction, 8),
            }
        )
    return total_km, markers


def main():
    kml_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_KML
    controls = load_control_points(kml_path)
    route, control_points, anchors = build_constrained_centerline(controls, load_osm_centerline())
    total_km, markers = interpolate_markers(route)
    max_source_offset = max(anchor["source_distance"] for anchor in anchors)
    data = {
        "name": "Carinhanha 2026",
        "totalKm": round(total_km, 2),
        "route": route,
        "controlPoints": control_points,
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
        "routeSource": "Team KML control points constrained to OpenStreetMap river geometry",
    }
    OUTPUT.write_text(
        "const ROUTE_DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {OUTPUT.name}: {len(route)} route vertices, "
        f"{len(control_points)} exact controls, {len(markers)} markers, {total_km:.2f} km, "
        f"max source correction {max_source_offset * 1000:.1f} m"
    )


if __name__ == "__main__":
    main()
