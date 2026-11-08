import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { api, ApiError } from "./api";
import type {
  FurnitureList as Saved,
  FurnitureItem as Item,
  FurnitureCatalog,
} from "./types";
import { formatMoney, lineAmount, totalAmount } from "./money";
export function Furniture({
  beforeLeave,
}: {
  beforeLeave: RefObject<(() => Promise<void>) | null>;
}) {
  const [lists, setLists] = useState<Saved[]>([]),
    [active, setActive] = useState<Saved | null>(null),
    [catalog, setCatalog] = useState<FurnitureCatalog>({ id: "", items: [] }),
    [query, setQuery] = useState(""),
    [section, setSection] = useState(""),
    [room, setRoom] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [conflict, setConflict] = useState(false);
  const current = useRef<Saved | null>(null),
    dirty = useRef(false),
    blocked = useRef(false),
    pending = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    issue = useRef<{ key: string; id: string } | null>(null);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  async function flush(): Promise<void> {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) {
      await pending.current;
      return flush();
    }
    if (blocked.current)
      throw Error("Конфликт версий. Откройте список заново.");
    if (!dirty.current || !current.current) return;
    const sent = current.current;
    dirty.current = false;
    setStatus("Сохранение…");
    const work = (async () => {
      try {
        const saved = await api<Saved>("/furniture/lists/" + sent.id, "PUT", {
          revision: sent.revision,
          data: sent.data,
        });
        current.current = {
          ...saved,
          data: current.current?.data || saved.data,
        };
        setActive(current.current);
        setLists((old) => old.map((x) => (x.id === saved.id ? saved : x)));
        setStatus("Сохранено");
        setError("");
      } catch (e) {
        dirty.current = true;
        if (e instanceof ApiError && e.status === 409) {
          blocked.current = true;
          setConflict(true);
        }
        setStatus("Не сохранено");
        fail(e);
        throw e;
      }
    })();
    pending.current = work;
    try {
      await work;
    } finally {
      pending.current = null;
    }
    if (dirty.current) await flush();
  }
  useEffect(() => {
    api<Saved[]>("/furniture/lists").then(setLists).catch(fail);
    api<FurnitureCatalog>("/furniture/catalog").then(setCatalog).catch(fail);
  }, []);
  useEffect(() => {
    beforeLeave.current = flush;
    const online = () => void flush().catch(fail);
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current || pending.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", unload);
    return () => {
      beforeLeave.current = null;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  function open(x: Saved | null) {
    current.current = x;
    setActive(x);
    dirty.current = false;
    blocked.current = false;
    setConflict(false);
    setRoom("");
    setError("");
    setStatus("");
  }
  function change(data: Saved["data"]) {
    if (!current.current || blocked.current) return;
    current.current = { ...current.current, data };
    setActive(current.current);
    dirty.current = true;
    setStatus("Есть изменения");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(fail), 800);
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  function patch(i: number, data: Partial<Item>) {
    if (active)
      change({
        ...active.data,
        items: active.data.items.map((x, j) =>
          i === j ? { ...x, ...data } : x,
        ),
      });
  }
  async function download(format: string) {
    await flush();
    const x = current.current;
    if (!x) return;
    const key = x.id + ":" + x.revision;
    if (issue.current?.key !== key)
      issue.current = { key, id: crypto.randomUUID() };
    const result = await api<{ id: string; status: string }>(
      `/furniture/lists/${x.id}/generate`,
      "POST",
      { revision: x.revision, request_id: issue.current.id },
    );
    if (format === "pdf" && result.status !== "ready")
      throw Error("PDF не сформирован. DOCX доступен; повторите PDF.");
    const a = document.createElement("a");
    a.href = `/api/furniture/issues/${result.id}/${format}`;
    a.download = `Мебель.${format}`;
    a.click();
  }
  async function upload(file: File) {
    if (file.size > 20 * 1024 * 1024) throw Error("Максимум 20 МБ");
    const check = await fetch("/api/furniture/catalog?preview=1", {
      method: "POST",
      headers: { "X-Pact-Request": "1" },
      body: file,
    });
    const report = await check.json();
    if (!check.ok) throw Error(report.detail);
    if (
      !confirm(
        `Проверка пройдена: ${report.count} позиций, ${report.images} изображений. Заменить каталог? Старые списки сохранятся.`,
      )
    )
      return;
    const response = await fetch("/api/furniture/catalog", {
      method: "POST",
      headers: {
        "X-Pact-Request": "1",
        "Content-Type": "application/octet-stream",
      },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.detail);
    setCatalog(data);
    setError("");
    setStatus(`Импортировано позиций: ${data.items.length}`);
  }
  function preview(image?: string) {
    return image ? (
      <img
        className="furniture-preview"
        src={"/api/furniture/images/" + image}
        alt=""
        loading="lazy"
      />
    ) : (
      <span className="furniture-preview furniture-placeholder">Нет фото</span>
    );
  }
  return (
    <section className="furniture">
      <h1>Списки мебели</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{status}</p>
      <div className="furniture-toolbar">
        <button
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await flush();
              const x = await api<Saved>("/furniture/lists", "POST");
              setLists((old) => [...old, x]);
              open(x);
            })
          }
        >
          Создать список
        </button>
        <select
          aria-label="Список мебели"
          value={active?.id || ""}
          onChange={(e) => {
            const id = e.target.value;
            void action(async () => {
              await flush();
              open(lists.find((x) => x.id === id) || null);
            });
          }}
        >
          <option value="">Выберите список</option>
          {lists.map((x) => (
            <option key={x.id} value={x.id}>
              {x.data.title}
            </option>
          ))}
        </select>
        <label>
          Обновить XLSX
          <input
            disabled={busy}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void action(() => upload(f));
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {conflict && (
        <button
          onClick={() =>
            void action(async () => {
              const all = await api<Saved[]>("/furniture/lists");
              setLists(all);
              open(all.find((x) => x.id === active?.id) || null);
            })
          }
        >
          Открыть сохранённую версию
        </button>
      )}
      {active && (
        <fieldset disabled={busy || conflict}>
          <legend>Редактор списка</legend>
          <div className="furniture-toolbar">
            <input
              aria-label="Название списка"
              value={active.data.title}
              onChange={(e) =>
                change({ ...active.data, title: e.target.value })
              }
            />
            <button onClick={() => void action(flush)}>Сохранить</button>
            <button
              onClick={() => {
                const r = prompt("Название кабинета")?.trim();
                if (r && !active.data.rooms.includes(r))
                  change({ ...active.data, rooms: [...active.data.rooms, r] });
              }}
            >
              Создать кабинет
            </button>
            <button
              onClick={() => {
                if (confirm("Удалить этот список?"))
                  void action(async () => {
                    await flush();
                    await api("/furniture/lists/" + active.id, "DELETE");
                    setLists((old) => old.filter((x) => x.id !== active.id));
                    open(null);
                  });
              }}
            >
              Удалить список
            </button>
          </div>
          <h2>Каталог · {catalog.items.length}</h2>
          <div className="furniture-toolbar">
            <input
              placeholder="Артикул или название"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Раздел каталога"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value="">Все разделы</option>
              {[...new Set(catalog.items.map((x) => x.section))].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <select
              aria-label="Добавить в кабинет"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
            >
              <option value="">Общий список</option>
              {active.data.rooms.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="furniture-catalog">
            {catalog.items
              .filter(
                (x) =>
                  (!section || x.section === section) &&
                  (x.article + " " + x.name)
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
              .map((x) => (
                <div className="furniture-card" key={x.article}>
                  {preview(x.image)}
                  <div>
                    <b>
                      {x.article} · {x.name}
                    </b>
                    <p>{x.dimensions}</p>
                    <small>{x.description}</small>
                  </div>
                  <button
                    onClick={() =>
                      change({
                        ...active.data,
                        items: [
                          ...active.data.items,
                          {
                            article: x.article,
                            name: x.name,
                            dimensions: x.dimensions,
                            image: x.image || "",
                            catalog_id: catalog.id,
                            room,
                            quantity: "1",
                            price: "",
                          },
                        ],
                      })
                    }
                  >
                    Добавить
                  </button>
                </div>
              ))}
          </div>
          {["", ...active.data.rooms].map((r) => (
            <section className="furniture-room" key={r}>
              <div className="furniture-toolbar">
                <h2>{r || "Общий список"}</h2>
                {r && (
                  <>
                    <button
                      onClick={() => {
                        const name = prompt("Название кабинета", r)?.trim();
                        if (
                          name &&
                          name !== r &&
                          !active.data.rooms.includes(name)
                        ) {
                          change({
                            ...active.data,
                            rooms: active.data.rooms.map((v) =>
                              v === r ? name : v,
                            ),
                            items: active.data.items.map((x) =>
                              x.room === r ? { ...x, room: name } : x,
                            ),
                          });
                          if (room === r) setRoom(name);
                        }
                      }}
                    >
                      Переименовать
                    </button>
                    <button
                      onClick={() => {
                        if (
                          active.data.items.some((x) => x.room === r) &&
                          !confirm("Удалить кабинет вместе с позициями?")
                        )
                          return;
                        change({
                          ...active.data,
                          rooms: active.data.rooms.filter((v) => v !== r),
                          items: active.data.items.filter((x) => x.room !== r),
                        });
                        if (room === r) setRoom("");
                      }}
                    >
                      Удалить кабинет
                    </button>
                  </>
                )}
              </div>
              {active.data.items.map(
                (x, i) =>
                  x.room === r && (
                    <div className="furniture-row" key={i}>
                      {preview(x.image)}
                      <div>
                        <b>{x.article}</b>
                        <p>{x.name}</p>
                        <small>{x.dimensions}</small>
                      </div>
                      <label>
                        Количество
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={x.quantity}
                          onChange={(e) =>
                            patch(i, { quantity: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Цена, руб.
                        <input
                          inputMode="decimal"
                          value={x.price}
                          onChange={(e) => patch(i, { price: e.target.value })}
                        />
                      </label>
                      <span>
                        {formatMoney(lineAmount(x.quantity, x.price))}
                      </span>
                      <select
                        aria-label="Перенести в кабинет"
                        value={x.room}
                        onChange={(e) => patch(i, { room: e.target.value })}
                      >
                        <option value="">Общий список</option>
                        {active.data.rooms.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                      <button
                        onClick={() =>
                          change({
                            ...active.data,
                            items: active.data.items.filter((_, j) => j !== i),
                          })
                        }
                      >
                        Удалить
                      </button>
                    </div>
                  ),
              )}
              <p>
                Сумма:{" "}
                {formatMoney(
                  totalAmount(active.data.items.filter((x) => x.room === r)),
                )}
              </p>
            </section>
          ))}
          <h2>Итого: {formatMoney(totalAmount(active.data.items))}</h2>
          <div className="furniture-toolbar">
            {["docx", "pdf"].map((f) => (
              <button
                key={f}
                disabled={
                  !active.data.items.length ||
                  active.data.items.some(
                    (x) =>
                      !lineAmount(x.quantity, x.price) ||
                      !/^\d+$/.test(x.quantity),
                  )
                }
                onClick={() => void action(() => download(f))}
              >
                Скачать {f.toUpperCase()}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </section>
  );
}
