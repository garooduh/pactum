import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
  Clock3,
  AlertCircle,
  Menu,
  Save,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { api, ApiError } from "./api";
import type {
  Contract,
  ContractData,
  Party,
  Profile,
  Issue,
  SourceNote,
} from "./types";
import { emptyContract, emptyItem } from "./types";
import { formatMoney, lineAmount, totalAmount } from "./money";
import "./style.css";
import {
  requisiteLength,
  normalizeRequisite,
  requisiteError,
} from "./requisites";

const displayDate = (s: string) =>
  s
    ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString(
        "ru-RU",
      )
    : "Без даты";
function Button({
  children,
  onClick,
  variant = "",
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={"button " + variant}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div role="alert" className="error-box">
      <AlertCircle size={18} />
      <span>{message}</span>
    </div>
  ) : null;
}
function Field({
  label,
  value,
  onChange,
  error,
  type = "text",
  placeholder = "",
  wide = false,
  required = false,
  hint = "",
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  placeholder?: string;
  wide?: boolean;
  required?: boolean;
  hint?: string;
  multiline?: boolean;
}) {
  const id = React.useId();
  const props = {
    id,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    placeholder,
    "aria-invalid": !!error,
    "aria-describedby": error || hint ? id + "-hint" : undefined,
  };
  return (
    <div className={"field " + (wide ? "wide" : "")}>
      <label htmlFor={id}>
        {label}
        {required && <span className="required"> *</span>}
      </label>
      {multiline ? (
        <textarea {...props} rows={3} />
      ) : (
        <input
          {...props}
          type={type === "numeric" || type === "decimal" ? "text" : type}
          inputMode={
            type === "numeric"
              ? "numeric"
              : type === "decimal"
                ? "decimal"
                : undefined
          }
        />
      )}{" "}
      {(error || hint) && (
        <small id={id + "-hint"} className={error ? "field-error" : ""}>
          {error || hint}
        </small>
      )}
    </div>
  );
}
function Section({
  eyebrow,
  title,
  description,
  children,
  extra,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="section-head">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

function PartyFields({
  party,
  onChange,
  errors = {},
  prefix = "customer",
  supplier = false,
}: {
  party: Party;
  onChange: (p: Party) => void;
  errors?: Record<string, string>;
  prefix?: string;
  supplier?: boolean;
}) {
  const set = (key: keyof Party, value: string | boolean) =>
    onChange({ ...party, [key]: value });
  const field = (
    key: keyof Party,
    label: string,
    options: Partial<React.ComponentProps<typeof Field>> = {},
  ) => {
    const length = requisiteLength(key, party.kind);
    const value = String(party[key]);
    return (
      <Field
        key={key}
        label={label}
        value={value}
        onChange={(v) => set(key, length ? normalizeRequisite(v) : v)}
        {...options}
        error={
          length
            ? requisiteError(value, length) ||
              (!value ? errors[prefix + "." + key] : undefined)
            : errors[prefix + "." + key]
        }
        hint={
          length
            ? `${normalizeRequisite(value).length} из ${length} цифр`
            : options.hint
        }
      />
    );
  };
  return (
    <>
      {!supplier && (
        <div className="segmented">
          <button
            className={party.kind === "company" ? "selected" : ""}
            onClick={() =>
              onChange({ ...party, kind: "company", representative: true })
            }
          >
            Организация
          </button>
          <button
            className={party.kind === "ip" ? "selected" : ""}
            onClick={() =>
              onChange({ ...party, kind: "ip", representative: false, kpp: "" })
            }
          >
            Индивидуальный предприниматель
          </button>
        </div>
      )}
      <div className="form-grid">
        {field("full_name", "Полное наименование", {
          wide: true,
          required: true,
          placeholder:
            party.kind === "ip"
              ? "Индивидуальный предприниматель Иванов Иван Иванович"
              : "Общество с ограниченной ответственностью «Название»",
        })}
        {field("short_name", "Сокращённое наименование", {
          wide: true,
          required: true,
          placeholder:
            party.kind === "ip" ? "ИП Иванов И.И." : "ООО «Название»",
        })}
        {field("inn", "ИНН", { required: true, type: "numeric" })}
        {party.kind === "company"
          ? field("kpp", "КПП", { required: true, type: "numeric" })
          : field("registration", "ОГРНИП", {
              required: true,
              type: "numeric",
            })}
        {party.kind === "company" &&
          field("registration", "ОГРН", {
            required: true,
            type: "numeric",
            wide: true,
          })}
        {field("address", "Юридический адрес", {
          wide: true,
          required: true,
          multiline: true,
          placeholder: "Индекс, город, улица, дом, офис",
        })}
        {field("phone", "Телефон", { type: "tel", placeholder: "+7 …" })}
        {field("email", "Электронная почта", {
          type: "email",
          placeholder: "mail@company.ru",
        })}
      </div>
      <div className="form-divider">
        <h3>Банковские реквизиты</h3>
        <span>Для оплаты по договору</span>
      </div>
      <div className="form-grid">
        {field("bank", "Наименование банка", { wide: true, required: true })}
        {field("bik", "БИК", { required: true, type: "numeric" })}
        {field("account", "Расчётный счёт", {
          required: true,
          type: "numeric",
        })}
        {field("correspondent", "Корреспондентский счёт", {
          wide: true,
          required: true,
          type: "numeric",
        })}
      </div>
      <div className="form-divider">
        <h3>Кто подписывает договор</h3>
        <span>Данные для вступления и подписей</span>
      </div>
      {party.kind === "ip" && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={party.representative}
            onChange={(e) => set("representative", e.target.checked)}
          />
          Договор подписывает представитель по доверенности
        </label>
      )}
      <div className="form-grid">
        {(party.kind === "company" || party.representative) && (
          <>
            {field("position", "Должность", {
              required: true,
              placeholder: "Генеральный директор",
            })}
            {field("position_genitive", "Должность после «в лице»", {
              required: true,
              placeholder: "генерального директора",
            })}
            {field("person", "ФИО представителя", {
              wide: true,
              required: true,
            })}
            {field("person_genitive", "ФИО после «в лице»", {
              wide: true,
              required: true,
              placeholder: "Иванова Ивана Ивановича",
              hint: "Введите нужную форму имени — она попадёт в договор без изменений.",
            })}
            {field("basis", "Действует на основании", {
              wide: true,
              required: true,
              placeholder: "устава / доверенности № … от …",
            })}
          </>
        )}
        {field("signature", "Фамилия и инициалы для подписи", {
          wide: true,
          required: true,
          placeholder: "Иванов И.И.",
        })}
      </div>
    </>
  );
}

function Login({
  onSuccess,
  expired = false,
}: {
  onSuccess: () => void;
  expired?: boolean;
}) {
  const [username, setUsername] = useState("admin"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/login", "POST", { username, password });
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={"login-screen " + (expired ? "overlay" : "")}>
      <div className="login-form">
        <div className="brand login-brand">
          <span className="brand-symbol">п</span>пакт
          <span className="brand-dot">.</span>
        </div>
        <div className="doc-icon">
          <FileText size={28} />
        </div>
        <h2>{expired ? "Сессия завершена" : "Вход в систему"}</h2>
        <p>
          {expired
            ? "Сессия истекла. Войдите, чтобы сохранить изменения."
            : "Войдите, чтобы продолжить работу с договорами."}
        </p>
        <form onSubmit={submit}>
          <Field label="Логин" value={username} onChange={setUsername} />
          <Field
            label="Пароль"
            type="password"
            value={password}
            onChange={setPassword}
          />
          <ErrorBox message={error} />
          <Button type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                Войти <ArrowRight size={18} />
              </>
            )}
          </Button>
        </form>
        <small>Доступ выдаёт владелец сервера.</small>
      </div>
    </div>
  );
}

function DownloadLinks({
  issue,
  onRetry,
}: {
  issue: Issue;
  onRetry?: () => void;
}) {
  return (
    <div className="download-links">
      {issue.has_docx && (
        <a
          className="button secondary small"
          href={`/api/issues/${issue.id}/files/docx`}
        >
          <ArrowDownToLine size={15} /> DOCX
        </a>
      )}
      {issue.has_pdf && (
        <a
          className="button secondary small"
          href={`/api/issues/${issue.id}/files/pdf`}
        >
          <ArrowDownToLine size={15} /> PDF
        </a>
      )}
      {issue.status === "pdf_failed" && onRetry && (
        <Button variant="ghost small" onClick={onRetry}>
          <RefreshCw size={14} />
          Повторить PDF
        </Button>
      )}
    </div>
  );
}

function ProfileView({
  initial,
  notes,
  onSaved,
  beforeLeave,
}: {
  initial: Profile;
  notes: SourceNote[];
  onSaved: (p: Profile) => void;
  beforeLeave: React.RefObject<(() => Promise<void>) | null>;
}) {
  const [profile, setProfile] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [saved, setSaved] = useState(false);
  const dirty = useRef(false);
  const live = useRef(profile);
  live.current = profile;
  const save = useCallback(async () => {
    if (!dirty.current) return;
    setBusy(true);
    setError("");
    try {
      const p = await api<Profile>("/profile", "PUT", live.current);
      setProfile(p);
      onSaved(p);
      dirty.current = false;
      setSaved(true);
      setErrors({});
    } catch (e) {
      setError((e as Error).message);
      setErrors((e as ApiError).fields || {});
      throw e;
    } finally {
      setBusy(false);
    }
  }, [onSaved]);
  useEffect(() => {
    beforeLeave.current = save;
    return () => {
      beforeLeave.current = null;
    };
  }, [beforeLeave, save]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, []);
  function change(p: Profile) {
    dirty.current = true;
    setSaved(false);
    setProfile(p);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">НАСТРОЙКИ</span>
          <h1>Реквизиты исполнителя</h1>
          <p>Данные, которые подставляются в новые договоры.</p>
        </div>
        <Button onClick={() => void save().catch(() => {})} disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <Save size={18} />
          )}
          Сохранить
        </Button>
      </div>
      <div className="editor-layout">
        <div>
          <ErrorBox message={error} />
          {saved && (
            <div className="success-box">
              <CheckCircle2 size={18} />
              Реквизиты сохранены
            </div>
          )}
          {!initial.verified && (
            <Section
              title="Расхождения в исходных шаблонах"
              description="В исходниках есть расхождения. Адрес и отсутствующий корреспондентский счёт нужно заполнить самостоятельно."
            >
              <div className="source-notes">
                {notes.map((n) => (
                  <div key={n.field}>
                    <b>{n.label}</b>
                    <span>
                      <small>Со спецификацией</small>
                      {n.full}
                    </span>
                    <span>
                      <small>Без спецификации</small>
                      {n.simple}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}
          <Section
            title="Исполнитель"
            description="Индивидуальный предприниматель"
          >
            <fieldset disabled={busy} className="profile-fields">
              <PartyFields
                party={profile.party}
                supplier
                prefix="supplier"
                errors={errors}
                onChange={(party) =>
                  change({ ...profile, party, verified: false })
                }
              />
              <label className="checkbox confirmation">
                <input
                  type="checkbox"
                  checked={profile.verified}
                  onChange={(e) =>
                    change({ ...profile, verified: e.target.checked })
                  }
                />
                Я проверил(а) реквизиты. Использовать их в новых договорах.
              </label>
              <small className="field-error">
                {errors["supplier.verified"]}
              </small>
              <Button
                onClick={() => void save().catch(() => {})}
                disabled={busy}
              >
                Сохранить реквизиты
                <Check size={17} />
              </Button>
            </fieldset>
          </Section>
        </div>
        <aside className="side-note">
          <ShieldCheck size={25} />
          <h3>Использование реквизитов</h3>
          <p>
            Этот профиль используется в обоих видах договоров и доступен с
            любого вашего устройства.
          </p>
          <hr />
          <p>
            Ранее сформированные документы сохранят те реквизиты, с которыми
            были выпущены.
          </p>
        </aside>
      </div>
    </>
  );
}

function Editor({
  initial,
  profile,
  onBack,
  onProfile,
  onUpdate,
  beforeLeave,
}: {
  initial: Contract;
  profile: Profile;
  onBack: () => void;
  onProfile: () => void;
  onUpdate: () => void;
  beforeLeave: React.RefObject<(() => Promise<void>) | null>;
}) {
  const [data, setData] = useState(initial.data),
    [step, setStep] = useState(0),
    [issues, setIssues] = useState(initial.issues),
    [saving, setSaving] = useState("saved"),
    [error, setError] = useState(""),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [generating, setGenerating] = useState(false);
  const live = useRef(data);
  live.current = data;
  const revision = useRef(initial.revision),
    persisted = useRef(JSON.stringify(initial.data)),
    inflight = useRef<Promise<void> | null>(null),
    blocked = useRef(false),
    mounted = useRef(true);
  const [retryTick, setRetryTick] = useState(0);
  const flush = useCallback(async () => {
    if (inflight.current) await inflight.current;
    if (blocked.current)
      throw new Error("Договор изменён на другом устройстве");
    if (persisted.current === JSON.stringify(live.current)) return;
    const operation = (async () => {
      while (persisted.current !== JSON.stringify(live.current)) {
        const snapshot = JSON.stringify(live.current);
        if (mounted.current) setSaving("saving");
        try {
          const saved = await api<Contract>(`/contracts/${initial.id}`, "PUT", {
            revision: revision.current,
            data: JSON.parse(snapshot),
          });
          revision.current = saved.revision;
          persisted.current = snapshot;
          if (mounted.current) {
            setSaving("saved");
            setError("");
          }
        } catch (e) {
          if ((e as ApiError).status === 409) blocked.current = true;
          if (mounted.current) {
            setSaving("error");
            setError((e as Error).message);
          }
          throw e;
        }
      }
    })();
    inflight.current = operation;
    try {
      await operation;
    } finally {
      inflight.current = null;
    }
  }, [initial.id]);
  useEffect(() => {
    mounted.current = true;
    beforeLeave.current = flush;
    return () => {
      mounted.current = false;
      beforeLeave.current = null;
    };
  }, [flush, beforeLeave]);
  useEffect(() => {
    if (persisted.current === JSON.stringify(data)) return;
    setSaving("pending");
    const timer = setTimeout(() => void flush().catch(() => {}), 800);
    return () => clearTimeout(timer);
  }, [data, flush, retryTick]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (persisted.current !== JSON.stringify(live.current)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const online = () => setRetryTick((x) => x + 1);
    window.addEventListener("beforeunload", prevent);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("beforeunload", prevent);
      window.removeEventListener("online", online);
    };
  }, []);
  const steps =
    data.type === "full"
      ? ["Договор", "Заказчик", "Спецификация", "Проверка"]
      : ["Договор", "Заказчик", "Проверка"];
  const field = (
    key: "number" | "date" | "city" | "title",
    label: string,
    options: Partial<React.ComponentProps<typeof Field>> = {},
  ) => (
    <Field
      label={label}
      value={data[key]}
      onChange={(value) => setData({ ...data, [key]: value })}
      error={errors[key]}
      {...options}
    />
  );
  const spec = data.specification;
  const paymentOption =
    data.payment_option ??
    ((data.prepayment_percent ?? "100") === "100" ? "prepayment" : "other");
  const legacyPaymentOther = (() => {
    const percent = Number(data.prepayment_percent ?? "100");
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return "";
    if (data.type === "full") {
      if (percent === 0)
        return `оплаты без предоплаты. Заказчик оплачивает 100% стоимости ${data.balance_terms ?? ""}.`;
      return `${percent}% предоплаты. Оставшиеся ${100 - percent}% стоимости Заказчик оплачивает ${data.balance_terms ?? ""}.`;
    }
    const start = percent
      ? `Покупатель вносит предоплату ${percent}% стоимости товара в течение 3 банковских дней со дня выставления счета.`
      : "Оплата производится без предоплаты.";
    return `${start} Оставшиеся ${100 - percent}% стоимости товара Покупатель оплачивает ${data.balance_terms ?? ""}.`;
  })();
  const paymentOther =
    data.payment_option == null
      ? legacyPaymentOther
      : (data.payment_other ?? "");
  function updateSpec(key: string, value: unknown) {
    setData({ ...data, specification: { ...spec, [key]: value } });
  }
  const generatingKey = useRef<string | null>(null);
  async function generate() {
    setGenerating(true);
    setError("");
    setErrors({});
    try {
      await flush();
      generatingKey.current ||= crypto.randomUUID();
      const result = await api<Issue>(
        `/contracts/${initial.id}/generate`,
        "POST",
        { revision: revision.current, request_id: generatingKey.current },
      );
      if (["generating", "converting"].includes(result.status)) {
        setError(
          "Документ ещё формируется. Повторите проверку через несколько секунд.",
        );
      } else {
        generatingKey.current = null;
        setIssues((old) => [result, ...old.filter((i) => i.id !== result.id)]);
        onUpdate();
        if (result.status === "failed")
          setError(
            "Не удалось сформировать документ. Черновик сохранён. Попробуйте ещё раз.",
          );
        if (result.status === "pdf_failed")
          setError(
            "DOCX готов. PDF пока не сформирован — его можно создать повторно ниже.",
          );
      }
    } catch (e) {
      setError((e as Error).message);
      setErrors((e as ApiError).fields || {});
      if ((e as ApiError).status && (e as ApiError).status < 500)
        generatingKey.current = null;
    } finally {
      setGenerating(false);
    }
  }
  async function removeIssue(issue: Issue) {
    if (
      !window.confirm(
        "Удалить эту версию и её файлы DOCX/PDF? Черновик и остальные версии сохранятся.",
      )
    )
      return;
    try {
      await api(`/issues/${issue.id}`, "DELETE");
      setIssues((current) => current.filter((i) => i.id !== issue.id));
      onUpdate();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function retry(issue: Issue) {
    setGenerating(true);
    try {
      const result = await api<Issue>(`/issues/${issue.id}/retry-pdf`, "POST");
      setIssues((old) => old.map((i) => (i.id === result.id ? result : i)));
      if (result.status === "pdf_failed")
        setError("PDF пока недоступен. DOCX сохранён.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }
  return (
    <>
      <div className="editor-top">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} /> Все договоры
        </button>
        <span
          className={"save-status " + (saving === "error" ? "danger" : "")}
          role="status"
        >
          {saving === "saving" ? (
            <LoaderCircle className="spin" size={14} />
          ) : saving === "saved" ? (
            <CheckCircle2 size={14} />
          ) : (
            <Clock3 size={14} />
          )}
          {
            {
              saved: "Все изменения сохранены",
              saving: "Сохраняем…",
              pending: "Есть изменения",
              error: "Не сохранено",
            }[saving]
          }
          {saving === "error" && !blocked.current && (
            <button onClick={() => void flush().catch(() => {})}>
              Повторить
            </button>
          )}
        </span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {data.type === "full"
              ? "ДОГОВОР СО СПЕЦИФИКАЦИЕЙ"
              : "ДОГОВОР ПОСТАВКИ"}
          </span>
          <h1>{data.number ? "Договор № " + data.number : "Новый договор"}</h1>
          <p>Заполните данные и сформируйте документ.</p>
        </div>
        <span className="badge draft">Черновик</span>
      </div>
      <div className="steps">
        {steps.map((name, i) => (
          <button
            key={name}
            className={
              (step === i ? "active " : "") + (step > i ? "complete" : "")
            }
            onClick={() => setStep(i)}
          >
            <span>
              {step > i ? <Check size={15} /> : String(i + 1).padStart(2, "0")}
            </span>
            {name}
            {i < steps.length - 1 && <ChevronRight size={16} />}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      {Object.keys(errors).length > 0 && (
        <div className="validation-list">
          <b>Не заполнены обязательные поля</b>
          {Object.entries(errors).map(([key, value]) => (
            <button
              key={key}
              onClick={() =>
                key.startsWith("supplier")
                  ? onProfile()
                  : setStep(
                      key.startsWith("customer")
                        ? 1
                        : key.startsWith("specification")
                          ? 2
                          : 0,
                    )
              }
            >
              {key.startsWith("supplier")
                ? "Профиль исполнителя"
                : key.startsWith("customer")
                  ? "Заказчик"
                  : key.startsWith("specification")
                    ? "Спецификация"
                    : "Данные договора"}
              : {value}
              <ArrowRight size={13} />
            </button>
          ))}
        </div>
      )}
      <div className="editor-layout">
        <div>
          {step === 0 && (
            <Section
              title="Основные данные"
              description="Номер и дата появятся во всех нужных местах документа."
            >
              <div className="form-grid">
                {field("number", "Номер договора", {
                  required: true,
                  placeholder: "Например, 12/26",
                })}
                {field("date", "Дата договора", {
                  type: "date",
                  required: true,
                })}
                {field("city", "Город подписания", {
                  required: true,
                  wide: true,
                })}
                {data.type === "full" &&
                  field("title", "Название работ", {
                    required: true,
                    wide: true,
                    placeholder: "Изготовление металлоконструкций",
                  })}
              </div>
              <div className="payment-terms">
                <span className="payment-terms-label">Условия оплаты</span>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Условия оплаты"
                >
                  <button
                    type="button"
                    className={paymentOption === "prepayment" ? "selected" : ""}
                    aria-pressed={paymentOption === "prepayment"}
                    onClick={() =>
                      setData({
                        ...data,
                        payment_option: "prepayment",
                        payment_other: "",
                      })
                    }
                  >
                    100% предоплата
                  </button>
                  <button
                    type="button"
                    className={paymentOption === "other" ? "selected" : ""}
                    aria-pressed={paymentOption === "other"}
                    onClick={() =>
                      setData({
                        ...data,
                        payment_option: "other",
                        payment_other: paymentOther,
                      })
                    }
                  >
                    Иное
                  </button>
                </div>
                {paymentOption === "other" && (
                  <Field
                    label="Укажите условия оплаты"
                    wide
                    multiline
                    value={paymentOther}
                    onChange={(v) =>
                      setData({
                        ...data,
                        payment_option: "other",
                        payment_other: v,
                      })
                    }
                    error={errors.payment_other}
                    placeholder="Например, 50% предоплата, остаток — в течение 5 рабочих дней"
                    required
                  />
                )}
              </div>
              <div className="quiet-note">
                <ShieldCheck size={18} />
                <span>
                  Шаблон содержит условия договора. Заполните данные сторон
                  {data.type === "full" ? " и спецификацию" : ""}.
                </span>
              </div>
            </Section>
          )}
          {step === 1 && (
            <Section
              title="Данные заказчика"
              description="Эти реквизиты будут в начале договора, в таблице и подписях."
            >
              <PartyFields
                party={data.customer}
                errors={errors}
                onChange={(customer) => setData({ ...data, customer })}
              />
            </Section>
          )}
          {step === 2 && data.type === "full" && (
            <>
              <Section
                title="Спецификация"
                description="Добавьте изделия или работы. Суммы рассчитаются автоматически."
              >
                <div className="form-grid">
                  <Field
                    label="Номер спецификации"
                    value={spec.number}
                    onChange={(v) => updateSpec("number", v)}
                    error={errors["specification.number"]}
                    required
                  />
                </div>
                <div className="items">
                  {spec.items.map((item, index) => (
                    <div className="item-card" key={index}>
                      <div className="item-head">
                        <span>
                          ПОЗИЦИЯ {String(index + 1).padStart(2, "0")}
                        </span>
                        <button
                          className="icon-button"
                          aria-label={`Удалить позицию ${index + 1}`}
                          onClick={() =>
                            updateSpec(
                              "items",
                              spec.items.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="form-grid">
                        {(["name", "unit", "quantity", "price"] as const).map(
                          (key) => (
                            <Field
                              key={key}
                              label={
                                {
                                  name: "Изделие или работа",
                                  unit: "Единица измерения",
                                  quantity: "Количество",
                                  price: "Цена за единицу, ₽",
                                }[key]
                              }
                              value={item[key]}
                              wide={key === "name"}
                              type={
                                key === "quantity" || key === "price"
                                  ? "decimal"
                                  : "text"
                              }
                              required
                              error={
                                errors[`specification.items.${index}.${key}`]
                              }
                              onChange={(v) =>
                                updateSpec(
                                  "items",
                                  spec.items.map((x, i) =>
                                    i === index ? { ...x, [key]: v } : x,
                                  ),
                                )
                              }
                            />
                          ),
                        )}
                      </div>
                      <details>
                        <summary>Материал, размеры и допуски</summary>
                        <div className="form-grid">
                          {(
                            ["material", "dimensions", "tolerance"] as const
                          ).map((key) => (
                            <Field
                              key={key}
                              label={
                                {
                                  material: "Материал",
                                  dimensions: "Размеры, мм",
                                  tolerance: "Предельные отклонения",
                                }[key]
                              }
                              value={item[key]}
                              onChange={(v) =>
                                updateSpec(
                                  "items",
                                  spec.items.map((x, i) =>
                                    i === index ? { ...x, [key]: v } : x,
                                  ),
                                )
                              }
                            />
                          ))}
                        </div>
                      </details>
                      <div className="item-total">
                        Сумма позиции{" "}
                        <b>
                          {formatMoney(lineAmount(item.quantity, item.price))}
                        </b>
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  variant="secondary full-width"
                  disabled={spec.items.length >= 200}
                  onClick={() =>
                    updateSpec("items", [...spec.items, emptyItem()])
                  }
                >
                  <Plus size={17} /> Добавить позицию
                </Button>
                <div className="grand-total">
                  <span>Итого по спецификации</span>
                  <b>{formatMoney(totalAmount(spec.items))}</b>
                </div>
              </Section>
              <Section
                title="Описание и условия"
                description="Текст попадёт в соответствующие разделы спецификации."
              >
                <div className="form-grid">
                  {(
                    [
                      "description",
                      "notes",
                      "coating",
                      "color",
                      "deadline",
                      "delivery",
                      "installation",
                    ] as const
                  ).map((key) => (
                    <Field
                      key={key}
                      label={
                        {
                          description: "Краткое описание изделия",
                          notes: "Примечания",
                          coating: "Покрытие",
                          color: "Цвет",
                          deadline: "Сроки изготовления",
                          delivery: "Доставка",
                          installation: "Монтаж",
                        }[key]
                      }
                      value={spec[key]}
                      onChange={(v) => updateSpec(key, v)}
                      required={[
                        "description",
                        "deadline",
                        "delivery",
                        "installation",
                      ].includes(key)}
                      error={errors["specification." + key]}
                      wide={!["coating", "color"].includes(key)}
                      multiline={!["coating", "color"].includes(key)}
                    />
                  ))}
                </div>
              </Section>
            </>
          )}
          {step === steps.length - 1 && (
            <>
              <Section
                title="Проверка данных"
                description="Проверьте данные и сформируйте документы."
              >
                <dl className="review-list">
                  <div>
                    <dt>Договор</dt>
                    <dd>
                      № {data.number || "—"} от {displayDate(data.date)}
                    </dd>
                  </div>
                  <div>
                    <dt>Заказчик</dt>
                    <dd>{data.customer.full_name || "Не заполнен"}</dd>
                  </div>
                  <div>
                    <dt>Исполнитель</dt>
                    <dd>{profile.party.short_name}</dd>
                  </div>
                  {data.type === "full" && (
                    <>
                      <div>
                        <dt>Работы</dt>
                        <dd>{data.title || "Не заполнены"}</dd>
                      </div>
                      <div>
                        <dt>Спецификация</dt>
                        <dd>
                          {spec.items.length} поз. ·{" "}
                          {formatMoney(totalAmount(spec.items))}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
                <div className="quiet-note">
                  <FileText size={19} />
                  <span>
                    Word для редактирования и PDF для отправки. Каждая
                    сформированная версия сохранится в истории.
                  </span>
                </div>
                <Button
                  onClick={() => void generate()}
                  disabled={generating || !profile.verified}
                >
                  {generating ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <FileText size={18} />
                  )}{" "}
                  {generating
                    ? "Формируем документы…"
                    : "Сформировать DOCX и PDF"}
                </Button>
                <small className="generation-hint">
                  Подготовка PDF может занять до полутора минут.
                </small>
              </Section>
              {issues.length > 0 && (
                <Section
                  title="Сформированные версии"
                  description="Ранее сформированные файлы этого договора."
                >
                  <div className="versions">
                    {issues.map((issue, index) => (
                      <div key={issue.id}>
                        <div>
                          <b>Версия от {displayDate(issue.created_at)}</b>
                          <small>
                            {new Date(issue.created_at).toLocaleTimeString(
                              "ru-RU",
                              { hour: "2-digit", minute: "2-digit" },
                            )}{" "}
                            ·{" "}
                            {issue.status === "ready"
                              ? "DOCX и PDF готовы"
                              : issue.status === "pdf_failed"
                                ? "DOCX готов, PDF нужно повторить"
                                : issue.status === "failed"
                                  ? "Не удалось сформировать"
                                  : "В обработке"}
                            {index === 0 ? " · последняя" : ""}
                          </small>
                        </div>
                        <div className="download-links">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label="Удалить версию"
                            disabled={
                              generating ||
                              ["generating", "converting"].includes(
                                issue.status,
                              )
                            }
                            onClick={() => void removeIssue(issue)}
                          >
                            <Trash2 size={16} />
                          </button>
                          <DownloadLinks
                            issue={issue}
                            onRetry={
                              generating ? undefined : () => void retry(issue)
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
          <div className="step-actions">
            <Button
              variant="secondary"
              onClick={() => (step === 0 ? onBack() : setStep(step - 1))}
            >
              <ArrowLeft size={16} />
              {step === 0 ? "К списку" : "Назад"}
            </Button>
            {step < steps.length - 1 && (
              <Button
                onClick={() => {
                  setStep(step + 1);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Продолжить
                <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </div>
        <aside>
          <div className="document-preview">
            <div className="paper">
              <span className="paper-label">
                {data.type === "full" ? "ДОГОВОР" : "ДОГОВОР ПОСТАВКИ"}
              </span>
              <strong>№ {data.number || "—"}</strong>
              <div className="paper-date">
                г. {data.city || "…"}
                <span>{displayDate(data.date)}</span>
              </div>
              <div className="paper-line long" />
              <div className="paper-line" />
              <div className="paper-line short" />
              <b className="paper-subtitle">1. ПРЕДМЕТ ДОГОВОРА</b>
              <div className="paper-line long" />
              <div className="paper-line" />
              <div className="paper-line long" />
              <b className="paper-subtitle">2. ОБЯЗАТЕЛЬСТВА СТОРОН</b>
              <div className="paper-line" />
              <div className="paper-line long" />
              <div className="paper-signatures">
                <span>Заказчик</span>
                <span>Исполнитель</span>
              </div>
            </div>
            <span>
              Схема документа ·{" "}
              {data.type === "full" ? "со спецификацией" : "без спецификации"}
            </span>
          </div>
          <div
            className={
              "supplier-card " + (!profile.verified ? "unverified" : "")
            }
          >
            <span className="eyebrow">ВАША СТОРОНА</span>
            <h3>{profile.party.short_name}</h3>
            <p>ИНН {profile.party.inn}</p>
            <span className="profile-state">
              {profile.verified ? (
                <CheckCircle2 size={15} />
              ) : (
                <AlertCircle size={15} />
              )}{" "}
              {profile.verified
                ? "Реквизиты подтверждены"
                : "Нужно проверить реквизиты"}
            </span>
            <button className="text-button" onClick={onProfile}>
              {profile.verified ? "Открыть профиль" : "Проверить и заполнить"}
              <ArrowRight size={15} />
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}

function App() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [booted, setBooted] = useState(false),
    [view, setView] = useState("home"),
    [profile, setProfile] = useState<Profile | null>(null),
    [notes, setNotes] = useState<SourceNote[]>([]),
    [contracts, setContracts] = useState<Contract[]>([]),
    [active, setActive] = useState<Contract | null>(null),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mobile, setMobile] = useState(false),
    [more, setMore] = useState(false);
  const beforeLeave = useRef<(() => Promise<void>) | null>(null),
    listRequest = useRef(0);
  const loadList = useCallback(async (q = "", offset = 0) => {
    const id = ++listRequest.current;
    const rows = await api<Contract[]>(
      `/contracts?q=${encodeURIComponent(q)}&offset=${offset}`,
    );
    if (id !== listRequest.current) return;
    setContracts((old) => (offset ? [...old, ...rows] : rows));
    setMore(rows.length === 50);
  }, []);
  const bootstrap = useCallback(async () => {
    const result = await api<{ profile: Profile; source_notes: SourceNote[] }>(
      "/profile",
    );
    setProfile(result.profile);
    setNotes(result.source_notes);
    await loadList();
    setBooted(true);
  }, [loadList]);
  useEffect(() => {
    api("/me")
      .then(() => {
        setAuth(true);
        return bootstrap();
      })
      .catch((e) => {
        if ((e as ApiError).status === 401) setAuth(false);
        else {
          setAuth(false);
          setError((e as Error).message);
        }
      });
    const expired = () => setAuth(false);
    window.addEventListener("pact-session-expired", expired);
    return () => window.removeEventListener("pact-session-expired", expired);
  }, [bootstrap]);
  useEffect(() => {
    if (!booted) return;
    const timer = setTimeout(
      () => void loadList(query).catch((e) => setError(e.message)),
      250,
    );
    return () => clearTimeout(timer);
  }, [query, booted, loadList]);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: string) {
    void action(async () => {
      await beforeLeave.current?.();
      setView(next);
      setMobile(false);
      if (next === "home" || next === "history") {
        setQuery("");
        await loadList();
      }
      window.scrollTo(0, 0);
    });
  }
  function create(type: "simple" | "full") {
    void action(async () => {
      await beforeLeave.current?.();
      const c = await api<Contract>("/contracts", "POST", emptyContract(type));
      setActive(c);
      setView("editor");
      setMobile(false);
    });
  }
  function open(id: string) {
    void action(async () => {
      await beforeLeave.current?.();
      setActive(await api<Contract>("/contracts/" + id));
      setView("editor");
      window.scrollTo(0, 0);
    });
  }
  function removeContract(c: Contract) {
    if (
      !window.confirm(
        `Удалить договор ${c.number || "без номера"}, черновик и все его версии DOCX/PDF? Это действие нельзя отменить.`,
      )
    )
      return;
    void action(async () => {
      await api(`/contracts/${c.id}?revision=${c.revision}`, "DELETE");
      await loadList();
    });
  }
  function copy(id: string) {
    void action(async () => {
      await beforeLeave.current?.();
      setActive(await api<Contract>(`/contracts/${id}/copy`, "POST"));
      setView("editor");
      window.scrollTo(0, 0);
    });
  }
  const onSaved = useCallback((p: Profile) => setProfile(p), []);
  if (auth === null)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        Открываем кабинет…
      </div>
    );
  if (!auth && !booted)
    return (
      <>
        <ErrorBox message={error} />
        <Login
          onSuccess={() => {
            setAuth(true);
            void bootstrap().catch((e) => setError(e.message));
          }}
        />
      </>
    );
  return (
    <>
      {!auth && <Login expired onSuccess={() => setAuth(true)} />}
      <div className="app-shell">
        <button
          className="mobile-menu icon-button"
          aria-label="Открыть меню"
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X /> : <Menu />}
        </button>
        {mobile && (
          <div className="nav-scrim" onClick={() => setMobile(false)} />
        )}
        <aside className={"sidebar " + (mobile ? "open" : "")}>
          <button className="brand" onClick={() => navigate("home")}>
            <span className="brand-symbol">п</span>пакт
            <span className="brand-dot">.</span>
          </button>
          <span className="workspace-label">ДОГОВОРЫ</span>
          <nav>
            <button
              className={view === "home" ? "active" : ""}
              onClick={() => navigate("home")}
            >
              <LayoutGrid size={19} />
              Обзор
            </button>
            <button
              className={
                view === "history" || view === "editor" ? "active" : ""
              }
              onClick={() => navigate("history")}
            >
              <FolderOpen size={19} />
              Мои договоры
            </button>
            <button
              className={view === "profile" ? "active" : ""}
              onClick={() => navigate("profile")}
            >
              <Settings2 size={19} />
              Реквизиты исполнителя
              {profile && !profile.verified && (
                <span className="attention-dot" />
              )}
            </button>
          </nav>
          <div className="account">
            <span className="avatar">ТБ</span>
            <div>
              <b>{profile?.party.short_name || "Личный кабинет"}</b>
              <small>Рабочая область</small>
            </div>
            <button
              className="icon-button"
              aria-label="Выйти"
              onClick={() =>
                void action(async () => {
                  await beforeLeave.current?.();
                  await api("/logout", "POST");
                  setBooted(false);
                  setAuth(false);
                  setActive(null);
                  setView("home");
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </aside>
        <main>
          <header className="topbar">
            <span>
              Рабочее пространство <ChevronRight size={14} />
              <b>
                {
                  {
                    home: "Обзор",
                    history: "Мои договоры",
                    profile: "Реквизиты исполнителя",
                    editor: "Новый договор",
                  }[view]
                }
              </b>
            </span>
            <span className="private">
              <span />
              Авторизованный доступ
            </span>
          </header>
          <div className="page">
            <ErrorBox message={error} />
            {!profile ? (
              <div className="loading">
                <LoaderCircle className="spin" />
                Загружаем реквизиты…
                <Button onClick={() => void action(bootstrap)}>
                  Повторить
                </Button>
              </div>
            ) : (
              <>
                {(view === "home" || view === "history") && (
                  <>
                    <div className="page-heading">
                      <div>
                        <span className="eyebrow">
                          {view === "home"
                            ? "РАБОЧЕЕ ПРОСТРАНСТВО"
                            : "РЕЕСТР ДОГОВОРОВ"}
                        </span>
                        <h1>
                          {view === "home"
                            ? "Создание договоров"
                            : "Мои договоры"}
                        </h1>
                        <p>
                          {view === "home"
                            ? "Выберите тип документа."
                            : "Черновики и сформированные документы."}
                        </p>
                      </div>
                      <span className="today">
                        {new Date().toLocaleDateString("ru-RU", {
                          day: "numeric",
                          month: "long",
                        })}
                      </span>
                    </div>
                    {!profile.verified && (
                      <div className="onboarding">
                        <div className="onboarding-icon">
                          <Settings2 size={20} />
                        </div>
                        <div>
                          <b>Заполните реквизиты исполнителя</b>
                          <p>
                            Проверьте данные исполнителя — они будут
                            подставляться автоматически.
                          </p>
                        </div>
                        <Button
                          variant="secondary small"
                          onClick={() => navigate("profile")}
                        >
                          Заполнить профиль
                          <ArrowRight size={15} />
                        </Button>
                      </div>
                    )}
                    <div className="template-grid">
                      <button
                        className="template-card"
                        onClick={() => create("simple")}
                        disabled={busy}
                      >
                        <div className="template-top">
                          <span className="template-icon">
                            <FileText size={25} />
                          </span>
                          <span className="template-tag">БЕЗ СПЕЦИФИКАЦИИ</span>
                        </div>
                        <h2>Договор поставки</h2>
                        <p>
                          Основные условия поставки <br />
                          и реквизиты сторон.
                        </p>
                        <div className="template-bottom">
                          <span>Создать договор</span>
                          <span className="round-arrow">
                            <ArrowUpRightIcon />
                          </span>
                        </div>
                      </button>
                      <button
                        className="template-card full-template"
                        onClick={() => create("full")}
                        disabled={busy}
                      >
                        <div className="template-top">
                          <span className="template-icon">
                            <Copy size={24} />
                          </span>
                          <span className="template-tag">СО СПЕЦИФИКАЦИЕЙ</span>
                        </div>
                        <h2>Договор на изготовление</h2>
                        <p>
                          Условия изготовления, перечень <br />
                          позиций и расчёт стоимости.
                        </p>
                        <div className="template-bottom">
                          <span>Создать договор</span>
                          <span className="round-arrow">
                            <ArrowUpRightIcon />
                          </span>
                        </div>
                      </button>
                    </div>
                    <div className="list-heading">
                      <div>
                        <h2>
                          {view === "home"
                            ? "Последние договоры"
                            : "Все договоры"}
                        </h2>
                        <span>
                          {contracts.length
                            ? `${contracts.length}${more ? "+" : ""} в списке`
                            : "Договоров пока нет"}
                        </span>
                      </div>
                      <label className="search">
                        <Search size={18} />
                        <input
                          aria-label="Поиск договоров"
                          placeholder="Номер или заказчик"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="contract-list">
                      {contracts.length === 0 ? (
                        <div className="empty-state">
                          <div className="empty-icon">
                            <FolderOpen size={31} />
                          </div>
                          <h3>
                            {query
                              ? "Ничего не найдено"
                              : "Здесь появятся ваши договоры"}
                          </h3>
                          <p>
                            {query
                              ? "Попробуйте другой номер или название заказчика."
                              : "Выберите шаблон выше, чтобы создать первый договор."}
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="list-labels">
                            <span>ДОГОВОР / ЗАКАЗЧИК</span>
                            <span>ДАТА</span>
                            <span>СТАТУС</span>
                            <span />
                          </div>
                          {contracts.map((c) => {
                            const latest = c.issues[0];
                            const ready =
                              latest?.revision === c.revision &&
                              latest?.has_docx;
                            return (
                              <div className="contract-row" key={c.id}>
                                <button
                                  className="contract-name"
                                  onClick={() => open(c.id)}
                                >
                                  <span
                                    className={
                                      "row-file " +
                                      (c.type === "full" ? "green" : "")
                                    }
                                  >
                                    <FileText size={20} />
                                  </span>
                                  <span>
                                    <b>
                                      {c.number
                                        ? "Договор № " + c.number
                                        : "Без номера"}
                                    </b>
                                    <small>
                                      {c.customer || "Заказчик не заполнен"} ·{" "}
                                      {c.type === "full"
                                        ? "Со спецификацией"
                                        : "Поставка"}
                                    </small>
                                  </span>
                                </button>
                                <span className="row-date">
                                  {displayDate(c.date)}
                                </span>
                                <span
                                  className={
                                    "badge " + (ready ? "ready" : "draft")
                                  }
                                >
                                  {ready ? "Сформирован" : "Черновик"}
                                </span>
                                <div className="row-actions">
                                  {latest && <DownloadLinks issue={latest} />}
                                  <button
                                    className="icon-button"
                                    disabled={busy}
                                    aria-label={`Удалить договор ${c.number}`}
                                    onClick={() => removeContract(c)}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label={`Скопировать договор ${c.number}`}
                                    onClick={() => copy(c.id)}
                                  >
                                    <Copy size={16} />
                                  </button>
                                  <button
                                    className="icon-button"
                                    aria-label={`Открыть договор ${c.number}`}
                                    onClick={() => open(c.id)}
                                  >
                                    <ChevronRight size={19} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}
                      {more && (
                        <Button
                          variant="ghost full-width"
                          onClick={() =>
                            void action(() => loadList(query, contracts.length))
                          }
                        >
                          Показать ещё
                        </Button>
                      )}
                    </div>
                  </>
                )}
                {view === "profile" && (
                  <ProfileView
                    initial={profile}
                    notes={notes}
                    onSaved={onSaved}
                    beforeLeave={beforeLeave}
                  />
                )}
                {view === "editor" && active && (
                  <Editor
                    key={active.id}
                    initial={active}
                    profile={profile}
                    onBack={() => navigate("history")}
                    onProfile={() => navigate("profile")}
                    onUpdate={() => void loadList().catch(() => {})}
                    beforeLeave={beforeLeave}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
function ArrowUpRightIcon() {
  return <ArrowRight size={20} style={{ transform: "rotate(-35deg)" }} />;
}

createRoot(document.getElementById("root")!).render(<App />);
