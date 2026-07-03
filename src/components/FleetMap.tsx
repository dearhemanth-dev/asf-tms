"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { LngLatBounds } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Vehicle } from "@/components/VehicleActionSheet";

const STREET_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm-base",
      type: "raster",
      source: "osm",
    },
  ],
};

type FleetMapProps = {
  vehicles: Vehicle[];
  selectedVehicle?: Vehicle | null;
  selectedId?: string;
  onSelect: (vehicle: Vehicle) => void;
  onBackgroundTap?: () => void;
  overlayContent?: ReactNode;
  className?: string;
  fitPadding?: number;
  fitMaxZoom?: number;
};

type OverlayPosition = {
  left: number;
  top: number;
  side: "left" | "right";
};

type VehicleFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: {
      id: string;
      truckNo: string;
      status: Vehicle["status"];
      atHome: boolean;
      mph?: number;
      selected: boolean;
      showLabel: boolean;
    };
  }>;
};

const VEHICLE_SOURCE_ID = "fleet-vehicles-source";
const VEHICLE_GLOW_IDLE_LAYER_ID = "fleet-vehicles-glow-idle";
const VEHICLE_GLOW_CRUISE_LAYER_ID = "fleet-vehicles-glow-cruise";
const VEHICLE_DOT_LAYER_ID = "fleet-vehicles-dots";
const VEHICLE_DOT_IDLE_CORE_LAYER_ID = "fleet-vehicles-dots-idle-core";
const VEHICLE_DOT_CRUISE_CORE_LAYER_ID = "fleet-vehicles-dots-cruise-core";

export default function FleetMap({
  vehicles,
  selectedVehicle,
  selectedId,
  onSelect,
  onBackgroundTap,
  overlayContent,
  className,
  fitPadding = 60,
  fitMaxZoom = 9,
}: FleetMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const ignoreNextBackgroundTapRef = useRef(false);
  const glowAnimationFrameRef = useRef<number | null>(null);
  const vehiclesByIdRef = useRef(new Map<string, Vehicle>());
  const labelMarkersRef = useRef<maplibregl.Marker[]>([]);
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition | null>(null);

  const vehicleFeatures = useMemo<VehicleFeatureCollection>(() => {
    const mappedVehicles = vehicles.filter(
      (vehicle) => typeof vehicle.longitude === "number" && typeof vehicle.latitude === "number"
    );

    return {
      type: "FeatureCollection",
      features: mappedVehicles.map((vehicle) => {
        const isSelected = selectedId === vehicle.id;
        const isHome = Boolean(vehicle.atHome);
        const totalVehicles = mappedVehicles.length;
        const showLabel =
          totalVehicles <= 40 ||
          (totalVehicles <= 120 && (isSelected || vehicle.status !== "idle")) ||
          isSelected;

        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [vehicle.longitude as number, vehicle.latitude as number],
          },
          properties: {
            id: vehicle.id,
            truckNo: vehicle.truckNo,
            status: vehicle.status,
            atHome: isHome,
            mph: vehicle.mph,
            selected: isSelected,
            showLabel,
          },
        };
      }),
    };
  }, [selectedId, vehicles]);

  useEffect(() => {
    vehiclesByIdRef.current = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  }, [vehicles]);

  const updateOverlayPosition = useCallback(() => {
    const map = mapRef.current;
    const wrapper = wrapperRef.current;

    if (
      !map ||
      !wrapper ||
      !selectedVehicle ||
      typeof selectedVehicle.longitude !== "number" ||
      typeof selectedVehicle.latitude !== "number"
    ) {
      setOverlayPosition(null);
      return;
    }

    const point = map.project([selectedVehicle.longitude, selectedVehicle.latitude]);
    const popupWidth = Math.min(320, Math.max(260, wrapper.clientWidth - 24));
    const popupHeight = Math.min(280, Math.max(220, wrapper.clientHeight - 24));
    const edgePadding = 10;

    let left = point.x + 24;
    let side: OverlayPosition["side"] = "right";

    if (left + popupWidth > wrapper.clientWidth - edgePadding) {
      left = point.x - popupWidth - 24;
      side = "left";
    }

    left = Math.max(edgePadding, Math.min(left, wrapper.clientWidth - popupWidth - edgePadding));

    let top = point.y - popupHeight / 2;
    top = Math.max(edgePadding, Math.min(top, wrapper.clientHeight - popupHeight - edgePadding));

    setOverlayPosition({ left, top, side });
  }, [selectedVehicle]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Inject style to hide MapLibre popups
    const style = document.createElement("style");
    style.textContent = `.maplibregl-popup { display: none !important; }`;
    document.head.appendChild(style);

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: STREET_STYLE,
      center: [-96.8, 37.8],
      zoom: 3,
    });

    mapRef.current.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    return () => {
      if (glowAnimationFrameRef.current !== null) {
        cancelAnimationFrame(glowAnimationFrameRef.current);
        glowAnimationFrameRef.current = null;
      }
      labelMarkersRef.current.forEach((marker) => marker.remove());
      labelMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyVehicleLayers = () => {
      const existingSource = map.getSource(VEHICLE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      const hasIdleGlowLayer = Boolean(map.getLayer(VEHICLE_GLOW_IDLE_LAYER_ID));
      const hasCruiseGlowLayer = Boolean(map.getLayer(VEHICLE_GLOW_CRUISE_LAYER_ID));
      const hasDotLayer = Boolean(map.getLayer(VEHICLE_DOT_LAYER_ID));
      const hasIdleCoreLayer = Boolean(map.getLayer(VEHICLE_DOT_IDLE_CORE_LAYER_ID));
      const hasCruiseCoreLayer = Boolean(map.getLayer(VEHICLE_DOT_CRUISE_CORE_LAYER_ID));

      if (!existingSource) {
        map.addSource(VEHICLE_SOURCE_ID, {
          type: "geojson",
          data: vehicleFeatures,
        });
      }

      if (!hasIdleGlowLayer) {
        map.addLayer({
          id: VEHICLE_GLOW_IDLE_LAYER_ID,
          type: "circle",
          source: VEHICLE_SOURCE_ID,
          filter: [
            "all",
            [">", ["coalesce", ["get", "mph"], 0], 0],
            ["<", ["coalesce", ["get", "mph"], 0], 6],
          ],
          paint: {
            "circle-color": "#f25c1d",
            "circle-radius": 12,
            "circle-opacity": 0.58,
            "circle-blur": 0.35,
            "circle-stroke-color": "#fb923c",
            "circle-stroke-width": 1.6,
            "circle-stroke-opacity": 0.88,
          },
        });
      }

      if (map.getLayer(VEHICLE_GLOW_IDLE_LAYER_ID)) {
        map.setPaintProperty(VEHICLE_GLOW_IDLE_LAYER_ID, "circle-color", "#f25c1d");
        map.setPaintProperty(VEHICLE_GLOW_IDLE_LAYER_ID, "circle-stroke-color", "#fb923c");
      }

      if (!hasCruiseGlowLayer) {
        map.addLayer({
          id: VEHICLE_GLOW_CRUISE_LAYER_ID,
          type: "circle",
          source: VEHICLE_SOURCE_ID,
          filter: [
            "all",
            [">=", ["coalesce", ["get", "mph"], 0], 6],
            ["<=", ["coalesce", ["get", "mph"], 0], 25],
          ],
          paint: {
            "circle-color": "#facc15",
            "circle-radius": 14,
            "circle-opacity": 0.66,
            "circle-blur": 0.4,
            "circle-stroke-color": "#fef08a",
            "circle-stroke-width": 1.8,
            "circle-stroke-opacity": 0.96,
          },
        });
      }

      if (map.getLayer(VEHICLE_GLOW_CRUISE_LAYER_ID)) {
        map.setPaintProperty(VEHICLE_GLOW_CRUISE_LAYER_ID, "circle-color", "#facc15");
        map.setPaintProperty(VEHICLE_GLOW_CRUISE_LAYER_ID, "circle-stroke-color", "#fef08a");
      }

      if (!hasDotLayer) {
        map.addLayer({
          id: VEHICLE_DOT_LAYER_ID,
          type: "circle",
          source: VEHICLE_SOURCE_ID,
          paint: {
            "circle-color": [
              "case",
              ["==", ["get", "status"], "alert"],
              "#ef4444",
              ["boolean", ["get", "atHome"], false],
              "#f59e0b",
              ["<", ["coalesce", ["get", "mph"], 0], 6],
              "#dcfce7",
              ["<=", ["coalesce", ["get", "mph"], 0], 25],
              "#34d399",
              "#166534",
            ],
            "circle-radius": ["case", ["boolean", ["get", "selected"], false], 9, 7],
            "circle-stroke-color": [
              "case",
              [
                "all",
                ["!=", ["get", "status"], "alert"],
                ["!", ["boolean", ["get", "atHome"], false]],
                ["==", ["coalesce", ["get", "mph"], 0], 0],
              ],
              "#6b7280",
              "#ffffff",
            ],
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 1,
          },
        });

        map.addLayer({
          id: VEHICLE_DOT_CRUISE_CORE_LAYER_ID,
          type: "circle",
          source: VEHICLE_SOURCE_ID,
          filter: [
            "all",
            [">=", ["coalesce", ["get", "mph"], 0], 6],
            ["<=", ["coalesce", ["get", "mph"], 0], 25],
            ["!=", ["get", "status"], "alert"],
            ["!", ["boolean", ["get", "atHome"], false]],
          ],
          paint: {
            "circle-color": "#15803d",
            "circle-radius": ["case", ["boolean", ["get", "selected"], false], 5.3, 4.2],
            "circle-stroke-color": "#ecfeff",
            "circle-stroke-width": 1.2,
            "circle-stroke-opacity": 1,
            "circle-opacity": 1,
          },
        });

        map.addLayer({
          id: VEHICLE_DOT_IDLE_CORE_LAYER_ID,
          type: "circle",
          source: VEHICLE_SOURCE_ID,
          filter: [
            "all",
            [">", ["coalesce", ["get", "mph"], 0], 0],
            ["<", ["coalesce", ["get", "mph"], 0], 6],
            ["!=", ["get", "status"], "alert"],
            ["!", ["boolean", ["get", "atHome"], false]],
          ],
          paint: {
            "circle-color": "#15803d",
            "circle-radius": ["case", ["boolean", ["get", "selected"], false], 2.8, 2.2],
            "circle-opacity": 1,
          },
        });

        const selectVehicle = (event: maplibregl.MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const vehicleId = feature?.properties && typeof feature.properties.id === "string" ? feature.properties.id : null;
          const vehicle = vehicleId ? vehiclesByIdRef.current.get(vehicleId) : undefined;

          if (!vehicle) return;

          ignoreNextBackgroundTapRef.current = true;
          onSelect(vehicle);
        };

        const hoverVehicle = () => {
          map.getCanvas().style.cursor = "pointer";
        };

        const leaveVehicle = () => {
          map.getCanvas().style.cursor = "";
        };

        map.on("click", VEHICLE_DOT_LAYER_ID, selectVehicle);
        map.on("click", VEHICLE_DOT_IDLE_CORE_LAYER_ID, selectVehicle);
        map.on("click", VEHICLE_DOT_CRUISE_CORE_LAYER_ID, selectVehicle);
        map.on("mouseenter", VEHICLE_DOT_LAYER_ID, hoverVehicle);
        map.on("mouseenter", VEHICLE_DOT_IDLE_CORE_LAYER_ID, hoverVehicle);
        map.on("mouseenter", VEHICLE_DOT_CRUISE_CORE_LAYER_ID, hoverVehicle);
        map.on("mouseleave", VEHICLE_DOT_LAYER_ID, leaveVehicle);
        map.on("mouseleave", VEHICLE_DOT_IDLE_CORE_LAYER_ID, leaveVehicle);
        map.on("mouseleave", VEHICLE_DOT_CRUISE_CORE_LAYER_ID, leaveVehicle);
      } else {
        if (!hasIdleCoreLayer) {
          map.addLayer({
            id: VEHICLE_DOT_IDLE_CORE_LAYER_ID,
            type: "circle",
            source: VEHICLE_SOURCE_ID,
            filter: [
              "all",
              [">", ["coalesce", ["get", "mph"], 0], 0],
              ["<", ["coalesce", ["get", "mph"], 0], 6],
              ["!=", ["get", "status"], "alert"],
              ["!", ["boolean", ["get", "atHome"], false]],
            ],
            paint: {
              "circle-color": "#15803d",
              "circle-radius": ["case", ["boolean", ["get", "selected"], false], 2.8, 2.2],
              "circle-opacity": 1,
            },
          });
        }

        if (!hasCruiseCoreLayer) {
        map.addLayer({
          id: VEHICLE_DOT_CRUISE_CORE_LAYER_ID,
          type: "circle",
          source: VEHICLE_SOURCE_ID,
          filter: [
            "all",
            [">=", ["coalesce", ["get", "mph"], 0], 6],
            ["<=", ["coalesce", ["get", "mph"], 0], 25],
            ["!=", ["get", "status"], "alert"],
            ["!", ["boolean", ["get", "atHome"], false]],
          ],
          paint: {
            "circle-color": "#15803d",
            "circle-radius": ["case", ["boolean", ["get", "selected"], false], 5.3, 4.2],
            "circle-stroke-color": "#ecfeff",
            "circle-stroke-width": 1.2,
            "circle-stroke-opacity": 1,
            "circle-opacity": 1,
          },
        });
        }
      }

      if (glowAnimationFrameRef.current !== null) {
        cancelAnimationFrame(glowAnimationFrameRef.current);
        glowAnimationFrameRef.current = null;
      }

      const animateGlow = (time: number) => {
        const hasAnyGlowLayer =
          Boolean(map.getLayer(VEHICLE_GLOW_IDLE_LAYER_ID)) ||
          Boolean(map.getLayer(VEHICLE_GLOW_CRUISE_LAYER_ID));
        if (!hasAnyGlowLayer) return;

        // Compact, clear ring-wave with slightly faster cadence and less overlap.
        const cycle = (Math.sin(time / 200) + 1) / 2;
        const idleRadius = 10 + cycle * 8;
        const idleOpacity = 0.3 + cycle * 0.42;
        const idleBlur = 0.2 + cycle * 0.26;
        const idleStrokeOpacity = 0.62 + cycle * 0.3;
        const idleStrokeWidth = 1.3 + cycle * 1.3;

        const cruiseRadius = 11 + cycle * 10;
        const cruiseOpacity = 0.48 + cycle * 0.42;
        const cruiseBlur = 0.24 + cycle * 0.3;
        const cruiseStrokeOpacity = 0.66 + cycle * 0.28;
        const cruiseStrokeWidth = 1.4 + cycle * 1.5;

        if (map.getLayer(VEHICLE_GLOW_IDLE_LAYER_ID)) {
          map.setPaintProperty(VEHICLE_GLOW_IDLE_LAYER_ID, "circle-radius", idleRadius);
          map.setPaintProperty(VEHICLE_GLOW_IDLE_LAYER_ID, "circle-opacity", idleOpacity);
          map.setPaintProperty(VEHICLE_GLOW_IDLE_LAYER_ID, "circle-blur", idleBlur);
          map.setPaintProperty(VEHICLE_GLOW_IDLE_LAYER_ID, "circle-stroke-opacity", idleStrokeOpacity);
          map.setPaintProperty(VEHICLE_GLOW_IDLE_LAYER_ID, "circle-stroke-width", idleStrokeWidth);
        }

        if (map.getLayer(VEHICLE_GLOW_CRUISE_LAYER_ID)) {
          map.setPaintProperty(VEHICLE_GLOW_CRUISE_LAYER_ID, "circle-radius", cruiseRadius);
          map.setPaintProperty(VEHICLE_GLOW_CRUISE_LAYER_ID, "circle-opacity", cruiseOpacity);
          map.setPaintProperty(VEHICLE_GLOW_CRUISE_LAYER_ID, "circle-blur", cruiseBlur);
          map.setPaintProperty(VEHICLE_GLOW_CRUISE_LAYER_ID, "circle-stroke-opacity", cruiseStrokeOpacity);
          map.setPaintProperty(VEHICLE_GLOW_CRUISE_LAYER_ID, "circle-stroke-width", cruiseStrokeWidth);
        }

        glowAnimationFrameRef.current = requestAnimationFrame(animateGlow);
      };

      glowAnimationFrameRef.current = requestAnimationFrame(animateGlow);

      (map.getSource(VEHICLE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(vehicleFeatures);

      labelMarkersRef.current.forEach((marker) => marker.remove());
      labelMarkersRef.current = [];

      vehicleFeatures.features.forEach((feature) => {
        if (!feature.properties.showLabel) return;

        const labelHost = document.createElement("button");
        labelHost.type = "button";
        labelHost.title = feature.properties.truckNo;
        labelHost.style.display = "flex";
        labelHost.style.flexDirection = "column";
        labelHost.style.alignItems = "center";
        labelHost.style.justifyContent = "flex-end";
        labelHost.style.padding = "0 0 12px 0";
        labelHost.style.margin = "0";
        labelHost.style.background = "transparent";
        labelHost.style.border = "none";
        labelHost.style.cursor = "pointer";
        labelHost.style.touchAction = "manipulation";

        const pill = document.createElement("span");
        pill.textContent = feature.properties.truckNo;
        pill.style.display = "inline-flex";
        pill.style.alignItems = "center";
        pill.style.justifyContent = "center";
        pill.style.padding = feature.properties.selected ? "4px 9px" : "3px 8px";
        pill.style.borderRadius = "999px";
        pill.style.border = feature.properties.selected ? "1px solid #ffffff" : "1px solid #ffffff";
        pill.style.background = "#020617";
        pill.style.color = "#ffffff";
        pill.style.fontSize = feature.properties.selected ? "12px" : "11px";
        pill.style.fontWeight = feature.properties.selected ? "800" : "700";
        pill.style.letterSpacing = "0.01em";
        pill.style.lineHeight = "1.1";
        pill.style.whiteSpace = "nowrap";
        pill.style.boxShadow = "0 2px 10px rgba(0, 0, 0, 0.45)";
        pill.style.textTransform = "uppercase";
        labelHost.appendChild(pill);

        const activateLabel = (event?: Event) => {
          if (event) {
            event.stopPropagation();
            if ("preventDefault" in event) event.preventDefault();
          }

          const vehicle = vehiclesByIdRef.current.get(feature.properties.id);
          if (!vehicle) return;

          ignoreNextBackgroundTapRef.current = true;
          onSelect(vehicle);
        };

        labelHost.onclick = (event) => activateLabel(event);
        labelHost.addEventListener("touchend", activateLabel, { passive: false });

        const labelMarker = new maplibregl.Marker({ element: labelHost, anchor: "bottom" })
          .setLngLat(feature.geometry.coordinates)
          .addTo(map);

        labelMarkersRef.current.push(labelMarker);
      });

      if (vehicleFeatures.features.length === 0) return;

      const bounds = new LngLatBounds();
      vehicleFeatures.features.forEach((feature) => bounds.extend(feature.geometry.coordinates));
      map.fitBounds(bounds, { padding: fitPadding, maxZoom: fitMaxZoom, duration: 700 });
    };

    if (!map.isStyleLoaded()) {
      map.once("load", applyVehicleLayers);
      return () => {
        map.off("load", applyVehicleLayers);
        if (glowAnimationFrameRef.current !== null) {
          cancelAnimationFrame(glowAnimationFrameRef.current);
          glowAnimationFrameRef.current = null;
        }
      };
    }

    applyVehicleLayers();
    return () => {
      if (glowAnimationFrameRef.current !== null) {
        cancelAnimationFrame(glowAnimationFrameRef.current);
        glowAnimationFrameRef.current = null;
      }
    };
  }, [fitMaxZoom, fitPadding, onSelect, vehicleFeatures]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const syncOverlay = () => updateOverlayPosition();

    map.on("move", syncOverlay);
    map.on("zoom", syncOverlay);
    map.on("resize", syncOverlay);

    updateOverlayPosition();

    return () => {
      map.off("move", syncOverlay);
      map.off("zoom", syncOverlay);
      map.off("resize", syncOverlay);
    };
  }, [updateOverlayPosition]);

  useEffect(() => {
    const map = mapRef.current;
    const wrapper = wrapperRef.current;

    if (!map || !wrapper) return;

    const syncMapSize = () => {
      map.resize();
      updateOverlayPosition();
    };

    syncMapSize();

    const resizeObserver = new ResizeObserver(() => {
      syncMapSize();
    });

    resizeObserver.observe(wrapper);
    window.addEventListener("resize", syncMapSize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncMapSize);
    };
  }, [updateOverlayPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !onBackgroundTap) return;

    const closeOverlay = () => {
      if (ignoreNextBackgroundTapRef.current) {
        ignoreNextBackgroundTapRef.current = false;
        return;
      }

      onBackgroundTap();
    };
    map.on("click", closeOverlay);
    map.on("touchend", closeOverlay);

    return () => {
      map.off("click", closeOverlay);
      map.off("touchend", closeOverlay);
    };
  }, [onBackgroundTap]);

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full overflow-hidden rounded-2xl border border-slate-700 ${
        className ?? "h-[78dvh] min-h-[520px] max-h-[860px] sm:h-[74dvh] md:h-[70dvh] lg:h-[760px]"
      }`}
    >
      <div ref={containerRef} className="h-full w-full" />

      {overlayContent && overlayPosition && (
        <div className="pointer-events-none absolute z-20" style={{ left: overlayPosition.left, top: overlayPosition.top }}>
          <div
            onClick={(event) => event.stopPropagation()}
            className="pointer-events-auto relative w-[280px] sm:w-[320px] max-w-[calc(100vw-2rem)]"
          >
            <div
              className="absolute top-7 h-3 w-3 rotate-45 border border-slate-700 bg-slate-950"
              style={overlayPosition.side === "right" ? { left: -6 } : { right: -6 }}
            />
            {overlayContent}
          </div>
        </div>
      )}
    </div>
  );
}
