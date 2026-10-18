// Админка боевого пропуска. Каждое действие сразу уходит на сервер (кнопки «Сохранить» больше нет),
// запросы — с токеном админки, полученным по PIN.
import React from "react";
import { TASK_TYPES, parseAmount } from "../constants.js";
import { PRESET_NAME } from "../../domain/seasonPreset.js";

const del = (onClick, label, busy) => (
  <button className="text-btn" onClick={onClick} disabled={busy} aria-label={label} style={{ marginLeft: "8px" }}>
    <span className="material-icons" style={{ fontSize: "16px" }}>delete</span>
  </button>
);

export function AdminPanel({ bp, busy, run, api, dialogs, onClose }) {
  const { toast, confirm } = dialogs;

  // ---- Название сезона
  const [seasonName, setSeasonName] = React.useState(bp.seasonName);
  React.useEffect(() => setSeasonName(bp.seasonName), [bp.seasonName]);
  const saveSeason = async (e) => {
    e.preventDefault();
    const name = seasonName.trim();
    if (!name) return toast("Введите название сезона", "error");
    const res = await run(() => api.updateSeason({ season: bp.season, seasonName: name, maxLevel: bp.maxLevel, xpPerLevel: bp.xpPerLevel }));
    if (res) toast("✅ Название сезона сохранено", "success");
  };

  // ---- Задания
  const [task, setTask] = React.useState({ name: "", type: "streak_fives", target: "", xp: "" });
  const addTask = async (e) => {
    e.preventDefault();
    const xp = parseAmount(task.xp);
    if (!task.name.trim() || xp === null) return toast("Введите название и XP (целое число больше 0)", "error");
    const target = task.target === "" ? null : Number(task.target);
    if (target !== null && !(target > 0)) return toast("Цель — число больше 0 или пусто", "error");
    const res = await run(() => api.addTask({ name: task.name.trim(), type: task.type, target, xp }));
    if (res) {
      setTask(t => ({ ...t, name: "", target: "", xp: "" }));
      toast("✅ Задание добавлено", "success");
    }
  };
  const deleteTask = async (t) => {
    if (!await confirm(`Удалить задание «${t.name}»? Уже полученный XP останется.`, { okText: "Удалить", danger: true })) return;
    await run(() => api.deleteTask(t.id));
  };

  // ---- Награды
  const [reward, setReward] = React.useState({ level: "", text: "", type: "other", amount: "", badgeNumber: "1" });
  const addReward = async (e) => {
    e.preventDefault();
    const level = Number(reward.level);
    if (reward.level === "" || !Number.isInteger(level) || level < 0 || !reward.text.trim()) {
      return toast("Введите уровень (целое число) и описание награды", "error");
    }
    const body = { level, text: reward.text.trim(), type: reward.type };
    if (reward.type === "money") {
      body.amount = parseAmount(reward.amount);
      if (body.amount === null) return toast("Для денежной награды укажите сумму", "error");
    }
    if (reward.type === "badge") body.badgeNumber = Number(reward.badgeNumber);
    const res = await run(() => api.addReward(body));
    if (res) {
      setReward(r => ({ ...r, level: "", text: "", amount: "", badgeNumber: "1" }));
      toast("✅ Награда добавлена", "success");
    }
  };
  const deleteReward = async (r) => {
    if (!await confirm(`Удалить награду «${r.text}»?`, { okText: "Удалить", danger: true })) return;
    await run(() => api.deleteReward(r.id));
  };

  // ---- Бонус
  const [bonus, setBonus] = React.useState("");
  const giveBonus = async (e) => {
    e.preventDefault();
    const amount = parseAmount(bonus);
    if (amount === null) return toast("Введите сумму — целое число больше 0", "error");
    if (!await confirm(`Начислить ${amount} ₽ бонусом?`, { okText: "Начислить" })) return;
    const res = await run(() => api.adminBonus(amount));
    if (res) {
      setBonus("");
      toast(`✅ Начислено ${amount} ₽`, "success");
    }
  };

  const launchPreset = async () => {
    if (!await confirm(`Запустить сезон «${PRESET_NAME}»? Задания, награды, уровень и бейджи текущего сезона заменятся. Баланс и история не изменятся.`,
      { okText: "Запустить" })) return;
    const res = await run(() => api.launchPresetSeason());
    if (res) toast(`🚀 Сезон «${PRESET_NAME}» запущен`, "success");
  };

  const resetSeason = async () => {
    if (!await confirm("Сбросить сезон? Удалятся все задания, награды и прогресс. Деньги в истории останутся.",
      { okText: "Сбросить", danger: true })) return;
    const res = await run(() => api.resetSeason());
    if (res) toast("✅ Боевой пропуск сброшен", "success");
  };

  return (
    <div className="card battle-pass-admin">
      <button className="close-admin-btn" title="Закрыть" aria-label="Закрыть админку" onClick={onClose}>
        <span className="material-icons">close</span>
      </button>
      <h3>⚙️ Администрирование боевого пропуска</h3>

      <form className="section" onSubmit={saveSeason}>
        <h4>📝 Название сезона</h4>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input type="text" aria-label="Название сезона" value={seasonName} onChange={e => setSeasonName(e.target.value)}
            placeholder="Например: Осенний апгрейд знаний" style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: "13px" }}>Сезон #{bp.season}</span>
          <button type="submit" disabled={busy || seasonName.trim() === bp.seasonName}>Сохранить</button>
        </div>
        {bp.seasonName !== PRESET_NAME && (
          <button type="button" onClick={launchPreset} disabled={busy} style={{ marginTop: "8px", width: "100%" }}>
            🚀 Запустить сезон «{PRESET_NAME}»
          </button>
        )}
      </form>

      <div className="section">
        <h4>🎯 Задания</h4>
        <ul className="admin-list">
          {bp.tasks.length === 0 ? <li style={{ color: "var(--md-text-faint)" }}>Заданий пока нет</li> : bp.tasks.map(t => (
            <li key={t.id}>{t.name} — <b>+{t.xp} XP</b>{del(() => deleteTask(t), `Удалить задание ${t.name}`, busy)}</li>
          ))}
        </ul>
        <form className="row" style={{ gap: "8px", flexWrap: "wrap" }} onSubmit={addTask}>
          <input type="text" placeholder="Название задания" aria-label="Название задания" value={task.name}
            onChange={e => setTask({ ...task, name: e.target.value })} style={{ flex: "1 1 200px" }} />
          <select aria-label="Тип задания" value={task.type} onChange={e => setTask({ ...task, type: e.target.value })} style={{ width: "150px" }}>
            {TASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input type="number" step="any" placeholder="Цель" aria-label="Цель задания" value={task.target}
            onChange={e => setTask({ ...task, target: e.target.value })} style={{ width: "80px" }}
            title="Например: 3 для «3 пятёрки подряд», 10 для «10 оценок», 4.5 для среднего балла" />
          <input type="number" placeholder="XP" aria-label="XP задания" value={task.xp}
            onChange={e => setTask({ ...task, xp: e.target.value })} style={{ width: "80px" }} />
          <button type="submit" disabled={busy}>Добавить</button>
        </form>
      </div>

      <div className="section">
        <h4>🎁 Награды</h4>
        <ul className="admin-list">
          {bp.rewards.length === 0 ? <li style={{ color: "var(--md-text-faint)" }}>Наград пока нет</li> : bp.rewards.map(r => (
            <li key={r.id}>
              Уровень {r.level} — {r.text}
              {r.type === "money" && r.amount ? ` (${r.amount}₽)` : ""}
              {r.type === "badge" && r.badgeNumber ? ` (Бейдж #${r.badgeNumber})` : ""}
              {del(() => deleteReward(r), `Удалить награду ${r.text}`, busy)}
            </li>
          ))}
        </ul>
        <form className="row" style={{ gap: "8px", flexWrap: "wrap" }} onSubmit={addReward}>
          <input type="number" placeholder="Уровень" aria-label="Уровень награды" value={reward.level}
            onChange={e => setReward({ ...reward, level: e.target.value })} style={{ width: "80px" }} />
          <input type="text" placeholder="Описание награды" aria-label="Описание награды" value={reward.text}
            onChange={e => setReward({ ...reward, text: e.target.value })} style={{ flex: "1 1 150px" }} />
          <select aria-label="Тип награды" value={reward.type} onChange={e => setReward({ ...reward, type: e.target.value })} style={{ width: "120px" }}>
            <option value="other">Не деньги</option>
            <option value="money">Деньги</option>
            <option value="badge">Бейдж</option>
          </select>
          {reward.type === "money" && (
            <input type="number" placeholder="Сумма ₽" aria-label="Сумма награды" value={reward.amount}
              onChange={e => setReward({ ...reward, amount: e.target.value })} style={{ width: "100px" }} />
          )}
          {reward.type === "badge" && (
            <select aria-label="Номер бейджа" value={reward.badgeNumber} onChange={e => setReward({ ...reward, badgeNumber: e.target.value })} style={{ width: "100px" }}>
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={String(n)}>Бейдж {n}</option>)}
            </select>
          )}
          <button type="submit" disabled={busy}>Добавить</button>
        </form>
      </div>

      <form className="section" onSubmit={giveBonus}>
        <h4>💰 Начислить деньги</h4>
        <div className="row" style={{ gap: "8px", alignItems: "center" }}>
          <input type="number" min="1" step="1" placeholder="Сумма ₽" aria-label="Сумма бонуса" value={bonus}
            onChange={e => setBonus(e.target.value)} style={{ width: "120px" }} />
          <button type="submit" disabled={busy || parseAmount(bonus) === null}>Начислить</button>
        </div>
      </form>

      <div className="section" style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
        <button onClick={resetSeason} className="danger-btn" disabled={busy}>Сбросить сезон</button>
      </div>
    </div>
  );
}
