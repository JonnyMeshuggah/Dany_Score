// Приложение на API (docs/MIGRATION_PLAN.md, этап 5). Состояние — с сервера: GET /api/state при входе,
// дальше каждая мутация возвращает свежее { state }. Один запрос за раз: пока он идёт, кнопки неактивны —
// двойной клик не спишет деньги дважды.
import React from "react";
import { todayISO } from "../domain/dates.js";
import { QUOTES, pickQuoteIndex } from "../domain/quotes.js";
import { useDialogs } from "./dialogs.jsx";
import { APP_VERSION, formatRub, parseAmount } from "./constants.js";
import {
  QuoteCard, AuthCard, UserCard, GradeForm, BalanceCard, BadgesCard, StatsCard, BattlePassCard, HistoryCard
} from "./components/cards.jsx";
import { AdminPanel } from "./components/AdminPanel.jsx";

// Цитата при входе: случайная, не та же, что в прошлый раз
const QUOTE_KEY = "takefive:lastQuote";
function nextQuote() {
  let prev = null;
  try { const saved = localStorage.getItem(QUOTE_KEY); if (saved !== null) prev = Number(saved); } catch { /* хранилище недоступно */ }
  const i = pickQuoteIndex(QUOTES.length, prev);
  try { localStorage.setItem(QUOTE_KEY, String(i)); } catch { /* хранилище недоступно */ }
  return QUOTES[i];
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "UTF-8");
  });
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Боковая панель — статическая разметка в index.html (общая с Firestore-версией)
function useSidebar(enabled, handlers) {
  const ref = React.useRef(handlers);
  ref.current = handlers;
  React.useEffect(() => {
    if (!enabled) return;
    const $ = (id) => document.getElementById(id);
    const sidebar = $("sidebar"), burger = $("burgerBtn");
    if (!sidebar || !burger) return;
    const close = () => sidebar.classList.remove("open");
    const bind = [
      [burger, "click", (e) => { e.stopPropagation(); sidebar.classList.add("open"); }],
      [$("closeSidebar"), "click", close],
      [$("exportBtn"), "click", () => { close(); ref.current.onExport(); }],
      [$("battlePassAdmin"), "click", () => { close(); ref.current.onAdmin(); }],
      [$("importFile"), "change", (e) => {
        const file = e.target.files[0];
        e.target.value = ""; // тот же файл можно выбрать повторно
        close();
        if (file) ref.current.onImport(file);
      }],
      [document, "click", (e) => {
        if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && !burger.contains(e.target)) close();
      }]
    ].filter(([el]) => el);
    bind.forEach(([el, type, fn]) => el.addEventListener(type, fn));
    return () => bind.forEach(([el, type, fn]) => el.removeEventListener(type, fn));
  }, [enabled]);
}

export function App({ auth, api }) {
  const dialogs = useDialogs();
  const { toast, cancelAll } = dialogs;
  const [user, setUser] = React.useState(undefined); // undefined — Firebase ещё не ответил
  const [state, setState] = React.useState(null);
  const [loadError, setLoadError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [adminOpen, setAdminOpen] = React.useState(false);
  const [quote, setQuote] = React.useState(null);

  // Сессия — номер входа. Ответы на запросы прошлой сессии (выход, вход другим пользователем) отбрасываются,
  // иначе поздний ответ показал бы чужие данные или оставил открытой админку.
  const sessionRef = React.useRef(0);
  const uidRef = React.useRef(undefined);

  React.useEffect(() => auth.onChange(u => {
    setUser(u);
    const nextUid = u ? u.uid : null;
    if (nextUid === uidRef.current) return; // повторное уведомление о том же пользователе
    uidRef.current = nextUid;
    sessionRef.current += 1;
    cancelAll();
    busyRef.current = false;
    setBusy(false);
    setState(null);
    setLoadError(null);
    setAdminOpen(false);
    api.lockAdmin();
    setQuote(u ? nextQuote() : null);
  }), [auth, api, cancelAll]);

  // Действие привязано к сессии, в которой его начали: она фиксируется в начале и передаётся в каждый шаг
  // (окно, запрос). Смена аккаунта (в т.ч. в другой вкладке) закрывает окна отказом, а оставшиеся шаги
  // не выполняются — действие прежнего пользователя не уйдёт от имени нового.
  const confirm = async (message, opts, session = sessionRef.current) => {
    const ok = await dialogs.confirm(message, opts);
    return ok && session === sessionRef.current;
  };
  const prompt = async (message, opts, session = sessionRef.current) => {
    const value = await dialogs.prompt(message, opts);
    return session === sessionRef.current ? value : null;
  };

  // Номер последнего запроса состояния: загрузка, начатая раньше мутации или повторной загрузки,
  // не перетирает более свежее состояние
  const stateSeqRef = React.useRef(0);
  const applyState = (next) => {
    stateSeqRef.current += 1;
    setState(next);
  };

  const load = React.useCallback(async () => {
    const session = sessionRef.current;
    const seq = ++stateSeqRef.current;
    setLoadError(null);
    try {
      const next = await api.getState();
      if (session === sessionRef.current && seq === stateSeqRef.current) setState(next);
    } catch (err) {
      if (session === sessionRef.current && seq === stateSeqRef.current) setLoadError(err.message);
    }
  }, [api]);
  const uid = user?.uid;
  React.useEffect(() => { if (uid) load(); }, [uid, load]);

  // Выполнить запрос: свежее состояние из ответа, ошибка — уведомлением. null — не получилось
  // (в том числе если сессия, в которой начали действие, уже сменилась).
  const run = React.useCallback(async (action, session = sessionRef.current) => {
    if (busyRef.current || session !== sessionRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await action();
      // Пользователь сменился — ответ не его (поздний unlock токен уже не ставит, см. api.js)
      if (session !== sessionRef.current) return null;
      if (res && typeof res === "object" && res.state) applyState(res.state);
      return res ?? {};
    } catch (err) {
      if (session !== sessionRef.current) return null;
      if (err.code === "forbidden") {
        api.lockAdmin();
        setAdminOpen(false);
      }
      toast(err.message || "Что-то пошло не так", "error");
      // Сервер не принял вход — без выхода все следующие запросы тоже упадут
      if (err.code === "unauthorized") auth.signOut().catch(() => {});
      return null;
    } finally {
      if (session === sessionRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [api, auth, toast]);

  const ensureAdmin = async (session) => {
    if (api.isAdmin) return true;
    const pin = await prompt("Введите PIN администратора", { inputType: "password", inputMode: "numeric", okText: "Открыть" }, session);
    if (!pin) return false;
    return (await run(() => api.unlockAdmin(pin), session)) !== null;
  };

  // ---- Действия
  const addGrade = async ({ date, subject, grade }) => {
    if (!date || date > todayISO()) return toast("Выберите дату не позже сегодняшней", "error");
    const res = await run(() => api.addGrade({ date, subject, grade }));
    if (!res) return;
    const { entry } = res;
    toast(`${entry.subject}, ${entry.grade}: ${formatRub(entry.reward)}${entry.bonus ? ` · ${entry.bonus}` : ""}`,
      entry.reward >= 0 ? "success" : "error");
    if (res.completedTasks.length > 0) toast(`🎯 Выполнено заданий: ${res.completedTasks.length}`, "success");
    if (res.levelUp) toast(`🎉 Новый уровень ${res.state.battlePass.level}! Проверьте награды.`, "success");
  };

  const cashOut = async (raw) => {
    const session = sessionRef.current;
    const amount = parseAmount(raw);
    if (amount === null) { toast("Введите сумму — целое число больше 0", "error"); return false; }
    if (amount > state.balance) { toast("Сумма больше баланса", "error"); return false; }
    if (!await confirm(`Выдать ${amount} ₽ и уменьшить баланс?`, { okText: "Выдать" }, session)) return false;
    const res = await run(() => api.cashOut(amount), session);
    if (res) toast(`💸 Выдано ${amount} ₽`, "success");
    return res !== null;
  };

  const deleteEntry = async (entry) => {
    const session = sessionRef.current;
    const msg = `Удалить запись «${entry.subject}» от ${entry.date} (${formatRub(entry.reward)})?\nБонусы за этот день пересчитаются.`;
    if (!await confirm(msg, { okText: "Удалить", danger: true }, session)) return;
    await run(() => api.deleteEntry(entry.id), session);
  };

  const claimReward = async (reward) => {
    const res = await run(() => api.claimReward(reward.id));
    if (!res) return;
    if (reward.type === "money") toast(`✅ ${reward.text}: ${formatRub(reward.amount ?? 0)} на баланс`, "success");
    else if (reward.type === "badge") toast(`✅ Бейдж «${reward.text}» активирован`, "success");
    else toast(`✅ Награда «${reward.text}» получена`, "success");
  };

  const exportCSV = async () => {
    if (state && state.history.length === 0) return toast("История пуста", "error");
    const csv = await run(() => api.exportCSV());
    if (typeof csv === "string") download(csv, `history_${todayISO()}.csv`);
  };

  const importCSV = async (file) => {
    const session = sessionRef.current;
    if (!await ensureAdmin(session)) return;
    let csv;
    try {
      csv = await readText(file);
    } catch {
      return toast("Не удалось прочитать файл", "error");
    }
    // Пока читался файл, аккаунт мог смениться — тогда файл прежнего пользователя не загружаем
    if (session !== sessionRef.current) return;
    if (!await confirm("Загрузить историю из файла и заменить текущую?", { okText: "Заменить", danger: true }, session)) return;
    const res = await run(() => api.importHistory(csv), session);
    if (res) toast(`✅ Загружено записей: ${res.imported}`, "success");
  };

  const openAdmin = async () => {
    const session = sessionRef.current;
    if (await ensureAdmin(session) && session === sessionRef.current) setAdminOpen(true);
  };

  useSidebar(Boolean(user), { onExport: exportCSV, onImport: importCSV, onAdmin: openAdmin });

  const logout = async () => {
    try { await auth.signOut(); } catch (err) { toast(err.message, "error"); }
  };

  return (
    <div className="stack container">
      <div className="app-version">{APP_VERSION}</div>

      {user && quote && <QuoteCard quote={quote} />}

      {user === null && <AuthCard auth={auth} />}
      {user && <UserCard user={user} onLogout={logout} />}

      {user && !state && (
        <div className="card" role={loadError ? "alert" : undefined}>
          {loadError ? (
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>Не удалось загрузить данные: {loadError}</span>
              <button onClick={load}>Повторить</button>
            </div>
          ) : <span className="muted">Загрузка…</span>}
        </div>
      )}

      {user && state && (
        <>
          <GradeForm busy={busy} onAdd={addGrade} />
          <BalanceCard balance={state.balance} busy={busy} onCashOut={cashOut} />
          <BadgesCard badges={state.battlePass.badges} />
          <StatsCard history={state.history} />
          <BattlePassCard bp={state.battlePass} busy={busy} onClaim={claimReward} />
          <HistoryCard history={state.history} busy={busy} onDelete={deleteEntry} />
          {adminOpen && (
            <AdminPanel bp={state.battlePass} busy={busy} run={run} api={api} dialogs={{ toast, confirm }} onClose={() => setAdminOpen(false)} />
          )}
        </>
      )}

      {user && (
        <button className="burger" id="burgerBtn" title="Меню" aria-label="Меню">
          <span className="material-icons">menu</span>
        </button>
      )}
    </div>
  );
}
