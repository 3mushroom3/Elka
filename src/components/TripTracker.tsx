"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { reportTripLocation } from "@/app/driver/actions";

const SEND_EVERY_MS = 60_000;
const STORAGE_KEY = "elka_track";

// Выбор водителя хранится в телефоне и читается как внешнее хранилище:
// на сервере его нет, поэтому до загрузки страницы считаем, что выключено.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function isOn() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    // приватный режим: выбор просто не запоминается
    return false;
  }
}

function setOn(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
  } catch {
    // не страшно: поработает до закрытия страницы
  }
  for (const l of listeners) l();
}

function hasGeolocation() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

// Передача местоположения в рейсе. Включает сам водитель; пока не включил,
// ничего не отправляется.
export function TripTracker({ tripId }: { tripId: number }) {
  const on = useSyncExternalStore(subscribe, isOn, () => false);
  const supported = useSyncExternalStore(subscribe, hasGeolocation, () => true);
  const [note, setNote] = useState<string | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!on || !hasGeolocation()) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSent.current < SEND_EVERY_MS) return;
        lastSent.current = now;
        reportTripLocation({
          tripId,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        })
          .then((r) => setNote(r.ok ? null : r.error))
          .catch(() => setNote("Нет связи: точка не отправлена, попробуем снова."));
      },
      (e) => {
        setOn(false);
        setNote(
          e.code === e.PERMISSION_DENIED
            ? "Доступ к местоположению запрещён в настройках телефона."
            : "Не удалось определить местоположение.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [on, tripId]);

  return (
    <section className="card">
      <label className="flex min-h-12 items-center gap-3 text-lg">
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={on}
          disabled={!supported}
          onChange={(e) => {
            setNote(null);
            setOn(e.target.checked);
          }}
        />
        Показывать менеджеру, где я
      </label>
      <p className="mt-1 text-sm text-zinc-500">
        {!supported
          ? "Этот телефон не умеет определять местоположение."
          : on
            ? "Местоположение отправляется раз в минуту, пока открыт экран рейса. Выключается этой же галочкой."
            : "Пока выключено: менеджер не видит, где вы. Включите, чтобы он видел рейс на карте."}
      </p>
      {note && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{note}</p>
      )}
    </section>
  );
}
