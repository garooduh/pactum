import { readNavigation, writeNavigation } from "./navigation";
import { furnitureCreatedAt, matchesFurnitureList } from "./furnitureMetadata";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  ImageOff,
  LoaderCircle,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { api, ApiError } from "./api";
import type {
  FurnitureList as Saved,
  FurnitureItem as Item,
  FurnitureCatalog,
} from "./types";
import { formatMoney, lineAmount, totalAmount } from "./money";

type CatalogItem = FurnitureCatalog["items"][number];
type DialogState =
  | { kind: "room"; original?: string }
  | { kind: "delete-room"; name: string }
  | { kind: "delete-list" }
  | { kind: "reload" }
  | { kind: "move"; index: number }
  | { kind: "import" };

function positions(count: number) {
  const ending =
    count % 100 >= 11 && count % 100 <= 14
      ? "позиций"
      : count % 10 === 1
        ? "позиция"
        : count % 10 >= 2 && count % 10 <= 4
          ? "позиции"
          : "позиций";
  return `${count} ${ending}`;
}
function quantityError(value: string) {
  const q = value.replace(/[\s\u00a0]/g, "").replace(",", ".");
  return /^\d{1,12}(\.0{1,3})?$/.test(q) && lineAmount(q, "0")
    ? ""
    : "Целое число больше нуля";
}
function priceError(value: string) {
  return !value.trim()
    ? "Укажите цену"
    : lineAmount("1", value)
      ? ""
      : "Цена от 0, до 2 знаков после запятой";
}
function summary(items: Item[]) {
  const valid = items.filter(
    (x) => !quantityError(x.quantity) && !priceError(x.price),
  );
  return {
    amount: totalAmount(valid),
    incomplete: valid.length !== items.length,
  };
}

// Native modal dialogs provide a focus trap and make the underlying page inert.
function FurnitureDialog({
  title,
  subtitle,
  children,
  onClose,
  drawer = false,
  busy = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  drawer?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = ref.current!;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"fur-dialog" + (drawer ? " fur-drawer" : "")}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="fur-dialog-shell">
        <header className="fur-dialog-header">
          <div>
            {subtitle && <span className="fur-kicker">{subtitle}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
function Preview({
  image,
  large = false,
}: {
  image?: string;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  return (
    <span className={"fur-preview" + (large ? " fur-preview-large" : "")}>
      {image && !failed ? (
        <img
          src={"/api/furniture/images/" + image}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageOff size={large ? 36 : 20} aria-label="Нет изображения" />
      )}
    </span>
  );
}
function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="fur-menu">
      <summary className="icon-button" aria-label={label}>
        <MoreHorizontal size={20} />
      </summary>
      <div
        className="fur-menu-popover"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button"))
            e.currentTarget.parentElement?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}

export function Furniture({
  beforeLeave,
}: {
  beforeLeave: RefObject<(() => Promise<void>) | null>;
}) {
  const [lists, setLists] = useState<Saved[]>([]),
    [active, setActive] = useState<Saved | null>(null),
    [catalog, setCatalog] = useState<FurnitureCatalog>({ id: "", items: [] });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [conflict, setConflict] = useState(false),
    [offline, setOffline] = useState(!navigator.onLine);
  const [query, setQuery] = useState(""),
    [section, setSection] = useState(""),
    [listQuery, setListQuery] = useState(""),
    [drawer, setDrawer] = useState<string | null>(null),
    [detailsItem, setDetailsItem] = useState<CatalogItem | null>(null),
    [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null),
    [dialogError, setDialogError] = useState(""),
    [roomDraft, setRoomDraft] = useState(""),
    [moveTarget, setMoveTarget] = useState(""),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [highlighted, setHighlighted] = useState<Set<number>>(new Set());
  const [file, setFile] = useState<File | null>(null),
    [report, setReport] = useState<{ count: number; images: number } | null>(
      null,
    ),
    [exportFormat, setExportFormat] = useState(""),
    [pdfFailed, setPdfFailed] = useState(false);
  const current = useRef<Saved | null>(null),
    dirty = useRef(false),
    saveProblem = useRef(false),
    blocked = useRef(false),
    pending = useRef<Promise<void> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    issue = useRef<{ key: string; id: string } | null>(null),
    actionLock = useRef(false),
    root = useRef<HTMLElement>(null),
    newRows = useRef<number[]>([]);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));

  async function flush(): Promise<void> {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) {
      await pending.current;
      return flush();
    }
    if (blocked.current)
      throw Error(
        "Этот список изменён в другой вкладке. Откройте сохранённую версию.",
      );
    if (!dirty.current || !current.current) return;
    if (
      current.current.data.items.some(
        (x) =>
          quantityError(x.quantity) || (x.price.trim() && priceError(x.price)),
      )
    ) {
      saveProblem.current = true;
      setStatus("Проверьте поля");
      throw Error("Исправьте количество или цену в отмеченных позициях.");
    }
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
        if (saveProblem.current) {
          setError("");
          saveProblem.current = false;
        }
      } catch (e) {
        dirty.current = true;
        saveProblem.current = true;
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
  async function load() {
    setLoading(true);
    try {
      const [saved, source] = await Promise.all([
        api<Saved[]>("/furniture/lists"),
        api<FurnitureCatalog>("/furniture/catalog"),
      ]);
      setLists(saved);
      const id = readNavigation().furnitureId;
      if (id) open(saved.find((x) => x.id === id) || null);
      setCatalog(source);
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    beforeLeave.current = flush;
    const online = () => {
        setOffline(false);
        void flush().catch(fail);
      },
      offline = () => setOffline(true);
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current || pending.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const closeMenus = (e: PointerEvent) => {
      document
        .querySelectorAll<HTMLDetailsElement>(".fur-menu[open]")
        .forEach((el) => {
          if (!el.contains(e.target as Node)) el.open = false;
        });
    };
    const escapeMenus = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const menus = [
          ...document.querySelectorAll<HTMLDetailsElement>(".fur-menu[open]"),
        ];
        if (menus.length) {
          e.preventDefault();
          menus.forEach((el) => {
            el.open = false;
            (el.querySelector("summary") as HTMLElement)?.focus();
          });
        }
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", escapeMenus);
    return () => {
      beforeLeave.current = null;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", escapeMenus);
    };
  }, []);
  function open(x: Saved | null) {
    writeNavigation({ view: "furniture", furnitureId: x?.id });
    current.current = x;
    setActive(x);
    dirty.current = false;
    blocked.current = false;
    setConflict(false);
    setError("");
    setStatus("");
    setCollapsed(new Set());
    setHighlighted(new Set());
    setPdfFailed(false);
    issue.current = null;
    window.scrollTo({ top: 0 });
  }
  function change(data: Saved["data"]) {
    if (!current.current || blocked.current || actionLock.current) return;
    current.current = { ...current.current, data };
    setActive(current.current);
    dirty.current = true;
    setStatus("Есть изменения");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(fail), 800);
  }
  async function action(fn: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      fail(e);
      setDialogError(e instanceof Error ? e.message : String(e));
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  function patch(i: number, data: Partial<Item>) {
    const x = current.current;
    if (x)
      change({
        ...x.data,
        items: x.data.items.map((v, j) => (i === j ? { ...v, ...data } : v)),
      });
  }
  function beginDialog(next: DialogState) {
    setDialogError("");
    setDialog(next);
  }
  function beginRoom(original?: string) {
    setRoomDraft(original || "");
    beginDialog({ kind: "room", original });
  }
  function focusField(index: number) {
    const x = current.current?.data.items[index];
    if (!x) return;
    setCollapsed((old) => {
      const next = new Set(old);
      next.delete(x.room);
      return next;
    });
    setTimeout(() => {
      const row = root.current?.querySelector<HTMLElement>(
        `[data-furniture-row="${index}"]`,
      );
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row
        ?.querySelector<HTMLInputElement>(
          quantityError(x.quantity) ? "[data-quantity]" : "[data-price]",
        )
        ?.focus({ preventScroll: true });
    }, 0);
  }
  function beginCatalog(room: string) {
    setDrawer(room);
    setNotice("");
    newRows.current = [];
    setCollapsed((old) => {
      const next = new Set(old);
      next.delete(room);
      return next;
    });
  }
  function closeCatalog() {
    setDrawer(null);
    if (newRows.current.length) {
      setHighlighted(new Set(newRows.current));
      focusField(newRows.current[0]);
    }
  }
  function add(item: CatalogItem) {
    const x = current.current;
    if (!x || drawer === null) return;
    newRows.current.push(x.data.items.length);
    change({
      ...x.data,
      items: [
        ...x.data.items,
        {
          article: item.article,
          name: item.name,
          dimensions: item.dimensions,
          image: item.image || "",
          catalog_id: catalog.id,
          room: drawer,
          quantity: "1",
          price: "",
        },
      ],
    });
    setNotice(`Добавлено: ${item.article} · ${drawer || "Общий список"}`);
  }
  function saveRoom() {
    const x = current.current;
    if (!x || dialog?.kind !== "room") return;
    const name = roomDraft.trim();
    if (!name) {
      setDialogError("Введите название кабинета");
      return;
    }
    if (x.data.rooms.some((r) => r === name && r !== dialog.original)) {
      setDialogError("Кабинет с таким названием уже есть");
      return;
    }
    const old = dialog.original;
    change({
      ...x.data,
      rooms: old
        ? x.data.rooms.map((r) => (r === old ? name : r))
        : [...x.data.rooms, name],
      items: old
        ? x.data.items.map((v) => (v.room === old ? { ...v, room: name } : v))
        : x.data.items,
    });
    setDialog(null);
    setCollapsed((v) => {
      const next = new Set(v);
      next.delete(name);
      return next;
    });
    setTimeout(
      () =>
        document
          .getElementById("fur-room-" + encodeURIComponent(name))
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      0,
    );
  }
  async function download(format: string) {
    setExportFormat(format);
    try {
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
      setPdfFailed(result.status !== "ready");
      if (format === "pdf" && result.status !== "ready")
        throw Error(
          "Не удалось сформировать PDF. DOCX доступен — скачайте его или повторите PDF.",
        );
      const a = document.createElement("a");
      a.href = `/api/furniture/issues/${result.id}/${format}`;
      a.download = `Мебель.${format}`;
      a.click();
    } finally {
      setExportFormat("");
    }
  }
  async function upload(preview: boolean) {
    if (!file) throw Error("Выберите файл XLSX");
    if (file.size > 20 * 1024 * 1024)
      throw Error("Размер файла должен быть не больше 20 МБ");
    const response = await fetch(
      "/api/furniture/catalog" + (preview ? "?preview=1" : ""),
      {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "X-Pact-Request": "1",
          "Content-Type": "application/octet-stream",
        },
        body: file,
      },
    );
    const data = await response
      .json()
      .catch(() => ({ detail: "Не удалось загрузить каталог" }));
    if (!response.ok) {
      if (response.status === 401)
        window.dispatchEvent(new Event("pact-session-expired"));
      throw Error(
        typeof data.detail === "string"
          ? data.detail
          : "Проверьте структуру файла XLSX",
      );
    }
    if (preview) setReport(data);
    else {
      setCatalog(data);
      setDialog(null);
      setNotice(`Каталог обновлён · ${data.items.length} позиций`);
    }
  }
  const items = active?.data.items || [],
    total = summary(items),
    badIndices = items.flatMap((x, i) =>
      quantityError(x.quantity) || priceError(x.price) ? [i] : [],
    ),
    missingPrices = items.filter((x) => !x.price.trim()).length;
  const filtered = catalog.items.filter(
    (x) =>
      (!section || x.section === section) &&
      (x.article + " " + x.name)
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const formDisabled = busy || conflict;
  return (
    <section
      className={"furniture" + (active ? " furniture-editing" : "")}
      ref={root}
    >
      {error && (
        <div className="fur-alert" role="alert">
          <AlertCircle size={18} />
          <div>
            <strong>
              {conflict
                ? "Обнаружен конфликт версий"
                : "Не удалось завершить действие"}
            </strong>
            <p>{error}</p>
            <div className="fur-inline-actions">
              {conflict ? (
                <button
                  className="text-button"
                  onClick={() => beginDialog({ kind: "reload" })}
                >
                  Открыть сохранённую версию
                </button>
              ) : pdfFailed ? (
                <>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void action(() => download("docx"))}
                  >
                    Скачать DOCX
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void action(() => download("pdf"))}
                  >
                    Повторить PDF
                  </button>
                </>
              ) : (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await flush();
                      if (!active) await load();
                      else setError("");
                    })
                  }
                >
                  Повторить
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {!active ? (
        <>
          <header className="page-heading">
            <div>
              <span className="eyebrow">МЕБЕЛЬ И ОБОРУДОВАНИЕ</span>
              <h1>Списки мебели</h1>
              <p>Соберите мебель по кабинетам и получите готовый перечень.</p>
            </div>
            <button
              className="button"
              disabled={busy || loading}
              onClick={() =>
                void action(async () => {
                  await flush();
                  const x = await api<Saved>("/furniture/lists", "POST");
                  setLists((v) => [...v, x]);
                  open(x);
                })
              }
            >
              <Plus size={17} />
              Создать список
            </button>
          </header>
          {loading ? (
            <div className="fur-empty" role="status">
              <LoaderCircle className="spin" />
              <h2>Загружаем списки…</h2>
            </div>
          ) : lists.length === 0 ? (
            <div className="fur-empty fur-empty-home">
              <span className="fur-empty-symbol">
                <FolderOpen size={30} />
              </span>
              <h2>Первый список — с чистого листа</h2>
              <p>
                Выберите мебель из каталога, укажите количество и цены.
                <br />
                Кабинеты помогут организовать большой проект.
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const x = await api<Saved>("/furniture/lists", "POST");
                    setLists([x]);
                    open(x);
                  })
                }
              >
                <Plus size={17} />
                Создать список мебели
              </button>
              <span className="fur-muted">
                {catalog.items.length} позиций в каталоге · DOCX и PDF
              </span>
            </div>
          ) : (
            <>
              <div className="fur-index-toolbar">
                <label className="fur-search">
                  <Search size={18} />
                  <input
                    aria-label="Найти список"
                    placeholder="Найти список по названию или номеру"
                    value={listQuery}
                    onChange={(e) => setListQuery(e.target.value)}
                  />
                  {listQuery && (
                    <button
                      className="icon-button"
                      aria-label="Очистить поиск"
                      onClick={() => setListQuery("")}
                    >
                      <X size={16} />
                    </button>
                  )}
                </label>
                <span className="fur-muted">
                  Сохранённые списки · {lists.length}
                </span>
              </div>
              <div className="fur-projects">
                {lists
                  .filter((x) => matchesFurnitureList(x, listQuery))
                  .sort((a, b) => a.number - b.number)
                  .map((x) => {
                    const sum = summary(x.data.items);
                    return (
                      <button
                        className="fur-project"
                        disabled={busy}
                        key={x.id}
                        onClick={() => open(x)}
                      >
                        <span className="fur-project-icon">
                          <FileText size={23} />
                        </span>
                        <span className="fur-project-info">
                          <strong>№{x.number} · {x.data.title || "Без названия"}</strong>
                          <span>{furnitureCreatedAt(x.created_at)}</span>
                          <span>
                            {x.data.items.length} позиций ·{" "}
                            {x.data.rooms.length} кабинетов
                          </span>
                        </span>
                        <span className="fur-project-total">
                          {formatMoney(sum.amount)}
                          {sum.incomplete && (
                            <small>Цены заполнены не полностью</small>
                          )}
                        </span>
                        <ChevronRight size={18} />
                      </button>
                    );
                  })}
              </div>
              {!lists.some((x) => matchesFurnitureList(x, listQuery)) && (
                <div className="fur-empty">
                  <Search size={26} />
                  <h2>Списки не найдены</h2>
                  <p>Попробуйте другое название.</p>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <button
            className="text-button fur-back"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await flush();
                open(null);
              })
            }
          >
            <ArrowLeft size={16} />
            Все списки
          </button>
          <header className="fur-editor-header">
            <div className="fur-title">
              <span className="fur-muted">Список №{active.number} · {furnitureCreatedAt(active.created_at)}</span>
              <label htmlFor="fur-title">Название списка</label>
              <input
                id="fur-title"
                value={active.data.title}
                maxLength={200}
                placeholder="Например, мебель для клиники"
                disabled={formDisabled}
                onChange={(e) =>
                  change({ ...active.data, title: e.target.value })
                }
              />
            </div>
            <div className="fur-header-actions">
              <span
                className={
                  "fur-save-status" +
                  (conflict || offline || status === "Не сохранено"
                    ? " fur-save-warning"
                    : "")
                }
                role="status"
              >
                {status === "Сохранение…" ? (
                  <LoaderCircle size={14} className="spin" />
                ) : conflict ||
                  offline ||
                  status === "Не сохранено" ||
                  status === "Проверьте поля" ? (
                  <AlertCircle size={14} />
                ) : (
                  <Check size={14} />
                )}{" "}
                {conflict
                  ? "Конфликт версий"
                  : offline
                    ? "Нет сети"
                    : status || "Все изменения сохранены"}
              </span>
              <Menu label="Действия со списком">
                <button
                  disabled={busy || conflict}
                  className="fur-danger"
                  onClick={() => beginDialog({ kind: "delete-list" })}
                >
                  Удалить список
                </button>
              </Menu>
            </div>
          </header>
          <div className="fur-editor-intro">
            <span>
              <Building2 size={16} />
              {active.data.rooms.length
                ? `Кабинетов: ${active.data.rooms.length}`
                : "Организуйте мебель по кабинетам"}
            </span>
            <button
              className="button secondary small"
              disabled={formDisabled}
              onClick={() => beginRoom()}
            >
              <Plus size={15} />
              Добавить кабинет
            </button>
          </div>
          {!items.length && !active.data.rooms.length && (
            <div className="fur-start-note">
              <span className="fur-step">1</span>
              <p>
                <strong>Начните с мебели или кабинета</strong>
                <br />
                Добавьте позиции в общий список или создайте кабинет для
                отдельного помещения.
              </p>
            </div>
          )}
          {["", ...active.data.rooms].map((room) => {
            const rows = items.flatMap((x, i) =>
                x.room === room ? [{ item: x, index: i }] : [],
              ),
              sum = summary(rows.map((x) => x.item)),
              isCollapsed = collapsed.has(room),
              bodyId = "fur-room-body-" + encodeURIComponent(room);
            return (
              <section
                className="fur-room"
                id={"fur-room-" + encodeURIComponent(room)}
                key={room}
              >
                <header className="fur-room-header">
                  <button
                    className="fur-room-toggle"
                    aria-expanded={!isCollapsed}
                    aria-controls={bodyId}
                    onClick={() =>
                      setCollapsed((old) => {
                        const next = new Set(old);
                        if (next.has(room)) next.delete(room);
                        else next.add(room);
                        return next;
                      })
                    }
                  >
                    {isCollapsed ? (
                      <ChevronRight size={18} />
                    ) : (
                      <ChevronDown size={18} />
                    )}
                    <span className="fur-room-icon">
                      {room ? <Building2 size={19} /> : <Package size={19} />}
                    </span>
                    <span>
                      <h2>{room || "Общий список"}</h2>
                      <small>
                        {room
                          ? positions(rows.length)
                          : "Мебель без привязки к кабинету"}
                      </small>
                    </span>
                  </button>
                  <div className="fur-room-actions">
                    <span className="fur-room-total">
                      {formatMoney(sum.amount)}
                      {sum.incomplete && <small>не все цены</small>}
                    </span>
                    {room && (
                      <Menu label={"Действия с кабинетом " + room}>
                        <button
                          disabled={formDisabled}
                          onClick={() => beginRoom(room)}
                        >
                          Переименовать
                        </button>
                        <button
                          disabled={formDisabled}
                          className="fur-danger"
                          onClick={() =>
                            beginDialog({ kind: "delete-room", name: room })
                          }
                        >
                          Удалить кабинет
                        </button>
                      </Menu>
                    )}
                  </div>
                </header>
                {!isCollapsed && (
                  <div id={bodyId}>
                    {rows.length > 0 ? (
                      <>
                        <div className="fur-table-head" aria-hidden="true">
                          <span>Мебель</span>
                          <span>Кол-во, шт.</span>
                          <span>Цена за шт., ₽</span>
                          <span>Сумма</span>
                          <span />
                        </div>
                        {rows.map(({ item: x, index: i }) => {
                          const qError = quantityError(x.quantity),
                            pError = priceError(x.price);
                          return (
                            <div
                              className={
                                "fur-row" +
                                (highlighted.has(i) ? " fur-row-new" : "")
                              }
                              data-furniture-row={i}
                              key={i}
                            >
                              <div className="fur-item">
                                <Preview image={x.image} />
                                <div>
                                  <span className="fur-article">
                                    {x.article}
                                  </span>
                                  <strong>{x.name}</strong>
                                  <small>
                                    {x.dimensions} {x.dimensions && "мм"}
                                  </small>
                                </div>
                              </div>
                              <label className="fur-cell-input">
                                <span>Количество, шт.</span>
                                <input
                                  data-quantity
                                  aria-label={`Количество ${x.article}, строка ${i + 1}`}
                                  aria-invalid={!!qError}
                                  aria-describedby={
                                    qError ? "fur-q-error-" + i : undefined
                                  }
                                  inputMode="numeric"
                                  value={x.quantity}
                                  disabled={formDisabled}
                                  onChange={(e) =>
                                    patch(i, { quantity: e.target.value })
                                  }
                                />
                                {qError && (
                                  <small
                                    id={"fur-q-error-" + i}
                                    className="fur-field-error"
                                  >
                                    {qError}
                                  </small>
                                )}
                              </label>
                              <label className="fur-cell-input">
                                <span>Цена за шт., ₽</span>
                                <input
                                  data-price
                                  aria-label={`Цена ${x.article}, строка ${i + 1}`}
                                  aria-invalid={!!x.price.trim() && !!pError}
                                  aria-describedby={"fur-p-hint-" + i}
                                  placeholder="Укажите цену"
                                  inputMode="decimal"
                                  value={x.price}
                                  disabled={formDisabled}
                                  onChange={(e) =>
                                    patch(i, { price: e.target.value })
                                  }
                                />
                                {pError && (
                                  <small
                                    id={"fur-p-hint-" + i}
                                    className={
                                      x.price.trim()
                                        ? "fur-field-error"
                                        : "fur-price-hint"
                                    }
                                  >
                                    {pError}
                                  </small>
                                )}
                              </label>
                              <span className="fur-row-total">
                                <small>Сумма</small>
                                {formatMoney(
                                  qError
                                    ? null
                                    : lineAmount(x.quantity, x.price),
                                )}
                              </span>
                              <Menu
                                label={`Действия с позицией ${x.article}, строка ${i + 1}`}
                              >
                                <button
                                  disabled={formDisabled}
                                  onClick={() => {
                                    setMoveTarget(x.room);
                                    beginDialog({ kind: "move", index: i });
                                  }}
                                >
                                  Перенести в кабинет
                                </button>
                                <button
                                  className="fur-danger"
                                  disabled={formDisabled}
                                  onClick={() =>
                                    change({
                                      ...active.data,
                                      items: items.filter((_, j) => j !== i),
                                    })
                                  }
                                >
                                  Удалить позицию
                                </button>
                              </Menu>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <div
                        className={
                          "fur-room-empty" +
                          (!room && active.data.rooms.length
                            ? " fur-room-empty-compact"
                            : "")
                        }
                      >
                        <Package size={23} />
                        <div>
                          <strong>
                            {room
                              ? "В кабинете пока нет мебели"
                              : "Общий список пока пуст"}
                          </strong>
                          <p>
                            Выберите позиции из каталога — количество и цену
                            можно указать здесь.
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="fur-room-footer">
                      <button
                        className="button secondary small"
                        disabled={formDisabled}
                        onClick={() => beginCatalog(room)}
                      >
                        <Plus size={16} />
                        Добавить мебель
                      </button>
                      {rows.length > 0 && (
                        <small>
                          {sum.incomplete
                            ? "Сумма заполненных позиций"
                            : "Сумма по разделу"}{" "}
                          · {formatMoney(sum.amount)}
                        </small>
                      )}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
          <button
            className="fur-add-room"
            disabled={formDisabled}
            onClick={() => beginRoom()}
          >
            <Plus size={18} />
            Добавить кабинет
          </button>
          <div className="fur-export-bar">
            <div className="fur-export-summary">
              <span>
                {positions(items.length)} ·{" "}
                {total.incomplete
                  ? "Сумма заполненных позиций"
                  : "Общая стоимость"}
              </span>
              <strong>{formatMoney(total.amount)}</strong>
              {badIndices.length > 0 ? (
                <button
                  className="fur-validation-link"
                  onClick={() => focusField(badIndices[0])}
                >
                  {missingPrices === badIndices.length
                    ? `Укажите цены для ${missingPrices} ${missingPrices % 10 === 1 && missingPrices % 100 !== 11 ? "позиции" : "позиций"}`
                    : `Проверьте ${positions(badIndices.length)}`}
                  <ArrowRight size={13} />
                </button>
              ) : (
                <small>
                  {items.length
                    ? "В документе — единый перечень без кабинетов и изображений"
                    : "Добавьте мебель, чтобы скачать документ"}
                </small>
              )}
            </div>
            <div className="fur-export-actions">
              <button
                className="button secondary"
                disabled={formDisabled || !items.length || !!badIndices.length}
                onClick={() => void action(() => download("docx"))}
              >
                <FileText size={17} />
                {exportFormat === "docx" ? "Готовим DOCX…" : "DOCX"}
              </button>
              <button
                className="button"
                disabled={formDisabled || !items.length || !!badIndices.length}
                onClick={() => void action(() => download("pdf"))}
              >
                {exportFormat ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <ArrowDownToLine size={17} />
                )}{" "}
                {exportFormat === "pdf" ? "Готовим PDF…" : "Скачать PDF"}
              </button>
            </div>
          </div>
        </>
      )}
      {drawer !== null && (
        <FurnitureDialog
          title="Каталог мебели"
          subtitle={"Добавление в " + (drawer || "Общий список")}
          drawer
          busy={busy}
          onClose={closeCatalog}
        >
          <div className="fur-catalog-controls">
            <div className="fur-catalog-topline">
              <span className="fur-muted">
                {catalog.items.length} позиций в каталоге
              </span>
              <Menu label="Настройки каталога">
                <button
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    setReport(null);
                    beginDialog({ kind: "import" });
                  }}
                >
                  <Upload size={15} />
                  Обновить из XLSX
                </button>
              </Menu>
            </div>
            <label className="fur-search">
              <Search size={18} />
              <input
                autoFocus
                aria-label="Найти мебель"
                placeholder="Название или артикул"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Очистить поиск мебели"
                  onClick={() => setQuery("")}
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <select
              aria-label="Раздел каталога"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            >
              <option value="">Все разделы</option>
              {[...new Set(catalog.items.map((x) => x.section))].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <span className="fur-result-count">Найдено: {filtered.length}</span>
          </div>
          {(conflict || offline || status === "Не сохранено") && (
            <div className="fur-drawer-alert" role="alert">
              <AlertCircle size={16} />
              <span>
                {conflict
                  ? "Список изменён в другой вкладке. Закройте каталог и откройте сохранённую версию."
                  : "Нет связи с сервером. Добавленные позиции остаются на странице."}
              </span>
            </div>
          )}
          <div className="fur-catalog-results">
            {filtered.length ? (
              filtered.map((x) => (
                <article className="fur-catalog-item" key={x.article}>
                  <button
                    className="fur-image-button"
                    aria-label={"Подробнее о " + x.article}
                    onClick={() => setDetailsItem(x)}
                  >
                    <Preview image={x.image} large />
                  </button>
                  <div className="fur-catalog-description">
                    <span className="fur-article">{x.article}</span>
                    <h3>{x.name}</h3>
                    <p>
                      {x.dimensions} {x.dimensions && "мм"}
                    </p>
                    <div>
                      <button
                        className="text-button"
                        onClick={() => setDetailsItem(x)}
                      >
                        Подробнее
                      </button>
                      <button
                        className="button secondary small"
                        disabled={formDisabled}
                        onClick={() => add(x)}
                      >
                        <Plus size={15} />
                        Добавить
                      </button>
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="fur-empty">
                <Search size={26} />
                <h3>Мебель не найдена</h3>
                <p>Измените запрос или выберите другой раздел.</p>
                <button
                  className="text-button"
                  onClick={() => {
                    setQuery("");
                    setSection("");
                  }}
                >
                  Сбросить фильтры
                </button>
              </div>
            )}
          </div>
          <div className="fur-drawer-footer">
            <span role="status">
              {notice ? (
                <>
                  <CheckCircle2 size={16} />
                  {notice}
                </>
              ) : (
                <span className="fur-muted">
                  Добавляйте несколько позиций подряд
                </span>
              )}
            </span>
            <button className="button" onClick={closeCatalog}>
              Готово
              {newRows.current.length > 0 && ` · ${newRows.current.length}`}
            </button>
          </div>
        </FurnitureDialog>
      )}
      {detailsItem && (
        <FurnitureDialog
          title={detailsItem.article}
          subtitle="Карточка мебели"
          onClose={() => setDetailsItem(null)}
        >
          <div className="fur-dialog-body fur-product-detail">
            <Preview image={detailsItem.image} large />
            <h3>{detailsItem.name}</h3>
            <p>
              {detailsItem.dimensions} {detailsItem.dimensions && "мм"}
            </p>
            <p>
              {detailsItem.description ||
                "Дополнительное описание отсутствует."}
            </p>
          </div>
          <div className="fur-dialog-footer">
            <button
              className="button secondary"
              onClick={() => setDetailsItem(null)}
            >
              Закрыть
            </button>
            <button
              className="button"
              disabled={formDisabled}
              onClick={() => {
                add(detailsItem);
                setDetailsItem(null);
              }}
            >
              <Plus size={16} />
              Добавить в {drawer || "общий список"}
            </button>
          </div>
        </FurnitureDialog>
      )}
      {dialog && (
        <FurnitureDialog
          title={
            dialog.kind === "room"
              ? dialog.original
                ? "Переименовать кабинет"
                : "Новый кабинет"
              : dialog.kind === "delete-room"
                ? "Удалить кабинет?"
                : dialog.kind === "delete-list"
                  ? "Удалить список?"
                  : dialog.kind === "reload"
                    ? "Открыть сохранённую версию?"
                    : dialog.kind === "move"
                      ? "Перенести позицию"
                      : "Обновление каталога"
          }
          busy={busy}
          onClose={() => setDialog(null)}
        >
          <div className="fur-dialog-body">
            {dialogError && (
              <p className="fur-dialog-error" role="alert">
                {dialogError}
              </p>
            )}
            {dialog.kind === "room" ? (
              <form
                id="fur-room-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveRoom();
                }}
              >
                <label className="fur-form-label" htmlFor="fur-room-name">
                  Название кабинета
                </label>
                <input
                  id="fur-room-name"
                  autoFocus
                  value={roomDraft}
                  maxLength={200}
                  placeholder="Например, Кабинет 101"
                  onChange={(e) => {
                    setRoomDraft(e.target.value);
                    setDialogError("");
                  }}
                />
                <p className="fur-muted">
                  Позиции этого кабинета попадут в общий перечень документа.
                </p>
              </form>
            ) : dialog.kind === "delete-room" ? (
              <p>
                Кабинет «{dialog.name}» и все его позиции будут удалены из
                списка. Это действие нельзя отменить.
              </p>
            ) : dialog.kind === "delete-list" ? (
              <p>
                Список «{active?.data.title}» будет удалён. Это действие нельзя
                отменить.
              </p>
            ) : dialog.kind === "reload" ? (
              <p>
                Локальные несохранённые изменения будут заменены версией с
                сервера. Продолжить?
              </p>
            ) : dialog.kind === "move" ? (
              <>
                <p className="fur-move-name">
                  {items[dialog.index]?.article} · {items[dialog.index]?.name}
                </p>
                <label className="fur-form-label" htmlFor="fur-move">
                  Куда перенести
                </label>
                <select
                  id="fur-move"
                  autoFocus
                  value={moveTarget}
                  onChange={(e) => setMoveTarget(e.target.value)}
                >
                  <option value="">Общий список</option>
                  {active?.data.rooms.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <div className="fur-import-note">
                  <Upload size={25} />
                  <div>
                    <strong>
                      {report ? "Файл проверен" : "Загрузите новый каталог"}
                    </strong>
                    <p>
                      Существующие списки и изображения выбранных позиций
                      сохранятся.
                    </p>
                  </div>
                </div>
                {report ? (
                  <div className="fur-import-report">
                    <CheckCircle2 size={20} />
                    <strong>
                      {report.count} позиций · {report.images} изображений
                    </strong>
                    <span>{file?.name}</span>
                  </div>
                ) : (
                  <label className="fur-upload">
                    <span>Выберите файл XLSX</span>
                    <input
                      type="file"
                      accept=".xlsx"
                      disabled={busy}
                      onChange={(e) => {
                        setFile(e.target.files?.[0] || null);
                        setReport(null);
                        setDialogError("");
                      }}
                    />
                    <small>До 20 МБ · лист «Изделия»</small>
                  </label>
                )}
              </>
            )}
          </div>
          <div className="fur-dialog-footer">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setDialog(null)}
            >
              Отмена
            </button>
            <button
              className={
                "button" +
                (["delete-list", "delete-room"].includes(dialog.kind)
                  ? " fur-delete-button"
                  : "")
              }
              disabled={busy || (dialog.kind === "import" && !file)}
              type={dialog.kind === "room" ? "submit" : "button"}
              form={dialog.kind === "room" ? "fur-room-form" : undefined}
              onClick={() => {
                if (dialog.kind === "room") return;
                if (dialog.kind === "delete-room" && active) {
                  change({
                    ...active.data,
                    rooms: active.data.rooms.filter((r) => r !== dialog.name),
                    items: items.filter((x) => x.room !== dialog.name),
                  });
                  setDialog(null);
                } else if (dialog.kind === "delete-list" && active)
                  void action(async () => {
                    await flush();
                    await api("/furniture/lists/" + active.id, "DELETE");
                    setLists((v) => v.filter((x) => x.id !== active.id));
                    setDialog(null);
                    open(null);
                  });
                else if (dialog.kind === "reload")
                  void action(async () => {
                    const all = await api<Saved[]>("/furniture/lists");
                    setLists(all);
                    open(all.find((x) => x.id === current.current?.id) || null);
                    setDialog(null);
                  });
                else if (dialog.kind === "move") {
                  patch(dialog.index, { room: moveTarget });
                  setDialog(null);
                  setCollapsed((v) => {
                    const next = new Set(v);
                    next.delete(moveTarget);
                    return next;
                  });
                  setTimeout(() => focusField(dialog.index), 0);
                } else if (dialog.kind === "import")
                  void action(() => upload(!report));
              }}
            >
              {busy ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  Подождите…
                </>
              ) : dialog.kind === "room" ? (
                dialog.original ? (
                  "Сохранить название"
                ) : (
                  "Создать кабинет"
                )
              ) : dialog.kind === "move" ? (
                "Перенести"
              ) : dialog.kind === "reload" ? (
                "Открыть версию с сервера"
              ) : dialog.kind === "import" ? (
                report ? (
                  "Заменить каталог"
                ) : (
                  "Проверить файл"
                )
              ) : (
                "Удалить"
              )}
            </button>
          </div>
        </FurnitureDialog>
      )}
    </section>
  );
}
