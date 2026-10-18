// Карточки главного экрана. Вид и классы — как в src/App.jsx (styles.css общий).
// Данные приходят из GET /api/state; действия — колбэки из App, кнопки блокируются, пока идёт запрос.
import React from "react";
import { todayISO, parseRuDate } from "../../domain/dates.js";
import { computeGradeStats } from "../../domain/stats.js";
import { levelProgress } from "../../domain/battlePass.js";
import { authErrorMessage } from "../firebase.js";
import { SUBJECTS, GRADE_COLORS, formatRub } from "../constants.js";

const Icon = ({ name, style }) => <span className="material-icons" style={style}>{name}</span>;
const inlineIcon = { verticalAlign: "middle", marginRight: "6px" };
const titleStyle = { marginTop: 0, display: "flex", alignItems: "center", gap: "8px" };

export function QuoteCard({ quote }) {
  return (
    <figure className="card quote-card">
      <span className="quote-mark" aria-hidden="true">“</span>
      <blockquote className="quote-text">{quote.text}</blockquote>
      <figcaption className="quote-author">— {quote.author}</figcaption>
    </figure>
  );
}

export function AuthCard({ auth }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async (action) => {
    if (!email.trim() || !password) return setError("Введите email и пароль");
    setBusy(true);
    setError("");
    try {
      await auth[action](email.trim(), password);
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form className="card auth-card" style={{ textAlign: "center" }} onSubmit={e => { e.preventDefault(); submit("signIn"); }}>
      <img src="logo.png" alt="Логотип" className="theme-logo" style={{ width: "160px", marginBottom: "16px" }} />
      <h2>Вход / Регистрация</h2>
      <div className="auth-fields">
        <input placeholder="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
        <input placeholder="Пароль" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="auth-actions">
        <button type="submit" disabled={busy}>Войти</button>
        <button type="button" disabled={busy} onClick={() => submit("register")}>Регистрация</button>
      </div>
      <div className="muted" style={{ marginTop: "16px" }}>Учись и заработай на мечту вместе с TakeFive</div>
    </form>
  );
}

export function UserCard({ user, onLogout }) {
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
      <div className="row">
        <Icon name="account_circle" style={{ color: "var(--md-primary)" }} />
        <div>
          <div style={{ fontWeight: 700 }}>{user.email}</div>
          <div className="muted">Вы авторизованы</div>
        </div>
      </div>
      <button className="text-btn" onClick={onLogout}>Выйти</button>
    </div>
  );
}

export function GradeForm({ busy, onAdd }) {
  const [subject, setSubject] = React.useState(SUBJECTS[0]);
  const [grade, setGrade] = React.useState(5);
  const [date, setDate] = React.useState(todayISO());
  return (
    <form className="card" onSubmit={e => { e.preventDefault(); onAdd({ date, subject, grade }); }}>
      <div className="row">
        <select aria-label="Предмет" value={subject} onChange={e => setSubject(e.target.value)}>
          {SUBJECTS.map(s => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Оценка" value={grade} onChange={e => setGrade(Number(e.target.value))}>
          {[5, 4, 3, 2].map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <input aria-label="Дата" type="date" required value={date} onChange={e => setDate(e.target.value)} max={todayISO()} />
        <button type="submit" disabled={busy}>
          <Icon name="add" style={inlineIcon} />
          Добавить
        </button>
      </div>
    </form>
  );
}

export function BalanceCard({ balance, busy, onCashOut }) {
  const [amount, setAmount] = React.useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (await onCashOut(amount)) setAmount("");
  };
  return (
    <div className="card balance-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="value">Баланс: {balance} ₽</div>
        <form className="cashout" onSubmit={submit}>
          <input className="cashout-input" type="number" min="1" step="1" inputMode="numeric" placeholder="Сумма вывода"
            aria-label="Сумма вывода" value={amount} onChange={e => setAmount(e.target.value)} />
          <button type="submit" disabled={busy}>
            <Icon name="paid" style={inlineIcon} />
            Вывести
          </button>
        </form>
      </div>
    </div>
  );
}

export function BadgesCard({ badges }) {
  return (
    <div className="card">
      <h3 style={titleStyle}>
        <Icon name="military_tech" style={{ color: "var(--md-primary)" }} />
        Команда Героев
      </h3>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
        {[1, 2, 3, 4, 5].map(num => {
          const active = badges.includes(num);
          return (
            <img key={num} src={active ? `badges/${num}.png` : `badges/${num}G.png`}
              alt={active ? `Бейдж ${num}` : `Бейдж ${num} (не получен)`} className="badge-img"
              style={{ flex: "1 1 0", minWidth: "50px", maxWidth: "160px", height: "auto", transition: "all 0.3s ease" }} />
          );
        })}
      </div>
    </div>
  );
}

// Высота столбцов — как в Firestore-версии: от 80 px для ненулевых до 230 px для максимума
function barHeight(count, maxCount) {
  if (count === 0) return 0;
  const min = 80, max = 230;
  return count === maxCount ? max : min + (max - min) * (count / maxCount);
}

export function StatsCard({ history }) {
  const { stats, average, maxCount, totalGrades } = computeGradeStats(history);
  const avgColor = average >= 4.5 ? GRADE_COLORS[5] : average >= 4 ? GRADE_COLORS[4] : average >= 3.5 ? GRADE_COLORS[3] : GRADE_COLORS[2];
  return (
    <div className="card stats-card">
      <h3 style={titleStyle}>
        <Icon name="bar_chart" style={{ color: "var(--md-primary)" }} />
        Статистика оценок
      </h3>
      {totalGrades === 0 ? (
        <p className="muted">Пока нет оценок для отображения статистики</p>
      ) : (
        <>
          <div className="stats-summary">
            <div className="stat-item">
              <div className="stat-label">Всего оценок</div>
              <div className="stat-value">{totalGrades}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">Средний балл</div>
              <div className="stat-value" style={{ color: avgColor }}>{average}</div>
            </div>
          </div>
          <div className="chart-container">
            {[5, 4, 3, 2].map(g => (
              <div key={g} className="chart-bar">
                <div className="bar-value">{stats[g]}</div>
                <div className="bar-column" style={{ height: `${barHeight(stats[g], maxCount)}px`, backgroundColor: GRADE_COLORS[g] }}></div>
                <div className="bar-label">Оценка {g}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function BattlePassCard({ bp, busy, onClaim }) {
  const progress = levelProgress(bp);
  return (
    <div className="card battle-pass">
      <h3 style={{ marginTop: 0 }}>🏆 Боевой пропуск сезона {bp.season}</h3>
      <p className="muted">«{bp.seasonName}»</p>

      <div className="xp-section">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 600 }}>Уровень: {bp.level} / {bp.maxLevel}</div>
          <div style={{ fontWeight: 600, color: "#2196f3" }}>XP: {progress.current} / {progress.needed}</div>
        </div>
        <div className="progress-bar large">
          <div className="progress-fill" style={{ width: `${progress.percentage}%` }}></div>
        </div>
      </div>

      <h4 style={{ marginTop: "16px" }}>🎯 Задания</h4>
      {bp.tasks.length === 0 ? (
        <p className="muted">Задания пока не добавлены. Администратор может добавить их через админ-панель.</p>
      ) : (
        <ul className="bp-tasks">
          {bp.tasks.map(task => {
            const done = bp.completedTasks.includes(task.id);
            return (
              <li key={task.id} className={done ? "done" : ""}>
                {done ? "✅" : "🔲"} {task.name} — <b>+{task.xp} XP</b>
              </li>
            );
          })}
        </ul>
      )}

      <h4 style={{ marginTop: "16px" }}>🎁 Награды</h4>
      {bp.rewards.length === 0 ? (
        <p className="muted">Награды пока не добавлены. Администратор может добавить их через админ-панель.</p>
      ) : (
        <div className="rewards-grid">
          {bp.rewards.map(reward => {
            const unlocked = bp.level >= reward.level;
            const claimed = bp.claimedRewards.includes(reward.id);
            const canClaim = unlocked && !claimed && !busy;
            return (
              // div, а не button: у .reward свой вид, глобальный стиль кнопок его бы перекрыл
              <div key={reward.id} role="button" tabIndex={canClaim ? 0 : -1} aria-disabled={!canClaim}
                className={`reward ${unlocked ? (claimed ? "claimed" : "unlocked") : "locked"}`}
                onClick={() => canClaim && onClaim(reward)}
                onKeyDown={e => { if (canClaim && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClaim(reward); } }}
                style={{ cursor: canClaim ? "pointer" : "default" }}
                title={claimed ? "Награда получена" : unlocked ? "Нажмите, чтобы получить награду" : `Откроется на уровне ${reward.level}`}>
                <div className="lvl">Ур.{reward.level}</div>
                <div className="val">{reward.text}</div>
                {claimed && <div className="claimed-badge">✅</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Последние 5 дней; если за них ничего нет — первые 5 записей (как в Firestore-версии)
function recentEntries(history, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5);
  const recent = history.filter(e => {
    const d = parseRuDate(e.date);
    return d === null || d >= from;
  });
  return recent.length > 0 ? recent : history.slice(0, 5);
}

export function HistoryCard({ history, busy, onDelete }) {
  const [showAll, setShowAll] = React.useState(false);
  const shown = showAll ? history : recentEntries(history);
  const hidden = history.length - shown.length;
  return (
    <div className="card history">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <h3 style={{ margin: 0 }}>История</h3>
        {history.length > 0 && (
          <span className="muted" style={{ fontSize: "13px" }}>{showAll ? `Всего: ${history.length}` : "Последние 5 дней"}</span>
        )}
      </div>
      {history.length === 0 && <p className="muted">Пока нет оценок.</p>}
      {shown.map(h => (
        <div key={h.id} className="entry">
          <div>
            <div><b>{h.date}</b> — {h.subject}: <b className={h.reward >= 0 ? "" : "negative"}>{h.grade}</b></div>
            {h.bonus && <div className="bonus">{h.bonus}</div>}
          </div>
          <div className="row" style={{ alignItems: "center" }}>
            <div style={{ minWidth: "90px", textAlign: "right", fontWeight: 700 }}>{formatRub(h.reward)}</div>
            <button className="text-btn" title="Удалить" aria-label={`Удалить: ${h.date}, ${h.subject}`} disabled={busy} onClick={() => onDelete(h)}>
              <Icon name="delete" />
            </button>
          </div>
        </div>
      ))}
      {(hidden > 0 || showAll) && history.length > 0 && (
        <div style={{ textAlign: "center", marginTop: "16px" }}>
          <button className="text-btn" onClick={() => setShowAll(!showAll)} style={{ fontSize: "14px" }}>
            <Icon name={showAll ? "expand_less" : "expand_more"} style={{ fontSize: "18px", verticalAlign: "middle" }} />
            {showAll ? "Показать только последние 5 дней" : `Показать всю историю (${hidden} скрыто)`}
          </button>
        </div>
      )}
    </div>
  );
}
