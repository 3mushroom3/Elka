"use client";

import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

export type MapPoint = {
  id: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  isActive: boolean;
  stock: number;
  soldToday: number;
  revenueToday: number;
  shift: string;
};

export type MapTrip = {
  id: number;
  driverName: string;
  pointName: string;
  status: string;
  // Трек рейса по порядку времени: [долгота, широта]
  track: [number, number][];
  recordedAt: string | null;
};

const rub = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

// Карта точек и рейсов. Подложка: OpenFreeMap, стиль лежит в public/map.
export function PointsMap({ points, trips }: { points: MapPoint[]; trips: MapTrip[] }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!container.current || map.current) return;
    const coords = [
      ...points.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...trips.flatMap((t) => t.track),
    ];
    const m = new maplibregl.Map({
      container: container.current,
      style: "/map/style-ru.json",
      // MapLibre принимает [долгота, широта], а не [широта, долгота]
      center: coords[0] ?? [37.618423, 55.751244],
      zoom: coords.length > 0 ? 10 : 3,
      minZoom: 2,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    m.on("error", (e) => console.warn("[карта]", e.error?.message ?? e.type));

    // Подложка идёт со сторонней CDN: если её не отдали, честно это показываем,
    // а не оставляем пустой серый прямоугольник.
    let loaded = false;
    m.once("load", () => {
      loaded = true;
      // Стиль карты мог примениться уже после создания холста
      m.resize();
      onLoad(m);
    });
    const warn = () => {
      if (!loaded && !document.hidden) setFailed(true);
    };
    const timer = setTimeout(warn, 20000);

    function onLoad(m: maplibregl.Map) {
      if (trips.length > 0) {
        m.addSource("tracks", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: trips
              .filter((t) => t.track.length > 1)
              .map((t) => ({
                type: "Feature" as const,
                properties: { id: t.id },
                geometry: { type: "LineString" as const, coordinates: t.track },
              })),
          },
        });
        m.addLayer({
          id: "tracks-line",
          type: "line",
          source: "tracks",
          paint: { "line-color": "#0369a1", "line-width": 4, "line-opacity": 0.75 },
        });
      }

      for (const t of trips) {
        const last = t.track.at(-1);
        if (!last) continue;
        const el = document.createElement("div");
        el.className =
          "flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-sky-700 text-lg shadow";
        el.textContent = "🚚";
        el.title = `${t.driverName} → ${t.pointName}`;
        new maplibregl.Marker({ element: el })
          .setLngLat(last)
          .setPopup(
            new maplibregl.Popup({ offset: 18 }).setText(
              `${t.driverName}: рейс №${t.id} на «${t.pointName}», ${t.status}`,
            ),
          )
          .addTo(m);
      }

      for (const p of points) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `flex h-10 w-10 items-center justify-center rounded-full border-2 border-white text-base font-bold text-white shadow ${
          p.isActive ? "bg-emerald-700" : "bg-zinc-400"
        }`;
        el.textContent = "🎄";
        el.setAttribute("aria-label", p.name);
        el.addEventListener("click", () => setSelected(p));
        new maplibregl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(m);
      }

      if (coords.length > 1) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c),
          new maplibregl.LngLatBounds(coords[0], coords[0]),
        );
        m.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 0 });
      }
    }

    return () => {
      clearTimeout(timer);
      m.remove();
      map.current = null;
    };
  }, [points, trips]);

  return (
    <div className="flex flex-col gap-3">
      {/* Стиль самой карты лежит рядом, а не импортируется из node_modules:
          правило turbopack в next.config.ts прогоняет все *.css через загрузчик
          Tailwind. Без этого стиля у маркеров нет position: absolute, и они
          уезжают с нужного места при каждом зуме. */}
      {/* eslint-disable-next-line @next/next/no-css-tags -- импорт из node_modules
          прошёл бы через тот самый загрузчик Tailwind; React 19 сам поднимает
          этот link в head и не дублирует его */}
      <link rel="stylesheet" href="/map/maplibre-gl.css" precedence="default" />
      <div className="relative overflow-hidden rounded-2xl border border-zinc-200">
        <div ref={container} className="h-[60vh] min-h-80 w-full" />
        {failed && (
          <p className="absolute inset-x-4 top-4 rounded-xl bg-white/95 p-3 text-sm text-red-700 shadow">
            Подложка карты не загрузилась. Проверьте доступ в интернет и обновите страницу.
          </p>
        )}
      </div>

      {selected ? (
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              {selected.address && <p className="text-sm text-zinc-500">{selected.address}</p>}
            </div>
            <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>
              Закрыть
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Остаток" value={`${selected.stock} шт.`} />
            <Stat label="Продано сегодня" value={`${selected.soldToday} шт.`} />
            <Stat label="Выручка сегодня" value={rub(selected.revenueToday)} />
            <Stat label="Смена" value={selected.shift} />
          </div>
          <a href={`/manager/points`} className="btn-secondary mt-3 inline-flex">
            Карточка точки
          </a>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Нажмите на точку, чтобы увидеть остаток, продажи за сегодня и статус смены.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-zinc-50 p-3">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
