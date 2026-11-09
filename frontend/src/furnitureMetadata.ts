export function furnitureCreatedAt(value: string | null): string {
  return value
    ? "Создан " + new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric",
      }).format(new Date(value))
    : "Дата создания неизвестна";
}

export function matchesFurnitureList(
  list: { number: number; data: { title: string } }, query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return list.data.title.toLocaleLowerCase().includes(normalized) ||
    String(list.number).includes(normalized.replace(/^№\s*/, ""));
}
