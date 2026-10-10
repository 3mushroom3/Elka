import type {
  IncidentType,
  LocationType,
  MovementType,
  PaymentMethod,
  ProductCategory,
  RequestStatus,
  Role,
  ShiftStatus,
  TripStatus,
  WriteoffReason,
  WriteoffStatus,
} from "@prisma/client";

export const ROLE_LABEL: Record<Role, string> = {
  MANAGER: "Менеджер",
  SELLER: "Продавец",
  DRIVER: "Водитель",
};

export const CATEGORY_LABEL: Record<ProductCategory, string> = {
  TREE: "Ёлки",
  GOODS: "Изделия",
  ACCESSORY: "Сопутствующие",
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  RECEIPT: "Приход",
  TRANSFER: "Перемещение",
  SALE: "Продажа",
  WRITEOFF: "Списание",
  COUNT_ADJUSTMENT: "Расхождение пересчёта",
  CORRECTION: "Корректировка",
};

const SYSTEM_LOCATION_LABEL: Record<LocationType, string> = {
  SUPPLIER: "Поставщик",
  WAREHOUSE: "Склад",
  SOLD: "Продано",
  WRITTEN_OFF: "Списано",
  SHORTAGE: "Недостача",
  POINT: "Точка",
  DRIVER: "Водитель",
};

export function locationName(loc: {
  type: LocationType;
  point?: { name: string } | null;
  driver?: { fullName: string } | null;
}) {
  if (loc.type === "POINT" && loc.point) return `Точка: ${loc.point.name}`;
  if (loc.type === "DRIVER" && loc.driver) return `Водитель: ${loc.driver.fullName}`;
  return SYSTEM_LOCATION_LABEL[loc.type];
}

const dateTime = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(d: Date) {
  return dateTime.format(d);
}

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  NEW: "Ждёт решения",
  APPROVED: "Утверждена",
  REJECTED: "Отклонена",
  DONE: "Выполнена",
  CANCELLED: "Отменена",
};

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  ASSIGNED: "Назначен",
  LOADED: "Загружен",
  IN_TRANSIT: "В пути",
  DELIVERED: "Доставлен, ждёт приёма",
  ACCEPTED: "Принят",
  CANCELLED: "Отменён",
};

export const INCIDENT_LABEL: Record<IncidentType, string> = {
  LOAD_MISMATCH: "Загрузка не по утверждённому",
  DELIVERY_MISMATCH: "Расхождение при приёме",
  DAY_SHORTAGE: "Недостача за смену",
  DAY_SURPLUS: "Излишек за смену",
  NIGHT_SHORTAGE: "Ночная недостача",
  NIGHT_SURPLUS: "Ночной излишек",
  CASH_MISMATCH: "Расхождение по деньгам",
  DISCOUNT: "Продажа ниже стикера",
  SHIFT_NOT_OPENED: "Смена не открыта вовремя",
  SHIFT_NOT_CLOSED: "Смена не закрыта вовремя",
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: "Наличные",
  TRANSFER: "Перевод",
  CARD: "Карта",
};

export const SHIFT_STATUS_LABEL: Record<ShiftStatus, string> = {
  OPEN: "Открыта",
  COUNTED: "Пересчёт сдан, ждём деньги",
  CLOSED: "Закрыта",
};

const money = new Intl.NumberFormat("ru-RU");

export function formatMoney(amount: number) {
  return `${money.format(amount)} ₽`;
}

const timeOnly = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTime(d: Date) {
  return timeOnly.format(d);
}

const MSK_OFFSET = 3 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// Начало суток по московскому времени для заданного момента
export function dayStart(d: Date = new Date()) {
  return new Date(Math.floor((d.getTime() + MSK_OFFSET) / DAY) * DAY - MSK_OFFSET);
}

// "ГГГГ-ММ-ДД" из поля даты -> начало этих суток по Москве
export function parseDay(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00+03:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * DAY);
}

export const WRITEOFF_REASON_LABEL: Record<WriteoffReason, string> = {
  DEFECT: "Брак",
  BROKEN: "Поломка",
  THEFT: "Кража",
  OTHER: "Другое",
};

export const WRITEOFF_STATUS_LABEL: Record<WriteoffStatus, string> = {
  PENDING: "Ждёт решения",
  APPROVED: "Списано",
  REJECTED: "Отказано",
};
