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
      selected: boolean;
      showLabel: boolean;
    };
  }>;
};

const VEHICLE_SOURCE_ID = "fleet-vehicles-source";
const VEHICLE_DOT_LAYER_ID = "fleet-vehicles-dots";

export default function FleetMap({
  vehicles,
  selectedVehicle,
  selectedId,
  onSelect,
  onBackgroundTap,
  overlayContent,
  className,
}: FleetMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const ignoreNextBackgroundTapRef = useRef(false);
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
      const hasDotLayer = Boolean(map.getLayer(VEHICLE_DOT_LAYER_ID));

      if (!existingSource) {
        map.addSource(VEHICLE_SOURCE_ID, {
          type: "geojson",
          data: vehicleFeatures,
        });
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
              ["==", ["get", "status"], "moving"],
              "#10b981",
              "#f59e0b",
            ],
            "circle-radius": ["case", ["boolean", ["get", "selected"], false], 9, 7],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 1,
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
        map.on("mouseenter", VEHICLE_DOT_LAYER_ID, hoverVehicle);
        map.on("mouseleave", VEHICLE_DOT_LAYER_ID, leaveVehicle);
      }

      (map.getSource(VEHICLE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(vehicleFeatures);

      labelMarkersRef.current.forEach((marker) => marker.remove());
      labelMarkersRef.current = [];

      vehicleFeatures.features.forEach((feature) => {
        if (!feature.properties.showLabel) return;

        const isCompactViewport = typeof window !== "undefined" && window.innerWidth < 768;

        const labelHost = document.createElement("button");
        labelHost.type = "button";
        labelHost.title = feature.properties.truckNo;
        labelHost.style.display = "flex";
        labelHost.style.flexDirection = "column";
        labelHost.style.alignItems = "center";
        labelHost.style.justifyContent = "flex-end";
        labelHost.style.padding = isCompactViewport ? "0 0 7px 0" : "0 0 10px 0";
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
        if (isCompactViewport) {
          pill.style.padding = feature.properties.selected ? "3px 8px" : "2px 7px";
          pill.style.fontSize = feature.properties.selected ? "11px" : "10px";
        } else {
          pill.style.padding = feature.properties.selected ? "4px 9px" : "3px 8px";
          pill.style.fontSize = feature.properties.selected ? "12px" : "11px";
        }
        pill.style.borderRadius = "999px";
        pill.style.border = feature.properties.selected ? "1px solid #ffffff" : "1px solid #ffffff";
        pill.style.background = "#020617";
        pill.style.color = "#ffffff";
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
      map.fitBounds(bounds, { padding: 60, maxZoom: 9, duration: 700 });
    };

    if (!map.isStyleLoaded()) {
      map.once("load", applyVehicleLayers);
      return () => {
        map.off("load", applyVehicleLayers);
      };
    }

    applyVehicleLayers();
  }, [onSelect, vehicleFeatures]);

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
