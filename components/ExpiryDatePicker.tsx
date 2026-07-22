"use client";

import { useLocale } from "@/components/LocaleProvider";

function parseIsoDate(iso: string): { day: number; month: number; year: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { day, month, year };
}

function toIsoDate(day: number, month: number, year: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

export default function ExpiryDatePicker({
  value,
  onChange,
}: {
  value: string; // ISO date (YYYY-MM-DD)
  onChange: (isoDate: string) => void;
}) {
  const { t } = useLocale();
  const { day, month, year } = parseIsoDate(value);
  const days = Array.from({ length: daysInMonth(month, year) }, (_, i) => i + 1);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: 6 }, (_, i) => year - 1 + i);

  return (
    <div className="flex gap-2">
      <select
        value={day}
        onChange={(e) => onChange(toIsoDate(Number(e.target.value), month, year))}
        className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-2 py-2 text-sm"
      >
        {days.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        value={month}
        onChange={(e) => {
          const m = Number(e.target.value);
          const clampedDay = Math.min(day, daysInMonth(m, year));
          onChange(toIsoDate(clampedDay, m, year));
        }}
        className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-2 py-2 text-sm"
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {t(`month.${m}`)}
          </option>
        ))}
      </select>
      <select
        value={year}
        onChange={(e) => {
          const y = Number(e.target.value);
          const clampedDay = Math.min(day, daysInMonth(month, y));
          onChange(toIsoDate(clampedDay, month, y));
        }}
        className="flex-1 rounded-lg border border-black/15 dark:border-white/15 bg-transparent px-2 py-2 text-sm"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
